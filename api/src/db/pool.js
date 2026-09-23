const mysql = require('mysql2/promise');
const config = require('../config');

const pool = mysql.createPool({
    host: config.DOLT_HOST,
    port: config.DOLT_PORT,
    user: config.DOLT_USER,
    password: config.DOLT_PASSWORD,
    database: config.DOLT_DATABASE,
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
