const mysql = require('mysql2/promise');
const config = require('../config');

// Dolt は MySQL 互換プロトコルで喋るので、接続は mysql2 のプールをそのまま使う
const pool = mysql.createPool({
    host: config.DOLT_HOST,
    port: config.DOLT_PORT,
    user: config.DOLT_USER,
    password: config.DOLT_PASSWORD,
    database: config.DOLT_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    // Dolt サーバーは UTC で時刻を持つので、ホストのタイムゾーンに関係なく UTC として解釈する
    timezone: 'Z',
    // DECIMAL 列（材料の amount）を文字列ではなく数値で受け取る。
    // 入力側は ingredientSchema が数値にしているので、出力もそれに揃える
    decimalNumbers: true,
    // BOOLEAN 列を数値ではなく true/false で受け取る。
    // Dolt は TINYINT(1) でも表示幅を 1 として返さないため、幅では判定できない。
    // cookhub では真偽値の列を必ず is_ で始めているので名前で見分ける
    // （真偽値ではない TINYINT 列まで true/false にしないため）。
    // 選択肢が決まっている列（fork_type / プルリクエストの status）は番号ではなく
    // ENUM で持っているので、ここを通らずそのまま名前の文字列で返る。
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
