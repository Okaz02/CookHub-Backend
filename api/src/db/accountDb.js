const { pool } = require('./pool');
const { withTransaction } = require('./transaction');

// アカウント情報のうち外部に返してよい列
const ACCOUNT_COLUMNS = ['user_id', 'username', 'email', 'is_active', 'created_at', 'updated_at'];

const TOKEN_TOUCH_INTERVAL_HOURS = 1;

function accountColumns(alias) {
    return ACCOUNT_COLUMNS.map((column) => `${alias}.${column}`).join(', ');
}

async function createAccount(username, email, passwordHash) {
    const userId = await withTransaction(async (connection) => {
        const [result] = await connection.execute(
            'INSERT INTO accounts (username, email) VALUES (?, ?)',
            [username, email]
        );
        await connection.execute(
            'INSERT INTO account_credentials (user_id, password_hash) VALUES (?, ?)',
            [result.insertId, passwordHash]
        );
        return result.insertId;
    });
    return await getAccountById(userId);
}

async function getAccountById(userId) {
    const [rows] = await pool.execute(
        `SELECT ${accountColumns('a')} FROM accounts a WHERE a.user_id = ?`,
        [userId]
    );
    return rows[0] || null;
}

async function getAccountCredentialsByUsername(username) {
    const [rows] = await pool.execute(
        `SELECT ${accountColumns('a')}, c.password_hash
         FROM accounts a
         JOIN account_credentials c ON c.user_id = a.user_id
         WHERE a.username = ?`,
        [username]
    );
    return rows[0] || null;
}

async function insertAccessToken(userId, name, tokenHash, ttlDays) {
    await pool.execute(
        `INSERT INTO auth_tokens (user_id, name, token_hash, expires_at)
         VALUES (?, ?, ?, NOW() + INTERVAL ? DAY)`,
        [userId, name, tokenHash, ttlDays]
    );
}

async function deleteAccessToken(tokenHash) {
    await pool.execute('DELETE FROM auth_tokens WHERE token_hash = ?', [tokenHash]);
}

async function deleteExpiredAccessTokens(userId) {
    await pool.execute('DELETE FROM auth_tokens WHERE user_id = ? AND expires_at <= NOW()', [userId]);
}

async function getAccountByTokenHash(tokenHash) {
    const [rows] = await pool.execute(
        `SELECT ${accountColumns('a')}
         FROM auth_tokens t
         JOIN accounts a ON a.user_id = t.user_id
         WHERE t.token_hash = ? AND t.expires_at > NOW()`,
        [tokenHash]
    );
    return rows[0] || null;
}

async function touchAccessToken(tokenHash) {
    await pool.execute(
        `UPDATE auth_tokens
         SET last_used_at = NOW()
         WHERE token_hash = ?
           AND (last_used_at IS NULL OR last_used_at < NOW() - INTERVAL ${TOKEN_TOUCH_INTERVAL_HOURS} HOUR)`,
        [tokenHash]
    );
}

module.exports = {
    createAccount,
    getAccountCredentialsByUsername,
    insertAccessToken,
    deleteAccessToken,
    deleteExpiredAccessTokens,
    getAccountByTokenHash,
    touchAccessToken
};
