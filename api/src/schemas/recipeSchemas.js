const { type } = require('arktype');

// 空白や '' を null にそろえないと、変更履歴に中身の無い差分が出る。
// 数値の項目では '' が 0 に化けるので、数値に読み替えるより先に通す
const trimToNull = (value) => {
    if (typeof value !== 'string') {
        return value;
    }

    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
};

const noValue = type('null').describe('未入力');

// union の既定の文言（「文字列 か 未入力 のどちらか」）は読みにくいので一言に言い直す
const mustBe = (name) => {
    return { problem: () => `${name}で指定してください` };
};

// max は DB の列幅に合わせる（超えると Dolt が黙って切り捨てる）。max 無しは TEXT 列
const requiredText = (max) => {
    const length = max === undefined ? 'string >= 1' : `1 <= string <= ${max}`;
    return type('string.trim').describe('文字列').to(length);
};

const optionalText = (max) => {
    const length = max === undefined ? 'string' : `string <= ${max}`;
    const text = type(length).describe('文字列').or(noValue);
    return type('string | null').pipe(trimToNull).to(text).configure(mustBe('文字列'), 'union').default(null);
};

// 範囲は読み替えたあとで見る。一緒に見ると弾いた理由が「数値ではない」に丸められる
const toNumber = (value, ctx) => {
    if (typeof value !== 'string') {
        return value;
    }

    const number = Number(value);
    return Number.isNaN(number) ? ctx.error('数値') : number;
};

const optionalNumber = (max) => {
    return type('string | number | null')
        .pipe(trimToNull, toNumber)
        .to(`number <= ${max} | null`)
        .configure(mustBe('数値'), 'union')
        .default(null);
};

const requiredId = () => {
    return type('string | number').pipe(toNumber).to('number.integer > 0').configure(mustBe('数値'), 'union');
};

// 更新時に残す既存行の ID。新しく足す行は null
const optionalId = () => {
    return type('string | number | null')
        .pipe(trimToNull, toNumber)
        .to('number.integer > 0 | null')
        .configure(mustBe('数値'), 'union')
        .default(null);
};

// 省略（現状維持）と []（全削除）を db 層が見分けるので既定値を入れない
const rows = (rowSchema) => {
    return rowSchema.array().optional();
};

const branchName = () => {
    return requiredText(255).default('main');
};

const commitHash = () => {
    return type(/^[0-9a-zA-Z]{1,64}$/).describe('コミットハッシュ');
};

// .default() はオブジェクトの項目にしか効かないので、単体で使う forkTypeSchema 用に undefined を読み替える
const forkType = (allowed, fallback) => {
    const kinds = type('undefined').pipe(() => fallback).or(type.enumerated(...allowed));
    return kinds.configure(mustBe(`${allowed.join('か')}のどれか`), 'union');
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

// parent_recipe_id はクライアントに決めさせない（:id から service 層が決める）
const recipeSchema = type({
    title: requiredText(255),
    description: optionalText(),
    default_branch: branchName(),
    thumbnail: optionalText(255),
    recipe_status: type.enumerated('public', 'private', 'public_draft', 'private_draft').default('public'),
    fork_type: forkType(['original', 'arrange', 'port'], 'original').default('original'), // port = 別の環境・人数に作り直したもの
    environment: rows(environmentSchema),
    ingredients: rows(ingredientSchema),
    steps: rows(stepSchema),
    commit_message: optionalText(255)
});

const forkTypeSchema = forkType(['arrange', 'port'], 'arrange');

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
