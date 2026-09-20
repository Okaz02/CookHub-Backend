import { z }  from 'zod';


// 項目そのものが無いときのメッセージ。長すぎるといった他の理由は zod に任せる
const requiredError = (issue) => {
    return issue.input === undefined ? '必須です' : undefined;
}

// 空白しか入っていない値は「未入力」として扱う。'' のまま通すと「値なし」が null と ''
// の2通りでDBに入り、見た目が同じなのに変更履歴に「少々 →（空）」のような中身の無い
// 差分が出る。数値の項目では z.coerce.number() が '' を 0 に変えてしまう
// （「少々」が「0g」になる）ので、変換より先にここで落としておく必要がある
const blankToNull = (value) => {
    return typeof value === 'string' && value.trim() === '' ? null : value;
}

// --- 列の形ごとのスキーマ ---------------------------------------------------
// zod をそのまま書くとメソッドが延々と連なって、その項目が結局どういう値なのかが
// 読み取りにくい。列の形ごとに名前を付けて、使う側は requiredText(255) のように
// 「どの列に入るのか」だけを書く。
//
// max は DB の列定義（api/src/db/sql/）の文字数・桁に合わせる。
// 超えた値は Dolt 側で黙って切り捨てられてしまうので、その手前で弾く。
//
// 文字列は必ず前後の空白を落としてから保存する。落とさないと「 少々」と「少々」が
// 別の値としてDBに入り、見た目が同じなのに変更履歴に差分が出てしまう。
// .trim() は .min() / .max() より先に置く（トリム後の長さで判定させるため）。

// NOT NULL の文字列。空白だけの入力は未入力として弾く。
// max を渡さない場合は TEXT 列（実用上の上限が無い）
const requiredText = (max) => {
    const text = z.string({ error: requiredError }).trim().min(1, '必須です');
    return max === undefined ? text : text.max(max);
};

// NULL 可の文字列。未入力・空白だけ・項目そのものの省略はすべて null にそろえる
const optionalText = (max) => {
    const text = max === undefined ? z.string().trim() : z.string().trim().max(max);
    return z.preprocess(blankToNull, text.nullable()).default(null);
};  

// NULL 可の数値。フォームから来る文字列（'2.5'）も受け付ける
const optionalNumber = (max) => {
    return z.preprocess(blankToNull, z.coerce.number().max(max).nullable()).default(null);
};

// 行ID。URL の :id やフォームから来る文字列（'12'）も数値として受け付ける
const requiredId = () => {
    return z.coerce.number({ error: '数値で指定してください' }).int().positive();
};

// NULL 可の行ID。更新時に「残す既存行」を指し、新しく足す行では null
const optionalId = () => {
    return z.preprocess(blankToNull, requiredId().nullable()).default(null);
};

// 真偽値。省略時は false
const flag = () => {
    return z.boolean().default(false);
};

// 子テーブルの行の配列。「省略＝現状維持」と「[] ＝全削除」を db 層が見分けるので、
// 既定値を入れずに optional のままにしておく
const rows = (rowSchema) => {
    return z.array(rowSchema).optional();
};

// --- 個別の値ごとのスキーマ -------------------------------------------------

// ブランチ名。省略時は recipes.default_branch の既定値と同じ 'main'
const branchName = () => {
    return requiredText(255).default('main');
};

// Dolt のコミットハッシュ。数値ではないので英数字であることだけを見る
const commitHash = () => {
    return z.string().max(64).regex(/^[0-9a-zA-Z]+$/, 'コミットハッシュの形式で指定してください');
};

// レシピの生まれ方。allowed のどれか、省略時は fallback
const forkType = (allowed, fallback, message) => {
    return z.literal(allowed, message).default(fallback);
};

// --- 各テーブルの入力 -------------------------------------------------------

// 必須環境（recipe_environment）の1行
const environmentSchema = z.object({
    id: optionalId(),
    key_name: requiredText(255),
    value: requiredText(255)
});

// 材料（recipe_ingredients）の1行。「少々」のように数量が無いものは amount / unit とも null
const ingredientSchema = z.object({
    id: optionalId(),
    name: requiredText(255),
    amount: optionalNumber(99999999.99), // DECIMAL(10, 2)
    unit: optionalText(50)
});

// 手順（recipe_steps）の1行
const stepSchema = z.object({
    id: optionalId(),
    body: requiredText(), // TEXT NOT NULL
    image_url: optionalText(255)
});

// レシピ本体（recipes）と子テーブルの入力。POST /api/recipes と PATCH /api/recipes/:id の
// ボディはこの形で、db 層はここを通った値しか受け取らない。
// commit_message の省略時（null）の既定値は service 層が組み立てる。
// parent_recipe_id はクライアントに決めさせない（フォーク元は :id から service 層が決める）
const recipeSchema = z.object({
    title: requiredText(255),
    description: optionalText(),
    default_branch: branchName(),
    thumbnail: optionalText(255),
    is_private: flag(),
    is_draft: flag(),
    fork_type: forkType([FORK_TYPE_ORIGINAL, FORK_TYPE_ARRANGE, FORK_TYPE_PORT], FORK_TYPE_ORIGINAL),
    environment: rows(environmentSchema),
    ingredients: rows(ingredientSchema),
    steps: rows(stepSchema),
    commit_message: optionalText(255)
});

// フォークで作られるレシピはオリジナル(0)にはならない。省略時はアレンジ
const forkTypeSchema = forkType(
    [FORK_TYPE_ARRANGE, FORK_TYPE_PORT],
    FORK_TYPE_ARRANGE,
    'fork_type は 1（アレンジ）か 2（移植）のどちらかです'
);

// プルリクエスト（recipe_pull_requests）作成のボディ
const pullRequestSchema = z.object({
    title: requiredText(255),
    content: optionalText(),
    commit_message: optionalText(255)
});

// マージのボディ。読むのは commit_message だけ
const mergeSchema = z.object({
    commit_message: optionalText(255)
});

// :id はレシピID（/pull-request/merge だけはプルリクエストID）。検証後は数値になる
const recipeParamsSchema = z.object({
    id: requiredId()
});

// :commitId は Dolt のコミットハッシュ
const commitParamsSchema = recipeParamsSchema.extend({
    commitId: commitHash()
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
