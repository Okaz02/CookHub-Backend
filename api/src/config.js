require('dotenv').config();
// スキーマ検証のエラーメッセージの日本語化。arktype 本体を読み込む前に済ませる必要があり、
// config.js は他のどのモジュールよりも先に読み込まれるので、ここに置けば必ず間に合う
require('./arktypeConfig');
const { type, ArkErrors } = require('arktype');

// 環境変数は文字列でしか渡ってこないので、数値と真偽値は読み替えてから使う。
// 既定値（省略時の値）はスキーマ側に持たせる

// ポート番号。'3306' のような文字列も数値として受け付ける
const portNumber = (fallback) => {
    const port = type('number.integer > 0').describe('数値');
    return port.or(type('string.integer.parse').describe('数値').to(port)).default(fallback);
};

// 真偽値。.env には文字列でしか書けないので 'true' / '1' を true として読む
const envFlag = (fallback) => {
    const flag = type("boolean | 'true' | 'false' | '1' | '0'").describe('true か false');
    return flag.pipe((value) => value === true || value === 'true' || value === '1').default(fallback);
};

const envText = (fallback) => {
    return type('string').default(fallback);
};

// api/.env で渡される設定。既定値は docker-compose.yml の dolt サービスにそのまま繋がる値
const envSchema = type({
    DOLT_HOST: envText('127.0.0.1'),
    DOLT_PORT: portNumber(3306),
    DOLT_USER: envText('cookhub'),
    // パスワード無しのユーザーでも接続できるので必須にはしない
    'DOLT_PASSWORD?': 'string',
    DOLT_DATABASE: envText('cookhub'),
    // 書き込みのたびに Dolt コミットを作るか
    DOLT_AUTO_COMMIT: envFlag(true),
    DOLT_COMMIT_AUTHOR: envText('cookhub-api <api@cookhub.local>'),
    PORT: portNumber(3001)
});

// 設定が壊れていれば、接続やコミットに失敗してから気付くのではなく起動時に落とす
const config = envSchema(process.env);
if (config instanceof ArkErrors) {
    throw new Error(`api/.env の設定が正しくありません\n${config.summary}`);
}

module.exports = config;
