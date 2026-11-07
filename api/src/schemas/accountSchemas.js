const { type } = require('arktype');

const usernameSchema = type('string.trim').to(
    type('1 <= string <= 255').and(/^[^<>\u0000-\u001f\u007f]+$/)
);

const registerSchema = type({
    username: usernameSchema,
    email: type('string.email <= 255'),
    // bcrypt は 72 バイトより後ろを見ない
    password: type('8 <= string <= 72')
});

const loginSchema = type({
    username: type('string.trim').to('1 <= string <= 255'),
    password: type('1 <= string <= 72')
});

const accessTokenSchema = type(/^[0-9a-f]{40}$/);

module.exports = {
    registerSchema,
    loginSchema,
    accessTokenSchema
};
