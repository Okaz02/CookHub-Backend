const test = require('node:test');
const assert = require('node:assert/strict');
const { mockModule, memoryRateLimitDb, startApp, mockSessions, OWNER_TOKEN, OTHER_TOKEN } = require('./helpers');

function recipeRow(overrides) {
    return {
        default_branch: 'main',
        thumbnail: null,
        description: null,
        stars_count: 0,
        recipe_status: 'public',
        parent_recipe_id: null,
        fork_type: 'original',
        environment: [],
        ingredients: [],
        steps: [],
        latest_commit: null,
        ...overrides
    };
}

const recipes = {
    1: recipeRow({ recipe_id: 1, user_id: 10, username: 'tanaka', title: '肉じゃが', ingredients: [{ id: 1, name: '砂糖', amount: 10, unit: 'g' }] }),
    2: recipeRow({ recipe_id: 2, user_id: 20, username: 'c', title: '秘密の肉じゃが', recipe_status: 'private', parent_recipe_id: 1, fork_type: 'arrange', ingredients: [{ id: 2, name: '砂糖', amount: 5, unit: 'g' }] }),
    3: recipeRow({ recipe_id: 3, user_id: 30, username: 'd', title: '肉じゃが4人分', parent_recipe_id: 2, fork_type: 'port', environment: [{ id: 3, key_name: '人数', value: '4人分' }] })
};

const pullRequest = {
    id: 7, target_recipe_id: 1, source_recipe_id: 2, user_id: 20, username: 'c', title: '砂糖を減らす', content: null,
    status: 'open', target_owner_id: 10, target_recipe_status: 'public', target_title: '肉じゃが',
    source_owner_id: 20, source_recipe_status: 'private', source_title: '秘密の肉じゃが'
};

const state = { updates: [], merges: [] };

mockModule('db/rateLimitDb.js', memoryRateLimitDb());
mockModule('db/recipeDb.js', {
    getRecipeById: async (id) => recipes[id] ?? null,
    getRecipeRowById: async (id) => recipes[id] ?? null,
    listRecipesByParentIds: async (ids) => Object.values(recipes).filter((row) => ids.includes(row.parent_recipe_id)),
    listEnvironmentByRecipeIds: async (ids) => ids.flatMap((id) => recipes[id].environment.map((env) => ({ recipe_id: id, ...env }))),
    isRecipeStarred: async () => false,
    getCommitByRecipeId: async (recipeId, hash) => (
        hash === 'abc123'
            ? { commit_hash: hash, message: 'm', committer: 'tanaka', email: 'e', date: 'd', changes: { info: [], environment: [], ingredients: [], steps: [] } }
            : null
    ),
    getRecipeSnapshot: async () => ({ title: '肉じゃが', description: 'old', thumbnail: null, recipe_status: 'public', environment: [], ingredients: [{ id: 1, name: '砂糖', amount: 20, unit: 'g' }], steps: [] }),
    updateRecipeById: async (recipeId, userId, recipe, message) => {
        if (recipe.title === 'dup') {
            const error = new Error('dup');
            error.code = 'ER_DUP_ENTRY';
            throw error;
        }
        state.updates.push({ recipeId, recipe, message });
        return { commit: 'h' };
    },
    createRecipe: async (ownerId, recipe) => ({ commit: 'h', recipe: { ...recipes[1], recipe_id: 9, user_id: ownerId, fork_type: recipe.fork_type, recipe_status: recipe.recipe_status } }),
    getPullRequestById: async (id) => (id === pullRequest.id ? pullRequest : null),
    listPullRequestsByTargetRecipeId: async () => [pullRequest],
    mergePullRequest: async (prId, source, target) => {
        state.merges.push({ source: source.recipe_id, target: target.recipe_id });
        return { commit: 'h', pullRequest: { ...pullRequest, status: 'merged' } };
    },
    closePullRequest: async () => ({ commit: 'h', pullRequest: { ...pullRequest, status: 'closed' } })
});
mockSessions();

let app;
test.before(async () => {
    app = await startApp();
});
test.after(() => app.close());

test('新規作成では fork_type を指定しても original になる', async () => {
    const res = await app.call('POST', '/recipes', { token: OWNER_TOKEN, body: { title: 'x', fork_type: 'port', recipe_status: 'private_draft' } });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.fork_type, 'original');
    assert.equal(res.body.data.recipe_status, 'private_draft');
});

test('レシピ名の重複は更新でも 409', async () => {
    const res = await app.call('PATCH', '/recipes/1', { token: OWNER_TOKEN, body: { title: 'dup' } });
    assert.equal(res.status, 409);
});

test('家系図は見えないレシピを飛ばして近い祖先につなぐ', async () => {
    const anonymous = await app.call('GET', '/recipes/3/family');
    assert.deepEqual(
        anonymous.body.data.nodes.map((node) => [node.id, node.tree_parent_id]).sort(),
        [[1, null], [3, 1]]
    );
    assert.equal(anonymous.body.data.truncated, false);

    const proposer = await app.call('GET', '/recipes/3/family', { token: OTHER_TOKEN });
    assert.deepEqual(
        proposer.body.data.nodes.map((node) => [node.id, node.tree_parent_id]).sort(),
        [[1, null], [2, 1], [3, 2]]
    );
    assert.deepEqual(proposer.body.data.nodes.find((node) => node.id === 3).environment, [{ key_name: '人数', value: '4人分' }]);
});

test('提案一覧では見えない非公開レシピのタイトルを伏せる', async () => {
    const anonymous = await app.call('GET', '/recipes/1/pull-requests');
    assert.equal(anonymous.body.data[0].source_title, null);
    const owner = await app.call('GET', '/recipes/1/pull-requests', { token: OWNER_TOKEN });
    assert.equal(owner.body.data[0].source_title, '秘密の肉じゃが');
});

test('提案の詳細は関係者以外には見せない', async () => {
    assert.equal((await app.call('GET', '/recipes/7/pull-request')).status, 403);
    const owner = await app.call('GET', '/recipes/7/pull-request', { token: OWNER_TOKEN });
    assert.equal(owner.status, 200);
    assert.deepEqual(owner.body.data.permissions, { merge: true, close: true });
    assert.match(owner.body.data.after_digest, /^[0-9a-f]{64}$/);
});

test('確認したときと提案の中身が違えば取り込まない', async () => {
    const detail = await app.call('GET', '/recipes/7/pull-request', { token: OWNER_TOKEN });

    const stale = await app.call('POST', '/recipes/7/pull-request/merge', { token: OWNER_TOKEN, body: { expected_digest: '0'.repeat(64) } });
    assert.equal(stale.status, 409);
    assert.equal(state.merges.length, 0);

    const merged = await app.call('POST', '/recipes/7/pull-request/merge', { token: OWNER_TOKEN, body: { expected_digest: detail.body.data.after_digest } });
    assert.equal(merged.status, 200);
    assert.deepEqual(state.merges, [{ source: 2, target: 1 }]);
});

test('取り込めるのは取り込み先のオーナーだけ', async () => {
    const res = await app.call('POST', '/recipes/7/pull-request/merge', { token: OTHER_TOKEN });
    assert.equal(res.status, 403);
});

test('レシピに関係の無いコミットは 404', async () => {
    assert.equal((await app.call('GET', '/recipes/1/commits/zzz999')).status, 404);
    const res = await app.call('GET', '/recipes/1/commits/abc123');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.snapshot.description, 'old');
});

test('以前の版に戻せるのはオーナーだけで、公開状態は変えない', async () => {
    assert.equal((await app.call('POST', '/recipes/1/commits/abc123/restore', { token: OTHER_TOKEN })).status, 403);
    assert.equal((await app.call('POST', '/recipes/1/commits/zzz999/restore', { token: OWNER_TOKEN })).status, 404);

    const res = await app.call('POST', '/recipes/1/commits/abc123/restore', { token: OWNER_TOKEN });
    assert.equal(res.status, 200);
    const { recipe } = state.updates.at(-1);
    assert.equal(recipe.description, 'old');
    assert.equal(recipe.ingredients[0].amount, 20);
    assert.equal(recipe.recipe_status, 'public');
});

test('500 では内部のエラー内容を返さない', async (t) => {
    t.mock.method(console, 'error', () => {});
    const res = await app.call('GET', '/recipes/abc');
    assert.equal(res.status, 400);

    const recipeDb = require('../src/db/recipeDb');
    t.mock.method(recipeDb, 'getRecipeById', async () => {
        throw new Error('ER_SECRET internal detail');
    });
    const failed = await app.call('GET', '/recipes/1');
    assert.equal(failed.status, 500);
    assert.doesNotMatch(failed.body.error, /ER_SECRET/);
});
