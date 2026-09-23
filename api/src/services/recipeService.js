const recipeDb = require('../db/recipeDb');
const {
    recipeSchema,
    forkTypeSchema,
    pullRequestSchema,
    issueSchema,
    mergeSchema
} = require('../schemas/recipeSchemas');

// push / pull は git から借りた名前で、push = 書き換え可、pull = 閲覧可
function toPermissions(row, viewerId) {
    const admin = viewerId != null && row.user_id === viewerId;

    return {
        admin,
        push: admin,
        pull: admin || row.recipe_status === 'public'
    };
}

function toRecipe(row, viewerId = null) {
    const recipe = {
        id: row.recipe_id,
        title: row.title,
        description: row.description,
        owner: {
            user_id: row.user_id,
            username: row.username
        },
        recipe_status: row.recipe_status,
        thumbnail: row.thumbnail,
        permissions: toPermissions(row, viewerId),
        default_branch: row.default_branch,
        is_fork: row.parent_recipe_id != null,
        fork_type: row.fork_type,
        parent_recipe_id: row.parent_recipe_id ?? null,
        stars_count: row.stars_count,
        created_at: row.created_at,
        updated_at: row.updated_at
    };

    // getRecipeById のときだけ付いてくる
    if (row.environment !== undefined) {
        recipe.environment = row.environment;
    }
    if (row.ingredients !== undefined) {
        recipe.ingredients = row.ingredients;
    }
    if (row.steps !== undefined) {
        recipe.steps = row.steps;
    }
    if (row.latest_commit !== undefined) {
        recipe.latest_commit = row.latest_commit ? toCommit(row.latest_commit) : null;
    }

    return recipe;
}

// Gitea のコミット表現に合わせる
function toCommit(row) {
    return {
        sha: row.commit_hash,
        message: row.message,
        author: {
            username: row.committer,
            email: row.email
        },
        date: row.date
    };
}

async function requireRecipePermission(recipeId, viewerId, permission, action) {
    const row = await recipeDb.getRecipeById(recipeId);
    if (!row) {
        const err = new Error('レシピが見つかりません');
        err.status = 404;
        throw err;
    }
    if (!toPermissions(row, viewerId)[permission]) {
        const err = new Error(`このレシピを${action}する権限がありません`);
        err.status = 403;
        throw err;
    }
    return row;
}

function requireViewableRecipe(recipeId, viewerId) {
    return requireRecipePermission(recipeId, viewerId, 'pull', '閲覧');
}

function requireAdministrableRecipe(recipeId, userId, action) {
    return requireRecipePermission(recipeId, userId, 'admin', action);
}

function toDuplicateNameError(error) {
    if (error.code === 'ER_DUP_ENTRY' || error.errno === 1062) {
        const err = new Error('同じ名前のレシピを既に持っています。別の名前を付けてください');
        err.status = 409;
        return err;
    }
    return error;
}

async function saveRecipe(userId, recipe, parentRecipeId, message) {
    try {
        const { commit, recipe: created } = await recipeDb.createRecipe(userId, recipe, parentRecipeId, message);
        return { ok: true, commit, data: toRecipe(created, userId) };
    } catch (error) {
        throw toDuplicateNameError(error);
    }
}

async function createRecipe(ownerId, payload) {
    const recipe = recipeSchema.assert(payload);
    const message = recipe.commit_message || `レシピ作成: ${recipe.title}`;

    return saveRecipe(ownerId, recipe, null, message);
}

async function createCheckedIssue(userId, recipeId, payload = {}) {
    await requireViewableRecipe(recipeId, userId);

    const input = issueSchema.assert(payload);
    const message = input.commit_message || `Issue 作成: ${input.title}`;
    const { commit, issue } = await recipeDb.createIssue(recipeId, userId, input, message);

    return { ok: true, commit, data: issue };
}

async function forkCheckedRecipe(userId, recipeId, payload = {}) {
    const source = await requireViewableRecipe(recipeId, userId);
    const forkType = forkTypeSchema.assert(payload.fork_type);

    const recipe = recipeSchema.assert({
        ...source,
        ...payload,
        title: payload.title ?? source.title,
        fork_type: forkType
    });

    const kind = recipe.fork_type === 'port' ? '移植' : 'アレンジ';
    const message = recipe.commit_message
        || `レシピを${kind}: ${source.username}/${source.title} → ${recipe.title}`;

    return saveRecipe(userId, recipe, source.recipe_id, message);
}

async function searchRecipesByStars(viewerId = null) {
    const rows = await recipeDb.listRecentRecipes(100);
    const data = rows
        .map((row) => toRecipe(row, viewerId))
        .sort((a, b) => b.stars_count - a.stars_count);
    return { ok: true, data };
}

async function searchRecipesByCurrentUser(userId) {
    const rows = await recipeDb.listRecipesByOwnerId(userId);
    const data = rows.map((row) => toRecipe(row, userId));
    return { ok: true, data };
}

async function getCheckedRecipeDetail(recipeId, viewerId = null) {
    const row = await requireViewableRecipe(recipeId, viewerId);
    return { ok: true, data: toRecipe(row, viewerId) };
}

async function getCheckedRecipeCommits(recipeId, viewerId = null) {
    await requireViewableRecipe(recipeId, viewerId);
    const rows = await recipeDb.listCommitsByRecipeId(recipeId, 100);
    return { ok: true, data: rows.map(toCommit) };
}

async function getCheckedRecipeCommit(recipeId, commitId, viewerId = null) {
    await requireViewableRecipe(recipeId, viewerId);

    const row = await recipeDb.getCommitByRecipeId(recipeId, commitId);
    if (!row) {
        const err = new Error('変更履歴が見つかりません');
        err.status = 404;
        throw err;
    }

    return { ok: true, data: { ...toCommit(row), changes: row.changes } };
}

function toRecipeInput(row) {
    return {
        title: row.title,
        description: row.description,
        default_branch: row.default_branch,
        thumbnail: row.thumbnail,
        recipe_status: row.recipe_status,
        fork_type: row.fork_type
    };
}

async function updateCheckedRecipe(userId, recipeId, payload = {}) {
    const existing = await requireAdministrableRecipe(recipeId, userId, '編集');

    const input = payload ?? {};
    const recipe = recipeSchema.assert({
        ...toRecipeInput(existing),
        ...input,
        title: input.title ?? existing.title
    });
    const message = recipe.commit_message || `レシピ更新: ${recipe.title}`;
    const { commit } = await recipeDb.updateRecipeById(recipeId, userId, recipe, message);

    const updated = await recipeDb.getRecipeById(recipeId);
    return { ok: true, commit, data: toRecipe(updated, userId) };
}

async function deleteCheckedRecipe(userId, recipeId) {
    const existing = await requireAdministrableRecipe(recipeId, userId, '削除');
    const { commit } = await recipeDb.deleteRecipeById(recipeId, userId, `レシピ削除: ${existing.title}`);
    return { ok: true, commit, data: { id: existing.recipe_id } };
}

async function createCheckedPullRequest(userId, recipeId, payload = {}) {
    const source = await requireAdministrableRecipe(recipeId, userId, '提案');

    if (!source.parent_recipe_id) {
        const err = new Error('フォーク元が無いレシピはプルリクエストを作成できません');
        err.status = 400;
        throw err;
    }

    await requireViewableRecipe(source.parent_recipe_id, userId);

    const input = pullRequestSchema.assert(payload);
    const message = input.commit_message || `プルリクエスト作成: ${input.title}`;
    const { commit, pullRequest } = await recipeDb.createPullRequest(
        recipeId, source.parent_recipe_id, userId, input, message
    );

    return { ok: true, commit, data: pullRequest };
}

async function mergeCheckedPullRequest(userId, prId, payload = {}) {
    const { commit_message } = mergeSchema.assert(payload);

    const target = await recipeDb.getPullRequestById(prId);
    if (!target) {
        const err = new Error('プルリクエストが見つかりません');
        err.status = 404;
        throw err;
    }

    await requireAdministrableRecipe(target.target_recipe_id, userId, 'マージ');

    const message = commit_message || `プルリクエストをマージ: ${target.title}`;
    const { commit, pullRequest } = await recipeDb.mergePullRequest(prId, userId, message);

    return { ok: true, commit, data: pullRequest };
}

module.exports = {
    searchRecipesByStars,
    createRecipe,
    forkCheckedRecipe,
    searchRecipesByCurrentUser,
    getCheckedRecipeDetail,
    getCheckedRecipeCommits,
    getCheckedRecipeCommit,
    updateCheckedRecipe,
    deleteCheckedRecipe,
    createCheckedIssue,
    createCheckedPullRequest,
    mergeCheckedPullRequest
};
