require('dotenv').config();
const mysql = require('mysql2/promise');

// Dolt は MySQL 互換プロトコルで喋るので、接続は mysql2 のプールをそのまま使う
const pool = mysql.createPool({
    host: process.env.DOLT_HOST || '127.0.0.1',
    port: Number(process.env.DOLT_PORT || 3306),
    user: process.env.DOLT_USER || 'cookhub',
    password: process.env.DOLT_PASSWORD,
    database: process.env.DOLT_DATABASE || 'cookhub',
    waitForConnections: true,
    connectionLimit: 10,
    // Dolt サーバーは UTC で時刻を持つので、ホストのタイムゾーンに関係なく UTC として解釈する
    timezone: 'Z',
    // BOOLEAN 列を数値ではなく true/false で受け取る。
    // Dolt は TINYINT(1) でも表示幅を 1 として返さないため、幅では判定できない。
    // cookhub では真偽値の列を必ず is_ で始めているので名前で見分ける
    // （fork_type のように 0/1 以外を取る TINYINT まで true/false にしないため）。
    typeCast: (field, next) => {
        if (field.type === 'TINY' && /(^|_)is_/.test(field.name)) {
            const value = field.string();
            return value === null ? null : value === '1';
        }
        return next();
    }
});

pool.on('error', (error) => {
    console.error('Dolt の予期しない接続エラー:', error);
});

module.exports = { pool };
