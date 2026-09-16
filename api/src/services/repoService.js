const {
    listRecentRepos,
    listCommitsByRepoId,
    getCommitByRepoId,
    createRepo,
    listReposByOwnerId,
    getRepoByRepoId,
    editRepoByRepoId,
    deleteRepoByRepoId
} = require('../db/repoDb');

// fork_type はそのレシピの生まれ方を表す。
// 0 = オリジナル（フォークではない）/ 1 = アレンジ / 2 = 移植（別の環境・人数に作り直したもの）
const FORK_TYPE_ARRANGE = 1;
const FORK_TYPE_PORT = 2;

// 閲覧者から見たリポジトリの権限（Gitea の repository.permissions に相当）。
function toPermissions(row, viewerId) {
    const admin = viewerId != null && row.owner_user_id === viewerId;

    return {
        admin,
        push: admin,
        pull: admin || !row.is_private
    };
}

// DBの行を、フロントが受け取ってきた形（Gitea のリポジトリ表現）に整える
function toRepo(row, viewerId = null) {
    const repo = {
        id: row.repo_id,
        name: row.name,
        full_name: `${row.owner_username}/${row.name}`,
        description: row.description,
        owner: {
            user_id: row.owner_user_id,
            username: row.owner_username
        },
        private: Boolean(row.is_private),
        permissions: toPermissions(row, viewerId),
        default_branch: row.default_branch,
        fork: row.parent_recipe_id != null,
        fork_type: row.fork_type,
        parent_id: row.parent_recipe_id ?? null,
        stars_count: row.stars_count,
        created_at: row.created_at,
        updated_at: row.updated_at
    };

    // 詳細取得（getRepoByRepoId）のときだけ environment / ingredients / steps が付いてくる
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

async function getViewableRepo(repoId, viewerId) {
    const row = await getRepoByRepoId(repoId);
    if (!row) {
        const err = new Error('リポジトリが見つかりません');
        err.status = 404;
        throw err;
    }
    if (!toPermissions(row, viewerId).pull) {
        const err = new Error('このリポジトリを閲覧する権限がありません');
        err.status = 403;
        throw err;
    }
    return row;
}

async function getAdministrableRepo(repoId, userId, action) {
    const row = await getViewableRepo(repoId, userId);
    if (!toPermissions(row, userId).admin) {
        const err = new Error(`このリポジトリを${action}する権限がありません`);
        err.status = 403;
        throw err;
    }
    return row;
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

function normalizeRepoInput(payload = {}) {
    const title = payload.title ?? payload.name;

    if (!title) {
        const err = new Error('title または name は必須です');
        err.status = 400;
        throw err;
    }

    return {
        title,
        description: payload.description ?? null,
        defaultBranch: payload.defaultBranch || payload.default_branch || 'main',
        default_branch: payload.defaultBranch || payload.default_branch || 'main',
        isPrivate: payload.isPrivate ?? payload.is_private ?? payload.private ?? false,
        is_private: payload.isPrivate ?? payload.is_private ?? payload.private ?? false,
        isDraft: payload.isDraft ?? payload.is_draft ?? false,
        is_draft: payload.isDraft ?? payload.is_draft ?? false,
        forkType: payload.forkType ?? payload.fork_type ?? 0,
        fork_type: payload.forkType ?? payload.fork_type ?? 0,
        thumbnail: payload.thumbnail ?? null,
        environment: payload.environment ?? null,
        ingredients: payload.ingredients ?? null,
        steps: payload.steps ?? null,
        assets: payload.assets ?? null
    };
}

async function createRepository(ownerId, payload) {
    const normalized = normalizeRepoInput(payload);
    const message = payload.commitMessage || payload.commit_message || `レシピ作成: ${normalized.title}`;

    try {
        const { commit, repo } = await createRepo(ownerId, normalized, message);
        return { ok: true, commit, data: toRepo(repo, ownerId) };
    } catch (error) {
        throw toDuplicateNameError(error);
    }
}

// 既存レシピを自分のレシピとして複製する（GitHub のフォーク相当の「アレンジする」）。
// 材料・手順・必須環境はそのまま引き継ぎ、payload に入っている項目だけ上書きする。
// 元レシピは parent_recipe_id に残るので、あとから派生をたどって家系図を作れる。
async function forkRepository(userId, repoId, payload = {}) {
    const source = await getViewableRepo(repoId, userId);

    const forkType = Number(payload.forkType ?? payload.fork_type ?? FORK_TYPE_ARRANGE);
    if (forkType !== FORK_TYPE_ARRANGE && forkType !== FORK_TYPE_PORT) {
        const err = new Error('forkType は 1（アレンジ）か 2（移植）のどちらかです');
        err.status = 400;
        throw err;
    }

    const normalized = normalizeRepoInput({ ...source, ...payload });
    const kind = forkType === FORK_TYPE_PORT ? '移植' : 'アレンジ';
    const message = payload.commitMessage || payload.commit_message
        || `レシピを${kind}: ${source.owner_username}/${source.name} → ${normalized.title}`;

    try {
        const { commit, repo } = await createRepo(
            userId,
            { ...normalized, forkType, parentRecipeId: source.repo_id },
            message
        );
        return { ok: true, commit, data: toRepo(repo, userId) };
    } catch (error) {
        throw toDuplicateNameError(error);
    }
}

async function searchReposByStars(viewerId = null) {
    const rows = await listRecentRepos(100);
    const data = rows
        .map((row) => toRepo(row, viewerId))
        .sort((a, b) => b.stars_count - a.stars_count);
    return { ok: true, data };
}

async function searchReposByCurrentUser(userId) {
    const rows = await listReposByOwnerId(userId);
    const data = rows.map((row) => toRepo(row, userId));
    return { ok: true, data };
}

async function getRepoDetail(repoId, viewerId = null) {
    const row = await getViewableRepo(repoId, viewerId);
    return { ok: true, data: toRepo(row, viewerId) };
}

async function getRepoCommits(repoId, viewerId = null) {
    await getViewableRepo(repoId, viewerId);
    const rows = await listCommitsByRepoId(repoId, 100);
    return { ok: true, data: rows.map(toCommit) };
}

async function getRepoCommit(repoId, commitId, viewerId = null) {
    await getViewableRepo(repoId, viewerId);

    const row = await getCommitByRepoId(repoId, commitId);
    if (!row) {
        const err = new Error('変更履歴が見つかりません');
        err.status = 404;
        throw err;
    }

    return { ok: true, data: { ...toCommit(row), changes: row.changes } };
}

async function updateRepository(userId, repoId, payload) {
    await getAdministrableRepo(repoId, userId, '編集');

    const normalized = normalizeRepoInput(payload);
    const message = payload.commitMessage || payload.commit_message || `レシピ更新: ${normalized.title}`;
    const { commit } = await editRepoByRepoId(repoId, userId, normalized, message);

    const updated = await getRepoByRepoId(repoId);
    return { ok: true, commit, data: toRepo(updated, userId) };
}

async function deleteRepository(userId, repoId) {
    const existing = await getAdministrableRepo(repoId, userId, '削除');
    const { commit } = await deleteRepoByRepoId(repoId, userId, `レシピ削除: ${existing.name}`);
    return { ok: true, commit, data: { id: existing.repo_id } };
}

module.exports = {
    searchReposByStars,
    createRepository,
    forkRepository,
    searchReposByCurrentUser,
    getRepoDetail,
    getRepoCommits,
    getRepoCommit,
    updateRepository,
    deleteRepository
};
