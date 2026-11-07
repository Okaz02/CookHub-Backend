const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { mockModule, loadModule } = require('./helpers');

const calls = { insertAccessToken: [], compare: 0 };
const passwordHash = bcrypt.hashSync('password1', 4);

mockModule('db/accountDb.js', {
    createAccount: async () => {
        const error = new Error('dup');
        error.code = 'ER_DUP_ENTRY';
        throw error;
    },
    getAccountCredentialsByUsername: async (username) => (
        username === 'tanaka'
            ? { user_id: 10, username: 'tanaka', email: 'e', is_active: true, password_hash: passwordHash }
            : null
    ),
    insertAccessToken: async (...args) => {
        calls.insertAccessToken.push(args);
    },
    deleteAccessToken: async () => {},
    deleteExpiredAccessTokens: async () => {},
    getAccountByTokenHash: async () => null,
    touchAccessToken: async () => {}
});
mockModule('clients/doltClient.js', { commitDolt: async () => null });

const originalCompare = bcrypt.compare;
bcrypt.compare = async (...args) => {
    calls.compare += 1;
    return originalCompare(...args);
};

const accountService = loadModule('services/accountService.js');

test('存在しないユーザーでもパスワードを照合してから 401 を返す', async () => {
    const before = calls.compare;
    await assert.rejects(
        accountService.loginAccount({ username: 'nobody', password: 'password1' }),
        (error) => error.status === 401
    );
    assert.equal(calls.compare, before + 1);
});

test('ログインでパスワードハッシュを返さず、有効期限付きのトークンを発行する', async () => {
    const result = await accountService.loginAccount({ username: 'tanaka', password: 'password1' });
    assert.equal(result.password_hash, undefined);
    assert.match(result.token, /^[0-9a-f]{40}$/);
    const [userId, , tokenHash, ttlDays] = calls.insertAccessToken.at(-1);
    assert.equal(userId, 10);
    assert.match(tokenHash, /^[0-9a-f]{64}$/);
    assert.notEqual(tokenHash, result.token);
    assert.equal(ttlDays, 30);
});

test('無効なトークンは 401', async () => {
    await assert.rejects(accountService.getAccountBySession('a'.repeat(40)), (error) => error.status === 401);
});

test('登録の重複は 409', async () => {
    await assert.rejects(
        accountService.registerAccount({ username: 'tanaka', email: 'tanaka@example.com', password: 'password1' }),
        (error) => error.status === 409
    );
});
