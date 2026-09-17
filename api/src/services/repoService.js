const recipeDb = require('../db/repoDb');

// fork_type はそのレシピの生まれ方を表す。
// 0 = オリジナル（フォークではない）/ 1 = アレンジ / 2 = 移植（別の環境・人数に作り直したもの）
const FORK_TYPE_ARRANGE = 1;
const FORK_TYPE_PORT = 2;

// 閲覧者から見たリポジトリの権限（Gitea の repository.permissions に相当）。
// row は recipeDb から返る素のDB行（recipe_id, title, user_id, username, ... 等の生カラム名）
function toPermissions(row, viewerId) {
    const admin = viewerId != null && row.user_id === viewerId;

    return {
        admin,
        push: admin,
        pull: admin || !row.is_private
    };
}

// DBの素の行（recipeドメインのカラム名）を、フロントが受け取ってきた形（Gitea のリポジトリ表現）に整える。
// カラム名の翻訳・ネスト構造化・Boolean変換・権限計算はすべてここに一本化する
function toRepo(row, viewerId = null) {
    const repo = {
        id: row.recipe_id,
        name: row.title,
        full_name: `${row.username}/${row.title}`,
        description: row.description,
        owner: {
            user_id: row.user_id,
            username: row.username
        },
        private: Boolean(row.is_private),
        draft: Boolean(row.is_draft),
        thumbnail: row.thumbnail,
        permissions: toPermissions(row, viewerId),
        default_branch: row.default_branch,
        fork: row.parent_recipe_id != null,
        fork_type: row.fork_type,
        parent_id: row.parent_recipe_id ?? null,
        stars_count: row.stars_count,
        created_at: row.created_at,
        updated_at: row.updated_at
    };

    // 詳細取得（getRecipeById）のときだけ environment / ingredients / steps が付いてくる
    if (row.environment !== undefined) {
        repo.environment = row.environment;
    }
    if (row.ingredients !== undefined) {
        repo.ingredients = row.ingredients;
    }
    if (row.steps !== undefined) {
        repo.steps = row.steps;
    }
    if (row.latest_commit !== undefined) {
        repo.latest_commit = row.latest_commit ? toCommit(row.latest_commit) : null;
    }

    return repo;
}

// Dolt のコミット1件を、フロントが受け取る形（Gitea のコミット表現）に整える
function toCommit(row) {
    return {
        sha: row.commit_hash,
        message: row.message,
        author: {
            username: row.committer,
            email: row.email
        },
        created_at: row.date
    };
}

// 権限チェック付きでレシピ行を取得する。権限が無ければ例外を投げる（＝呼び出し側は結果を信頼してよい）
async function requireRepoPermission(repoId, viewerId, permission, action) {
    const row = await recipeDb.getRecipeById(repoId);
    if (!row) {
        const err = new Error('リポジトリが見つかりません');
        err.status = 404;
        throw err;
    }
    if (!toPermissions(row, viewerId)[permission]) {
        const err = new Error(`このリポジトリを${action}する権限がありません`);
        err.status = 403;
        throw err;
    }
    return row;
}

// 閲覧権限が無ければ例外を投げる
function requireViewableRepo(repoId, viewerId) {
    return requireRepoPermission(repoId, viewerId, 'pull', '閲覧');
}

// 管理権限（オーナー）が無ければ例外を投げる
function requireAdministrableRepo(repoId, userId, action) {
    return requireRepoPermission(repoId, userId, 'admin', action);
}

// 同じ人が同じ名前のレシピを2つ持てない（uq_repos_owner_name）ので、重複は 409 で返す
function toDuplicateNameError(error) {
    if (error.code === 'ER_DUP_ENTRY' || error.errno === 1062) {
        const err = new Error('同じ名前のレシピを既に持っています。別の名前を付けてください');
        err.status = 409;
        return err;
    }
    return error;
}

// require* (権限確認) とは別物の入力チェック。誰がアクセスしているかは見ず、
// payload に title/name が入っているかだけを見る。既定値の補完は recipeDb 側に任せる。
// 戻り値はコミットメッセージに使う
function resolveTitle(payload) {
    const title = payload.title ?? payload.name;

    if (!title) {
        const err = new Error('title または name は必須です');
        err.status = 400;
        throw err;
    }

    return title;
}

async function saveRepo(userId, payload, message) {
    try {
        const { commit, recipe } = await recipeDb.createRecipe(userId, payload, message);
        return { ok: true, commit, data: toRepo(recipe, userId) };
    } catch (error) {
        throw toDuplicateNameError(error);
    }
}

async function createRepository(ownerId, payload) {
    const title = resolveTitle(payload);
    const message = payload.commit_message || `レシピ作成: ${title}`;

    return saveRepo(ownerId, payload, message);
}

// 既存レシピを自分のレシピとして複製する（GitHub のフォーク相当の「アレンジする」）。
// 材料・手順・必須環境はそのまま引き継ぎ、payload に入っている項目だけ上書きする。
// 元レシピは parent_recipe_id に残るので、あとから派生をたどって家系図を作れる。
async function forkCheckedRepository(userId, repoId, payload = {}) {
    const source = await requireViewableRepo(repoId, userId);

    const forkType = Number(payload.fork_type ?? FORK_TYPE_ARRANGE);
    if (forkType !== FORK_TYPE_ARRANGE && forkType !== FORK_TYPE_PORT) {
        const err = new Error('fork_type は 1（アレンジ）か 2（移植）のどちらかです');
        err.status = 400;
        throw err;
    }

    // 元レシピの上に payload を重ねる。渡された項目だけが上書きされ、残りは引き継がれる
    const merged = { ...source, ...payload, fork_type: forkType, parent_recipe_id: source.recipe_id };
    const title = resolveTitle(merged);
    const kind = forkType === FORK_TYPE_PORT ? '移植' : 'アレンジ';
    const message = payload.commit_message
        || `レシピを${kind}: ${source.username}/${source.title} → ${title}`;

    return saveRepo(userId, merged, message);
}

async function searchReposByStars(viewerId = null) {
    const rows = await recipeDb.listRecentRecipes(100);
    const data = rows
        .map((row) => toRepo(row, viewerId))
        .sort((a, b) => b.stars_count - a.stars_count);
    return { ok: true, data };
}

async function searchReposByCurrentUser(userId) {
    const rows = await recipeDb.listRecipesByOwnerId(userId);
    const data = rows.map((row) => toRepo(row, userId));
    return { ok: true, data };
}

async function getCheckedRepoDetail(repoId, viewerId = null) {
    const row = await requireViewableRepo(repoId, viewerId);
    return { ok: true, data: toRepo(row, viewerId) };
}

async function getCheckedRepoCommits(repoId, viewerId = null) {
    await requireViewableRepo(repoId, viewerId);
    const rows = await recipeDb.listCommitsByRecipeId(repoId, 100);
    return { ok: true, data: rows.map(toCommit) };
}

async function getCheckedRepoCommit(repoId, commitId, viewerId = null) {
    await requireViewableRepo(repoId, viewerId);

    const row = await recipeDb.getCommitByRecipeId(repoId, commitId);
    if (!row) {
        const err = new Error('変更履歴が見つかりません');
        err.status = 404;
        throw err;
    }

    return { ok: true, data: { ...toCommit(row), changes: row.changes } };
}

async function updateCheckedRepository(userId, repoId, payload) {
    await requireAdministrableRepo(repoId, userId, '編集');

    const title = resolveTitle(payload);
    const message = payload.commit_message || `レシピ更新: ${title}`;
    const { commit } = await recipeDb.updateRecipeById(repoId, userId, payload, message);

    const updated = await recipeDb.getRecipeById(repoId);
    return { ok: true, commit, data: toRepo(updated, userId) };
}

async function deleteCheckedRepository(userId, repoId) {
    const existing = await requireAdministrableRepo(repoId, userId, '削除');
    const { commit } = await recipeDb.deleteRecipeById(repoId, userId, `レシピ削除: ${existing.title}`);
    return { ok: true, commit, data: { id: existing.recipe_id } };
}

// フォークした自分のレシピ(repoId)から、フォーク元へのプルリクエストを作る。
// 自分のフォークであること(admin)と、フォーク元が今も閲覧できること(pull)を確認する
async function createCheckedPullRequest(userId, repoId, payload = {}) {
    const source = await requireAdministrableRepo(repoId, userId, '提案');

    if (!source.parent_recipe_id) {
        const err = new Error('フォーク元が無いレシピはプルリクエストを作成できません');
        err.status = 400;
        throw err;
    }

    await requireViewableRepo(source.parent_recipe_id, userId);

    const { title, content } = payload;
    if (!title) {
        const err = new Error('title は必須です');
        err.status = 400;
        throw err;
    }

    const message = payload.commit_message || `プルリクエスト作成: ${title}`;
    const { commit, pullRequest } = await recipeDb.createPullRequest(
        repoId, source.parent_recipe_id, userId, { title, content }, message
    );

    return { ok: true, commit, data: pullRequest };
}

// PR をマージできるのは取り込まれる側（target = フォーク元）のオーナーだけ。
// prId はレシピIDではないので、まず PR を引いて target_recipe_id を取り出してから権限を見る
async function mergeCheckedPullRequest(userId, prId, payload = {}) {
    const target = await recipeDb.getPullRequestById(prId);
    if (!target) {
        const err = new Error('プルリクエストが見つかりません');
        err.status = 404;
        throw err;
    }

    await requireAdministrableRepo(target.target_recipe_id, userId, 'マージ');

    const message = payload.commit_message || `プルリクエストをマージ: ${target.title}`;
    const { commit, pullRequest } = await recipeDb.mergePullRequest(prId, userId, message);

    return { ok: true, commit, data: pullRequest };
}

module.exports = {
    searchReposByStars,
    createRepository,
    forkCheckedRepository,
    searchReposByCurrentUser,
    getCheckedRepoDetail,
    getCheckedRepoCommits,
    getCheckedRepoCommit,
    updateCheckedRepository,
    deleteCheckedRepository,
    createCheckedPullRequest,
    mergeCheckedPullRequest
};
