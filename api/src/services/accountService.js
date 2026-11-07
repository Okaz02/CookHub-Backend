const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const {
    createAccount,
    getAccountCredentialsByUsername,
    insertAccessToken,
    deleteAccessToken,
    deleteExpiredAccessTokens,
    getAccountByTokenHash,
    touchAccessToken
} = require('../db/accountDb');
const { commitDolt } = require('../clients/doltClient');
const { registerSchema, loginSchema } = require('../schemas/accountSchemas');
const { httpError, isDuplicateEntry } = require('../utils/httpError');
const config = require('../config');

const BCRYPT_ROUNDS = 10;
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), BCRYPT_ROUNDS);

function generateAccessToken() {
    return crypto.randomBytes(20).toString('hex');
}

function hashAccessToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

async function issueAccessToken(account) {
    const token = generateAccessToken();
    await deleteExpiredAccessTokens(account.user_id);
    await insertAccessToken(account.user_id, `cookhub-${Date.now()}`, hashAccessToken(token), config.tokenTtlDays);
    return token;
}

async function registerAccount(payload) {
    const { username, email, password } = registerSchema.assert(payload);

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    let account;
    try {
        account = await createAccount(username, email, passwordHash);
    } catch (error) {
        if (isDuplicateEntry(error)) {
            throw httpError(409, 'username または email は既に使われています');
        }
        throw error;
    }

    const token = await issueAccessToken(account);
    await commitDolt(`アカウント作成: ${account.username}`, account.user_id);

    return { ...account, token };
}

async function loginAccount(payload) {
    const { username, password } = loginSchema.assert(payload);

    const credentials = await getAccountCredentialsByUsername(username);
    const passwordMatched = await bcrypt.compare(password, credentials?.password_hash ?? DUMMY_PASSWORD_HASH);

    if (!credentials || !passwordMatched || !credentials.is_active) {
        throw httpError(401, 'ユーザー名またはパスワードが正しくありません');
    }

    const { password_hash, ...account } = credentials;
    const token = await issueAccessToken(account);

    return { ...account, token };
}

async function getAccountBySession(token) {
    const tokenHash = hashAccessToken(token);
    const account = await getAccountByTokenHash(tokenHash);

    if (!account || !account.is_active) {
        throw httpError(401, 'トークンが無効です');
    }

    await touchAccessToken(tokenHash);
    return account;
}

async function logoutAccount(token) {
    await deleteAccessToken(hashAccessToken(token));
    return { ok: true };
}

module.exports = {
    registerAccount,
    loginAccount,
    getAccountBySession,
    logoutAccount
};
