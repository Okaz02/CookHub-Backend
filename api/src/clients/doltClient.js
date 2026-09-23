const { pool } = require('../db/pool');
const { DOLT_AUTO_COMMIT, DOLT_COMMIT_AUTHOR } = require('../config');

// コミットに失敗してもリクエストは成功のまま返す
async function commitDolt(message, userId) {
    if (!DOLT_AUTO_COMMIT) {
        return null;
    }

    let author = DOLT_COMMIT_AUTHOR;
    if (userId != null) {
        const [accounts] = await pool.query(
            'SELECT username, email FROM accounts WHERE user_id = ?',
            [Number(userId)]
        );
        if (accounts[0]) {
            author = `${accounts[0].username} <${accounts[0].email}>`;
        }
    }

    try {
        const [rows] = await pool.query('CALL DOLT_COMMIT(?, ?, ?, ?, ?, ?)', [
            '-A',
            '--skip-empty',
            '--author',
            author,
            '-m',
            message
        ]);
        // CALL は結果セットの配列で返ってくるため、どちらの形でも1行目を取り出す
        const row = Array.isArray(rows[0]) ? rows[0][0] : rows[0];
        return row ? row.hash : null;
    } catch (error) {
        console.error(`Dolt コミットに失敗しました (${message}):`, error.message);
        return null;
    }
}

async function getActiveBranch() {
    const [rows] = await pool.query('SELECT active_branch() AS branch');
    return rows[0] ? rows[0].branch : null;
}

module.exports = {
    commitDolt,
    getActiveBranch
};
