const test = require('node:test');
const assert = require('node:assert/strict');
const { ArkErrors } = require('arktype');
require('arktype/config').configure({ onUndeclaredKey: 'delete' });
const { loadModule } = require('./helpers');

const { recipeSchema, mergeSchema } = loadModule('schemas/recipeSchemas.js');
const { registerSchema } = loadModule('schemas/accountSchemas.js');

test('画像URLは http(s) だけを受け付ける', () => {
    assert.ok(recipeSchema({ title: 'a', thumbnail: 'javascript:alert(1)' }) instanceof ArkErrors);
    assert.ok(recipeSchema({ title: 'a', steps: [{ body: 'b', image_url: 'data:text/html,x' }] }) instanceof ArkErrors);

    const recipe = recipeSchema({ title: 'a', thumbnail: ' HTTPS://example.com/a.png ', steps: [{ body: 'b', image_url: '' }] });
    assert.equal(recipe.thumbnail, 'HTTPS://example.com/a.png');
    assert.equal(recipe.steps[0].image_url, null);
});

test('ユーザー名に < > や制御文字は使えず、パスワードは8文字以上', () => {
    const valid = { username: 'tanaka', email: 'tanaka@example.com', password: 'password1' };
    assert.ok(!(registerSchema(valid) instanceof ArkErrors));
    assert.ok(registerSchema({ ...valid, username: 'a<b>' }) instanceof ArkErrors);
    assert.ok(registerSchema({ ...valid, username: 'a\nb' }) instanceof ArkErrors);
    assert.ok(registerSchema({ ...valid, password: 'short' }) instanceof ArkErrors);
});

test('マージの expected_digest は64桁の16進数か省略', () => {
    assert.equal(mergeSchema({}).expected_digest, null);
    assert.ok(mergeSchema({ expected_digest: 'x' }) instanceof ArkErrors);
    assert.equal(mergeSchema({ expected_digest: 'f'.repeat(64) }).expected_digest, 'f'.repeat(64));
});
