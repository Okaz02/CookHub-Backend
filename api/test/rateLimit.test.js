const test = require('node:test');
const assert = require('node:assert/strict');
const { mockModule, loadModule, memoryRateLimitDb } = require('./helpers');

const store = memoryRateLimitDb();
const keys = [];
mockModule('db/rateLimitDb.js', {
    ...store,
    incrementRateLimitHit: async (bucketKey, windowStart, expiresAt) => {
        keys.push({ bucketKey, windowStart, expiresAt });
        return store.incrementRateLimitHit(bucketKey, windowStart, expiresAt);
    }
});

const rateLimit = loadModule('middleware/rateLimit.js');

function run(middleware, req) {
    const headers = {};
    const res = { set: (name, value) => { headers[name] = value; } };
    return new Promise((resolve) => {
        middleware(req, res, (error) => resolve({ error, headers }));
    });
}

test('上限を超えると 429 と Retry-After を返す', async () => {
    const limit = rateLimit({ name: 't', windowMs: 60000, max: 2, keys: (req) => [req.ip] });
    assert.equal((await run(limit, { ip: '1.1.1.1' })).error, undefined);
    assert.equal((await run(limit, { ip: '1.1.1.1' })).error, undefined);
    const blocked = await run(limit, { ip: '1.1.1.1' });
    assert.equal(blocked.error.status, 429);
    assert.ok(Number(blocked.headers['Retry-After']) > 0);
    assert.equal((await run(limit, { ip: '2.2.2.2' })).error, undefined);
});

test('キーはハッシュ化して保存し、null のキーは数えない', async () => {
    keys.length = 0;
    const limit = rateLimit({ name: 'h', windowMs: 60000, max: 5, keys: () => ['user:tanaka', null] });
    await run(limit, {});
    assert.equal(keys.length, 1);
    assert.match(keys[0].bucketKey, /^[0-9a-f]{64}$/);
    assert.equal(keys[0].expiresAt - keys[0].windowStart, 60000);
});

test('記録の保存に失敗したら次のエラー処理に渡す', async () => {
    const failing = rateLimit({ name: 'f', windowMs: 60000, max: 5, keys: () => [null] });
    const original = Promise.all;
    Promise.all = () => Promise.reject(new Error('db down'));
    try {
        const { error } = await run(failing, {});
        assert.equal(error.message, 'db down');
    } finally {
        Promise.all = original;
    }
});
