const { z } = require('zod');

// fork_type はそのレシピの生まれ方を表す。
// 0 = オリジナル（フォークではない）/ 1 = アレンジ / 2 = 移植（別の環境・人数に作り直したもの）
const FORK_TYPE_ORIGINAL = 0;
const FORK_TYPE_ARRANGE = 1;
const FORK_TYPE_PORT = 2;

// 項目そのものが無いときのメッセージ。長すぎるといった他の理由は zod に任せる
function requiredError(issue) {
    return issue.input === undefined ? '必須です' : undefined;
}

// 文字数の上限は DB の列定義（api/src/db/sql/）に合わせる。
// 超えた値は Dolt 側で黙って切り捨てられてしまうので、その手前で弾く
const requiredNameSchema = z.string({ error: requiredError }).min(1, '必須です').max(255); // VARCHAR(255) NOT NULL
const optionalNameSchema = z.string().max(255).nullable().default(null);                  // VARCHAR(255) NULL
const optionalTextSchema = z.string().nullable().default(null);                           // TEXT NULL

// 子テーブルの行の id。更新時に「残す既存行」を指し、新しく足す行では null
const childIdSchema = z.coerce.number().int().positive().nullable().default(null);

// Dolt のコミットメッセージ。省略時の既定値は service 層が組み立てる
const commitMessageSchema = z.string().min(1).optional();

// 必須環境（recipe_environment）の1行
const environmentSchema = z.object({
    id: childIdSchema,
    key_name: requiredNameSchema,
    value: requiredNameSchema
});

// 材料（recipe_ingredients）の1行。「少々」のように数量が無いものは amount / unit とも null。
// amount は DECIMAL(10, 2) なので、その桁に収まる数値だけを受け付ける
const ingredientSchema = z.object({
    id: childIdSchema,
    name: requiredNameSchema,
    amount: z.coerce.number().max(99999999.99).nullable().default(null),
    unit: z.string().max(50).nullable().default(null)
});

// 手順（recipe_steps）の1行
const stepSchema = z.object({
    id: childIdSchema,
    body: z.string({ error: requiredError }).min(1, '必須です'),
    image_url: optionalNameSchema
});

// レシピ本体（recipes）と子テーブルの入力。POST /api/recipes と PATCH /api/recipes/:id の
// ボディはこの形で、db 層はここを通った値しか受け取らない。
// environment / ingredients / steps だけは「省略＝現状維持」と「[] ＝全削除」を区別する必要が
// あるので、既定値を入れずに optional のままにしておく。
// parent_recipe_id はクライアントに決めさせない（フォーク元は :id から service 層が決める）
const recipeSchema = z.object({
    title: requiredNameSchema,
    description: optionalTextSchema,
    default_branch: z.string().min(1).max(255).default('main'),
    thumbnail: optionalNameSchema,
    is_private: z.boolean().default(false),
    is_draft: z.boolean().default(false),
    fork_type: z.literal([FORK_TYPE_ORIGINAL, FORK_TYPE_ARRANGE, FORK_TYPE_PORT])
        .default(FORK_TYPE_ORIGINAL),
    environment: z.array(environmentSchema).optional(),
    ingredients: z.array(ingredientSchema).optional(),
    steps: z.array(stepSchema).optional(),
    commit_message: commitMessageSchema
});

// フォークで作られるレシピはオリジナル(0)にはならない。省略時はアレンジ
const forkTypeSchema = z
    .literal([FORK_TYPE_ARRANGE, FORK_TYPE_PORT], 'fork_type は 1（アレンジ）か 2（移植）のどちらかです')
    .default(FORK_TYPE_ARRANGE);

// プルリクエスト（recipe_pull_requests）作成のボディ
const pullRequestSchema = z.object({
    title: requiredNameSchema,
    content: optionalTextSchema,
    commit_message: commitMessageSchema
});

// マージのボディ。読むのは commit_message だけ
const mergeSchema = z.object({
    commit_message: commitMessageSchema
});

// :id はレシピID（/pull-request/merge だけはプルリクエストID）。検証後は数値になる
const recipeParamsSchema = z.object({
    id: z.coerce.number({ error: '数値で指定してください' }).int().positive()
});

// :commitId は Dolt のコミットハッシュ。数値ではないので英数字であることだけを見る
const commitParamsSchema = recipeParamsSchema.extend({
    commitId: z.string().max(64).regex(/^[0-9a-zA-Z]+$/, 'コミットハッシュの形式で指定してください')
});

module.exports = {
    FORK_TYPE_PORT,
    recipeSchema,
    forkTypeSchema,
    pullRequestSchema,
    mergeSchema,
    recipeParamsSchema,
    commitParamsSchema
};
