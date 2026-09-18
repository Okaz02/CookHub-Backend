const { z } = require('zod');

// 項目そのものが無いときのメッセージ。長すぎる・形式が違うといった他の理由は zod に任せる
function requiredError(issue) {
    return issue.input === undefined ? '必須です' : undefined;
}

// 文字数の上限は accounts テーブルの列定義に合わせる。
// 超えた値は Dolt 側で黙って切り捨てられてしまうので、その手前で弾く
const usernameSchema = z.string({ error: requiredError }).min(1, '必須です').max(255);

const registerSchema = z.object({
    username: usernameSchema,
    email: z.email({ error: requiredError }).max(255),
    // bcrypt は 72バイトより後ろを見ないので、黙って切り捨てられる前に弾く
    password: z.string({ error: requiredError }).min(1, '必須です').max(72)
});

// ログインは登録済みのパスワードをそのまま照合するだけなので、長さの上限は見ない
const loginSchema = z.object({
    username: usernameSchema,
    password: z.string({ error: requiredError }).min(1, '必須です')
});

// アクセストークンは 40文字の16進文字列（accountService.generateAccessToken が発行する形）。
// 形が違う時点で DB を引くまでもなく無効なので、認証ミドルウェアがここで弾く
const accessTokenSchema = z.string().regex(/^[0-9a-f]{40}$/);

module.exports = {
    registerSchema,
    loginSchema,
    accessTokenSchema
};
