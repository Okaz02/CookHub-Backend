const { type } = require('arktype');

// fork_type はそのレシピの生まれ方を表す。recipes.fork_type の ENUM と同じ名前で、
// APIのリクエスト・レスポンスもこの名前のまま扱う（DBとAPIで呼び方を変えない）
const FORK_TYPE_ORIGINAL = 'original'; // フォークではない
const FORK_TYPE_ARRANGE = 'arrange';   // アレンジ
const FORK_TYPE_PORT = 'port';         // 移植（別の環境・人数に作り直したもの）
const FORK_TYPES = [FORK_TYPE_ORIGINAL, FORK_TYPE_ARRANGE, FORK_TYPE_PORT];

// 弾いたときにどれを指しているのかが分かるように、エラーメッセージでは名前に訳を添える
const forkTypeLabels = {
    [FORK_TYPE_ORIGINAL]: 'original（オリジナル）',
    [FORK_TYPE_ARRANGE]: 'arrange（アレンジ）',
    [FORK_TYPE_PORT]: 'port（移植）'
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

// 受け付けない型（文字列の項目に数値が来た等）を弾いたときの文言。
// 「文字列 か 未入力 のどちらか」のような選択肢の言い換えは読みにくいので、
// 選択肢をまとめている型（union）にだけ、その列が何の値なのかを一言で付け直す
const mustBe = (name) => {
    return { problem: () => `${name}で指定してください` };
};

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
    return type('string | null').pipe(trimToNull).to(text).configure(mustBe('文字列'), 'union').default(null);
};

// フォームから来る文字列（'2.5'）や URL の :id を数値に読み替える。
// 桁数・範囲・整数かどうかは読み替えたあとの数値で見る。読み替えと一緒に見ると、
// 弾いた理由が「数値ではない」に丸められて、いくつまでなのかが伝わらなくなる
const toNumber = (value, ctx) => {
    if (typeof value !== 'string') {
        return value;
    }

    const number = Number(value);
    return Number.isNaN(number) ? ctx.error('数値') : number;
};

// NULL 可の数値。フォームから来る文字列（'2.5'）も数値として受け付ける
const optionalNumber = (max) => {
    return type('string | number | null')
        .pipe(trimToNull, toNumber)
        .to(`number <= ${max} | null`)
        .configure(mustBe('数値'), 'union')
        .default(null);
};

// 行ID。URL の :id やフォームから来る文字列（'12'）も数値として受け付ける
const requiredId = () => {
    return type('string | number').pipe(toNumber).to('number.integer > 0').configure(mustBe('数値'), 'union');
};

// NULL 可の行ID。更新時に「残す既存行」を指し、新しく足す行では null
const optionalId = () => {
    return type('string | number | null')
        .pipe(trimToNull, toNumber)
        .to('number.integer > 0 | null')
        .configure(mustBe('数値'), 'union')
        .default(null);
};

// 真偽値。省略時は false
const flag = () => {
    return type('boolean').configure(mustBe('真偽値'), 'union').default(false);
};

// 子テーブルの行の配列。「省略＝現状維持」と「[] ＝全削除」を db 層が見分けるので、
// 既定値を入れずに省略可のままにしておく
const rows = (rowSchema) => {
    return rowSchema.array().optional();
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

// レシピの生まれ方。allowed のどれかで、値が undefined なら fallback として読む。
// arktype の .default() はオブジェクトの項目にしか使えないので、単体で使う forkTypeSchema の
// 省略時の値はこの読み替えが決める（項目として使うときは .default() も併せて付ける）
const forkType = (allowed, fallback) => {
    const labels = allowed.map((kind) => forkTypeLabels[kind]).join('か');
    const kinds = type('undefined').pipe(() => fallback).or(type.enumerated(...allowed));
    // 名前をそのまま並べても何のことか分からないので、訳を添えた文言にする
    return kinds.configure(mustBe(`${labels}のどれか`), 'union');
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
    fork_type: forkType(FORK_TYPES, FORK_TYPE_ORIGINAL).default(FORK_TYPE_ORIGINAL),
    environment: rows(environmentSchema),
    ingredients: rows(ingredientSchema),
    steps: rows(stepSchema),
    commit_message: optionalText(255)
});

// フォークで作られるレシピは original にはならない。省略時はアレンジ
const forkTypeSchema = forkType([FORK_TYPE_ARRANGE, FORK_TYPE_PORT], FORK_TYPE_ARRANGE);

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
