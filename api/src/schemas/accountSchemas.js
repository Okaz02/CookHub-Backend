const { type } = require('arktype');

const usernameSchema = type('1 <= string <= 255').describe('文字列');

const registerSchema = type({
    username: usernameSchema,
    email: type('string.email <= 255').describe('メールアドレス'),
    // bcrypt は 72 バイトより後ろを見ない
    password: type('1 <= string <= 72').describe('文字列')
});

// 照合するだけなので上限は見ない
const loginSchema = type({
    username: usernameSchema,
    password: type('string >= 1').describe('文字列')
});

const accessTokenSchema = type(/^[0-9a-f]{40}$/).describe('アクセストークン');

module.exports = {
    registerSchema,
    loginSchema,
    accessTokenSchema
};
