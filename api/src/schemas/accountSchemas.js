const { type } = require('arktype');

// 文字数の上限は accounts テーブルの列定義に合わせる。
// 超えた値は Dolt 側で黙って切り捨てられてしまうので、その手前で弾く
const usernameSchema = type('1 <= string <= 255').describe('文字列');

const registerSchema = type({
    username: usernameSchema,
    email: type('string.email <= 255').describe('メールアドレス'),
    // bcrypt は 72バイトより後ろを見ないので、黙って切り捨てられる前に弾く
    password: type('1 <= string <= 72').describe('文字列')
});

// ログインは登録済みのパスワードをそのまま照合するだけなので、長さの上限は見ない
const loginSchema = type({
    username: usernameSchema,
    password: type('string >= 1').describe('文字列')
});

// アクセストークンは 40文字の16進文字列（accountService.generateAccessToken が発行する形）。
// 形が違う時点で DB を引くまでもなく無効なので、認証ミドルウェアがここで弾く
const accessTokenSchema = type(/^[0-9a-f]{40}$/).describe('アクセストークン');

module.exports = {
    registerSchema,
    loginSchema,
    accessTokenSchema
};
