require('dotenv').config();
const { pool } = require('../db/pool');

const AUTO_COMMIT = (process.env.DOLT_AUTO_COMMIT || 'true') !== 'false';
const AUTHOR = process.env.DOLT_COMMIT_AUTHOR || 'cookhub-api <api@cookhub.local>';

// データの変更履歴を残すのが目的なので、コミットに失敗してもリクエスト自体は
// 成功させ、ログだけ残す。
async function commitDolt(message, userId) {
    if (!AUTO_COMMIT) {
        return null;
    }

    let author = AUTHOR;
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
        await pool.query('CALL DOLT_ADD(?)', ['recipe_environment']);
        await pool.query('CALL DOLT_ADD(?)', ['recipe_ingredients']);
        await pool.query('CALL DOLT_ADD(?)', ['recipe_steps']);
        await pool.query('CALL DOLT_ADD(?)', ['repos_information']);

        const [rows] = await pool.query('CALL DOLT_COMMIT(?, ?, ?, ?, ?)', [
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
