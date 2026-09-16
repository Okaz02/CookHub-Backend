const { pool } = require('./pool');

// アカウント情報のうち外部に返してよい列
const ACCOUNT_COLUMNS = 'user_id, username, email, is_active, created_at, updated_at';

async function createAccount(username, email, passwordHash) {
    const [result] = await pool.execute(
        'INSERT INTO accounts (username, email, password_hash) VALUES (?, ?, ?)',
        [username, email, passwordHash]
    );
    return await getAccountById(result.insertId);
}

async function getAccountById(userId) {
    const [rows] = await pool.execute(
        `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE user_id = ?`,
        [userId]
    );
    return rows[0] || null;
}

async function getCookhubAccountByUsername(username) {
    const [rows] = await pool.execute(
        `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE username = ?`,
        [username]
    );
    return rows[0] || null;
}

async function getAccountCredentialsByUsername(username) {
    const [rows] = await pool.execute(
        `SELECT ${ACCOUNT_COLUMNS}, password_hash FROM accounts WHERE username = ?`,
        [username]
    );
    return rows[0] || null;
}

async function insertAccessToken(userId, name, tokenHash) {
    await pool.execute(
        'INSERT INTO access_tokens (user_id, name, token_hash) VALUES (?, ?, ?)',
        [userId, name, tokenHash]
    );
}

async function getAccountByTokenHash(tokenHash) {
    const [rows] = await pool.execute(
        `SELECT ${ACCOUNT_COLUMNS.split(', ').map((c) => `a.${c}`).join(', ')}
         FROM access_tokens t
         JOIN accounts a ON a.user_id = t.user_id
         WHERE t.token_hash = ?`,
        [tokenHash]
    );
    return rows[0] || null;
}

async function touchAccessToken(tokenHash) {
    await pool.execute(
        'UPDATE access_tokens SET last_used_at = NOW() WHERE token_hash = ?',
        [tokenHash]
    );
}

module.exports = {
    createAccount,
    getAccountById,
    getCookhubAccountByUsername,
    getAccountCredentialsByUsername,
    insertAccessToken,
    getAccountByTokenHash,
    touchAccessToken
};
