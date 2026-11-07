const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: process.env.DOLT_HOST,
    port: process.env.DOLT_PORT,
    user: process.env.DOLT_USER,
    password: process.env.DOLT_PASSWORD,
    database: process.env.DOLT_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    timezone: 'Z',
    decimalNumbers: true,
    typeCast(field, next) {
        if (field.type === 'TINY' && field.length === 1) {
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
