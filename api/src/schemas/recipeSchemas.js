const { type } = require('arktype');

// Number('') は 0 になるので、数値に読み替えるより先に通す
const trimToNull = (value) => {
    if (typeof value !== 'string') {
        return value;
    }

    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
};

// max は DB の列幅に合わせる（超えると Dolt が黙って切り捨てる）。max 無しは TEXT 列
const requiredText = (max) => {
    const length = max === undefined ? 'string >= 1' : `1 <= string <= ${max}`;
    return type('string.trim').to(length);
};

const optionalText = (max) => {
    const length = max === undefined ? 'string' : `string <= ${max}`;
    return type('string | null').pipe(trimToNull).to(`${length} | null`).default(null);
};

const toNumber = (value, ctx) => {
    if (typeof value !== 'string') {
        return value;
    }

    const number = Number(value);
    return Number.isNaN(number) ? ctx.error('a number') : number;
};

const optionalNumber = (max) => {
    return type('string | number | null')
        .pipe(trimToNull, toNumber)
        .to(`number <= ${max} | null`)
        .default(null);
};

const requiredId = () => {
    return type('string | number').pipe(toNumber).to('number.integer >= 1');
};

// 更新時に残す既存行の ID。新しく足す行は null
const optionalId = () => {
    return type('string | number | null')
        .pipe(trimToNull, toNumber)
        .to('number.integer >= 1 | null')
        .default(null);
};

// 省略は現状維持、[] は全削除として db 層が扱う
const rows = (rowSchema) => {
    return rowSchema.array().optional();
};

const branchName = () => {
    return requiredText(255).default('main');
};

const commitHash = () => {
    return type(/^[0-9a-zA-Z]{1,64}$/);
};

// .default() はオブジェクトの項目にしか効かないので、単体で使う forkTypeSchema 用に undefined を fallback に読み替える
const oneOf = (values, fallback) => {
    const value = type.enumerated(...values);
    return fallback === undefined ? value : type('undefined').pipe(() => fallback).or(value);
};

const environmentSchema = type({
    id: optionalId(),
    key_name: requiredText(255),
    value: requiredText(255)
});

const ingredientSchema = type({
    id: optionalId(),
    name: requiredText(255),
    amount: optionalNumber(99999999.99), // DECIMAL(10, 2)
    unit: optionalText(50)
});

const stepSchema = type({
    id: optionalId(),
    body: requiredText(),
    image_url: optionalText(255)
});

// parent_recipe_id は service 層が :id から決める
const recipeSchema = type({
    title: requiredText(255),
    description: optionalText(),
    default_branch: branchName(),
    thumbnail: optionalText(255),
    recipe_status: oneOf(['public', 'private', 'public_draft', 'private_draft']).default('public'),
    fork_type: oneOf(['original', 'arrange', 'port'], 'original').default('original'), // port = 別の環境・人数に作り直したもの
    environment: rows(environmentSchema),
    ingredients: rows(ingredientSchema),
    steps: rows(stepSchema),
    commit_message: optionalText(255)
});

const forkTypeSchema = oneOf(['arrange', 'port'], 'arrange');

const pullRequestSchema = type({
    title: requiredText(255),
    content: optionalText(),
    commit_message: optionalText(255)
});

const mergeSchema = type({
    commit_message: optionalText(255)
});

// :id は /pull-request/merge だけプルリクエスト ID
const recipeParamsSchema = type({
    id: requiredId()
});

const commitParamsSchema = recipeParamsSchema.merge({
    commitId: commitHash()
});

module.exports = {
    recipeSchema,
    forkTypeSchema,
    pullRequestSchema,
    mergeSchema,
    recipeParamsSchema,
    commitParamsSchema
};
