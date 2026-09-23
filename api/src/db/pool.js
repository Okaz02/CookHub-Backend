const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: process.env.DOLT_HOST,
    port: process.env.DOLT_PORT,
    user: process.env.DOLT_USER,
    password: process.env.DOLT_PASSWORD,
    database: process.env.DOLT_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    // Dolt は UTC で時刻を持つ
    timezone: 'Z',
    decimalNumbers: true,
    // Dolt は TINYINT(1) の表示幅を返さないので、真偽値の列は is_ という名前で見分ける
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
