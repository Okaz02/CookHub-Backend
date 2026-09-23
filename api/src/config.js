require('dotenv').config();
// arktype 本体より先に読み込む。
// フォーク・更新では DB 行に入力を重ねて検証するので、入力ではない列を落とす
require('arktype/config').configure({ onUndeclaredKey: 'delete' });
const { type, ArkErrors } = require('arktype');

const portNumber = (fallback) => {
    const port = type('number.integer >= 1');
    return port.or(type('string.integer.parse').to(port)).default(fallback);
};

const envFlag = (fallback) => {
    const flag = type("boolean | 'true' | 'false' | '1' | '0'");
    return flag.pipe((value) => value === true || value === 'true' || value === '1').default(fallback);
};

const envText = (fallback) => {
    return type('string').default(fallback);
};

// 既定値は docker-compose.yml の dolt サービスに繋がる値
const envSchema = type({
    DOLT_HOST: envText('127.0.0.1'),
    DOLT_PORT: portNumber(3306),
    DOLT_USER: envText('cookhub'),
    'DOLT_PASSWORD?': 'string',
    DOLT_DATABASE: envText('cookhub'),
    DOLT_AUTO_COMMIT: envFlag(true),
    DOLT_COMMIT_AUTHOR: envText('cookhub-api <api@cookhub.local>'),
    PORT: portNumber(3001)
});

const config = envSchema(process.env);
if (config instanceof ArkErrors) {
    throw new Error(`api/.env の設定が正しくありません\n${config.summary}`);
}

module.exports = config;
