const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const {
    createAccount,
    getAccountCredentialsByUsername,
    insertAccessToken,
    getAccountByTokenHash,
    touchAccessToken
} = require('../db/accountDb');
const { commitDolt } = require('../clients/doltClient');
const { registerSchema, loginSchema } = require('../schemas/accountSchemas');

const BCRYPT_ROUNDS = 10;

// アクセストークンは 40文字の16進文字列。平文は発行時のレスポンスにしか現れず、
// DB には SHA-256 ハッシュだけを保存するので、後から値を確認することはできない。
function generateAccessToken() {
    return crypto.randomBytes(20).toString('hex');
}

function hashAccessToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

async function issueAccessToken(account) {
    const token = generateAccessToken();
    await insertAccessToken(account.user_id, `cookhub-${Date.now()}`, hashAccessToken(token));
    return token;
}

async function registerAccount(payload) {
    const { username, email, password } = registerSchema.assert(payload);

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    let account;
    try {
        account = await createAccount(username, email, passwordHash);
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY' || error.errno === 1062) {
            const err = new Error('username または email は既に使われています');
            err.status = 409;
            throw err;
        }
        error.status = error.status || 500;
        throw error;
    }

    // コミットはトークンを発行したあと。先にコミットすると、発行したトークンの行が
    // どのコミットにも属さないまま残り、次に誰かが作ったレシピのコミットに紛れ込む。
    const token = await issueAccessToken(account);
    await commitDolt(`アカウント作成: ${account.username}`, account.user_id);

    return { ...account, token };
}

async function loginAccount(payload) {
    const { username, password } = loginSchema.assert(payload);

    const credentials = await getAccountCredentialsByUsername(username);
    const passwordMatched = credentials
        ? await bcrypt.compare(password, credentials.password_hash)
        : false;

    if (!credentials || !passwordMatched || !credentials.is_active) {
        const err = new Error('ユーザー名またはパスワードが正しくありません');
        err.status = 401;
        throw err;
    }

    const { password_hash, ...account } = credentials;
    const token = await issueAccessToken(account);

    return { ...account, token };
}

// トークンの形式は認証ミドルウェアが accessTokenSchema で検証済み。ここで見るのは失効の有無だけ
async function getAccountBySession(token) {
    const tokenHash = hashAccessToken(token);
    const account = await getAccountByTokenHash(tokenHash);

    if (!account || !account.is_active) {
        const err = new Error('トークンが無効です');
        err.status = 401;
        throw err;
    }

    await touchAccessToken(tokenHash);
    return account;
}

module.exports = {
    registerAccount,
    loginAccount,
    getAccountBySession
};
