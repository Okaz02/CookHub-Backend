require('dotenv').config();
const { z } = require('zod');
const { ja } = require('zod/locales');

// スキーマ検証のエラーメッセージを日本語にする。この設定はスキーマを使う前に済ませる必要があり、
// config.js は他のどのモジュールよりも先に読み込まれるので、ここに置けば必ず間に合う
z.config(ja());

// api/.env で渡される設定。既定値は docker-compose.yml の dolt サービスにそのまま繋がる値
const envSchema = z.object({
    DOLT_HOST: z.string().default('127.0.0.1'),
    DOLT_PORT: z.coerce.number().int().positive().default(3306),
    DOLT_USER: z.string().default('cookhub'),
    // パスワード無しのユーザーでも接続できるので必須にはしない
    DOLT_PASSWORD: z.string().optional(),
    DOLT_DATABASE: z.string().default('cookhub'),
    // 書き込みのたびに Dolt コミットを作るか
    DOLT_AUTO_COMMIT: z.stringbool().default(true),
    DOLT_COMMIT_AUTHOR: z.string().default('cookhub-api <api@cookhub.local>'),
    PORT: z.coerce.number().int().positive().default(3001)
});

// 設定が壊れていれば、接続やコミットに失敗してから気付くのではなく起動時に落とす
const config = envSchema.safeParse(process.env);
if (!config.success) {
    throw new Error(`api/.env の設定が正しくありません\n${z.prettifyError(config.error)}`);
}

module.exports = config.data;
