require('dotenv').config();
// arktype 本体を読み込むより先に済ませる必要がある
require('./arktypeConfig');
const { type, ArkErrors } = require('arktype');

// .env には文字列でしか書けないので、'3306' のような文字列も数値として受け付ける
const portNumber = (fallback) => {
    const port = type('number.integer > 0').describe('数値');
    return port.or(type('string.integer.parse').describe('数値').to(port)).default(fallback);
};

// .env には文字列でしか書けないので 'true' / '1' を true として読む
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
    DOLT_AUTO_COMMIT: envFlag(true),
    DOLT_COMMIT_AUTHOR: envText('cookhub-api <api@cookhub.local>'),
    PORT: portNumber(3001)
});

// 接続やコミットに失敗してから気付くのではなく、起動時に落とす
const config = envSchema(process.env);
if (config instanceof ArkErrors) {
    throw new Error(`api/.env の設定が正しくありません\n${config.summary}`);
}

module.exports = config;
