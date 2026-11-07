const test = require('node:test');
const assert = require('node:assert/strict');
const { mockModule, memoryRateLimitDb, startApp, mockSessions, OWNER_TOKEN } = require('./helpers');

mockModule('db/rateLimitDb.js', memoryRateLimitDb());
mockSessions({
    loginAccount: async ({ username }) => {
        if (username !== 'tanaka') {
            const error = new Error('ng');
            error.status = 401;
            throw error;
        }
        return { user_id: 10, username: 'tanaka', token: OWNER_TOKEN };
    }
});

let app;
test.before(async () => {
    app = await startApp();
});
test.after(() => app.close());

test('アプリはトークンをボディで受け取る', async () => {
    const res = await app.call('POST', '/accounts/login', { body: { username: 'tanaka', password: 'x' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.token, OWNER_TOKEN);
    assert.equal(res.headers.get('set-cookie'), null);
});

test('Web はトークンを httpOnly Cookie で受け取り、ボディには含まれない', async () => {
    const res = await app.call('POST', '/accounts/login', {
        body: { username: 'tanaka', password: 'x' },
        headers: { 'X-CookHub-Client': 'web' }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.token, undefined);
    const cookie = res.headers.get('set-cookie');
    assert.match(cookie, /cookhub_session=a{40}/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
});

test('Cookie での認証は Web クライアントのヘッダーが無いと拒否する', async () => {
    const cookie = { Cookie: `cookhub_session=${OWNER_TOKEN}` };
    assert.equal((await app.call('GET', '/accounts/session', { headers: cookie })).status, 403);
    const res = await app.call('GET', '/accounts/session', { headers: { ...cookie, 'X-CookHub-Client': 'web' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.user_id, 10);
});

test('Bearer 以外の Authorization は認証に使わない', async () => {
    const res = await app.call('GET', '/accounts/session', { headers: { Authorization: `Basic ${OWNER_TOKEN}` } });
    assert.equal(res.status, 401);
});

test('ログアウトで Cookie を消す', async () => {
    const res = await app.call('POST', '/accounts/logout', { token: OWNER_TOKEN });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('set-cookie'), /cookhub_session=;/);
});

test('ログインの試行が続くと 429 と Retry-After を返す', async () => {
    const responses = [];
    for (let i = 0; i < 11; i += 1) {
        responses.push(await app.call('POST', '/accounts/login', { body: { username: 'suzuki', password: 'x' } }));
    }
    assert.equal(responses[0].status, 401);
    const last = responses.at(-1);
    assert.equal(last.status, 429);
    assert.ok(Number(last.headers.get('retry-after')) > 0);
});
