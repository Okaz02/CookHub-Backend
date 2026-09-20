const { type } = require('arktype');

// fork_type はそのレシピの生まれ方を表す。
// 0 = オリジナル（フォークではない）/ 1 = アレンジ / 2 = 移植（別の環境・人数に作り直したもの）
const FORK_TYPE_ORIGINAL = 0;
const FORK_TYPE_ARRANGE = 1;
const FORK_TYPE_PORT = 2;

// 弾いたときにどれを指しているのかが分かるように、エラーメッセージでは番号に呼び名を添える
const forkTypeLabels = {
    [FORK_TYPE_ORIGINAL]: '0（オリジナル）',
    [FORK_TYPE_ARRANGE]: '1（アレンジ）',
    [FORK_TYPE_PORT]: '2（移植）'
};

// 文字列は必ず前後の空白を落としてから保存する。落とさないと「 少々」と「少々」が別の値として
// DBに入り、見た目が同じなのに変更履歴に「 少々 → 少々」という差分が出てしまう。
// 空白しか入っていない値は「未入力」として null にそろえる。'' のまま通すと「値なし」が
// null と '' の2通りでDBに入り、変更履歴に「少々 →（空）」のような中身の無い差分が出る。
// 数値の項目では '' がそのまま 0 に化けてしまう（「少々」が「0g」になる）ので、
// 数値に読み替えるより先にここで落としておく必要がある
const trimToNull = (value) => {
    if (typeof value !== 'string') {
        return value;
    }

    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
};

// NULL 可の列の「未入力」
const noValue = type('null').describe('未入力');

// --- 列の形ごとのスキーマ ---------------------------------------------------
// 型を1つずつ書き下すと、その項目が結局どういう値を受け付けるのかが読み取りにくい。
// 列の形ごとに名前を付けて、使う側は requiredText(255) のように
// 「どの列に入るのか」だけを書く。
//
// max は DB の列定義（api/src/db/sql/）の文字数・桁に合わせる。
// 超えた値は Dolt 側で黙って切り捨てられてしまうので、その手前で弾く。

// NOT NULL の文字列。空白だけの入力は未入力として弾く。
// max を渡さない場合は TEXT 列（実用上の上限が無い）
const requiredText = (max) => {
    const length = max === undefined ? 'string >= 1' : `1 <= string <= ${max}`;
    // string.trim は前後の空白を落とす読み替え。長さは落としたあとの文字列で見る
    return type('string.trim').describe('文字列').to(length);
};

// NULL 可の文字列。未入力・空白だけ・項目そのものの省略はすべて null にそろえる
const optionalText = (max) => {
    const length = max === undefined ? 'string' : `string <= ${max}`;
    const text = type(length).describe('文字列').or(noValue);
    return type('string | null').pipe(trimToNull).to(text).default(null);
};

// NULL 可の数値。フォームから来る文字列（'2.5'）も数値として受け付ける
const optionalNumber = (max) => {
    const amount = type(`number <= ${max}`).describe('数値');
    const number = amount.or(type('string.numeric.parse').describe('数値').to(amount)).or(noValue);
    return type('string | number | null').pipe(trimToNull).to(number).default(null);
};

// 行ID。URL の :id やフォームから来る文字列（'12'）も数値として受け付ける
const requiredId = () => {
    const id = type('number.integer > 0').describe('数値');
    return id.or(type('string.integer.parse').describe('数値').to(id));
};

// NULL 可の行ID。更新時に「残す既存行」を指し、新しく足す行では null
const optionalId = () => {
    return type('string | number | null').pipe(trimToNull).to(requiredId().or(noValue)).default(null);
};

// 真偽値。省略時は false
const flag = () => {
    return type('boolean').default(false);
};

// 子テーブルの行の配列。「省略＝現状維持」と「[] ＝全削除」を db 層が見分けるので、
// 既定値を入れずに省略可のままにしておく
const rows = (rowSchema) => {
    return rowSchema.array().optional();
};

// 項目そのものが省略されたとき（undefined）に既定値を使う。
// arktype の .default() はオブジェクトの項目にしか使えないので、
// 単体で使うスキーマ（forkTypeSchema）の省略時の値はこちらで決める
const orFallback = (schema, fallback) => {
    return type('undefined').pipe(() => fallback).or(schema);
};

// --- 個別の値ごとのスキーマ -------------------------------------------------

// ブランチ名。省略時は recipes.default_branch の既定値と同じ 'main'
const branchName = () => {
    return requiredText(255).default('main');
};

// Dolt のコミットハッシュ。数値ではないので英数字であることだけを見る
const commitHash = () => {
    return type(/^[0-9a-zA-Z]{1,64}$/).describe('コミットハッシュ');
};

// レシピの生まれ方。allowed のどれか
const forkType = (allowed) => {
    const labels = allowed.map((kind) => forkTypeLabels[kind]).join('か');
    const message = () => `${labels}のどれかで指定してください`;
    // 弾かれた理由は「どの番号でもない」の一言で足りるので、番号ごとの内訳は出さない
    return type(allowed.join(' | ')).configure({ problem: message }, 'self');
};

// --- 各テーブルの入力 -------------------------------------------------------

// 必須環境（recipe_environment）の1行
const environmentSchema = type({
    id: optionalId(),
    key_name: requiredText(255),
    value: requiredText(255)
});

// 材料（recipe_ingredients）の1行。「少々」のように数量が無いものは amount / unit とも null
const ingredientSchema = type({
    id: optionalId(),
    name: requiredText(255),
    amount: optionalNumber(99999999.99), // DECIMAL(10, 2)
    unit: optionalText(50)
});

// 手順（recipe_steps）の1行
const stepSchema = type({
    id: optionalId(),
    body: requiredText(), // TEXT NOT NULL
    image_url: optionalText(255)
});

// レシピ本体（recipes）と子テーブルの入力。POST /api/recipes と PATCH /api/recipes/:id の
// ボディはこの形で、db 層はここを通った値しか受け取らない。
// commit_message の省略時（null）の既定値は service 層が組み立てる。
// parent_recipe_id はクライアントに決めさせない（フォーク元は :id から service 層が決める）
const recipeSchema = type({
    title: requiredText(255),
    description: optionalText(),
    default_branch: branchName(),
    thumbnail: optionalText(255),
    is_private: flag(),
    is_draft: flag(),
    fork_type: forkType([FORK_TYPE_ORIGINAL, FORK_TYPE_ARRANGE, FORK_TYPE_PORT]).default(FORK_TYPE_ORIGINAL),
    environment: rows(environmentSchema),
    ingredients: rows(ingredientSchema),
    steps: rows(stepSchema),
    commit_message: optionalText(255)
});

// フォークで作られるレシピはオリジナル(0)にはならない。省略時はアレンジ
const forkTypeSchema = orFallback(forkType([FORK_TYPE_ARRANGE, FORK_TYPE_PORT]), FORK_TYPE_ARRANGE);

// プルリクエスト（recipe_pull_requests）作成のボディ
const pullRequestSchema = type({
    title: requiredText(255),
    content: optionalText(),
    commit_message: optionalText(255)
});

// マージのボディ。読むのは commit_message だけ
const mergeSchema = type({
    commit_message: optionalText(255)
});

// :id はレシピID（/pull-request/merge だけはプルリクエストID）。検証後は数値になる
const recipeParamsSchema = type({
    id: requiredId()
});

// :commitId は Dolt のコミットハッシュ
const commitParamsSchema = recipeParamsSchema.merge({
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
