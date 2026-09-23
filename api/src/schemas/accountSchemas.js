const { type } = require('arktype');

const usernameSchema = type('1 <= string <= 255');

const registerSchema = type({
    username: usernameSchema,
    email: type('string.email <= 255'),
    // bcrypt は 72 バイトより後ろを見ない
    password: type('1 <= string <= 72')
});

const loginSchema = type({
    username: usernameSchema,
    password: type('string >= 1')
});

const accessTokenSchema = type(/^[0-9a-f]{40}$/);

module.exports = {
    registerSchema,
    loginSchema,
    accessTokenSchema
};
