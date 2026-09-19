# cookhub

Dolt（MySQL互換のバージョン管理データベース）を基盤とした、レシピのバージョン管理サービス。
レシピを GitHubのリポジトリになぞらえて扱い、作成・編集・フォーク・プルリクエストの
たびに Dolt のコミットとして履歴が残る。

## 構成

```
cookhub/
├── docker-compose.yml   # Dolt / Adminer
├── dolt/data/           # Dolt のデータ (docker volume)
└── api/                 # Node.js (Express) API サーバー
    ├── server.js         # エントリポイント
    └── src/
        ├── app.js            # Express アプリ定義・エラーハンドラ
        ├── config.js         # .env の読み込みと検証
        ├── routes/           # HTTPルーティング
        ├── middleware/       # 認証・パラメータ検証・非同期ラッパー
        ├── schemas/          # zod による入力スキーマ（型・必須・上限の定義）
        ├── services/         # ビジネスロジック（権限判定・レスポンス整形）
        ├── clients/          # Dolt のバージョン管理操作
        └── db/               # Dolt への接続・クエリ・スキーマ定義
```

### レイヤーごとの役割と語彙

DBのテーブル・カラムは `recipe_id` / `repos_information` のように**レシピ**の語彙で、
外部に公開するAPIは `repo` / `commit` / `fork` のように**リポジトリ**の語彙で書かれている。
両者の翻訳は service 層の `toRepo()` / `toCommit()` に集約する。

| 層 | 語彙 | 責務 |
| --- | --- | --- |
| `db/` | recipe | 生の永続化操作のみ。権限チェックもレスポンス整形もしない |
| `schemas/` | repo / commit | 受け付ける入力の型・必須・上限の定義。zod スキーマだけを置く |
| `services/` | repo / commit | 権限判定、スキーマによる入力検証、DB行→APIレスポンスへの変換 |
| `routes/` | repo / commit | HTTPの入出力のみ。`req.account?.user_id` を service に渡すだけ |

service層の関数名は、内部で権限チェックを行うものだけ `Checked` を含む
（`getCheckedRepoDetail` / `updateCheckedRepository` など）。`require*`（`requireViewableRepo`,
`requireAdministrableRepo`）は「権限が無ければ例外を投げる」という意味で統一している。

### 入力の検証

外から来る値はすべて `api/src/schemas/` の zod スキーマを通してから処理に入る。スキーマは
DBの列定義（型・NOT NULL・`VARCHAR` の長さ）をそのまま写したもので、既定値の補完も兼ねる。
db層はこのスキーマを通った値しか受け取らないので、型の整形や既定値の補完をしない。

| 対象 | 検証する場所 |
| --- | --- |
| パスパラメータ | `middleware/validateParams.js`。検証後の `req.params.id` は数値になる |
| ボディ | service層（`recipeSchema` / `pullRequestSchema` など） |
| アクセストークン | `middleware/auth.js`。40文字の16進文字列でなければDBを引かずに `401` |
| 環境変数 | `config.js`。起動時に検証し、設定が壊れていればその場でサーバーが落ちる |

スキーマに合わない値は `400` になり、どの項目が駄目だったのかが `error` に入る。

```json
{ "error": "ingredients.0.amount: 無効な入力: 数値が期待されましたが、NaNが入力されました" }
```

### インフラ (docker-compose.yml)

| サービス  | 役割                                  | 公開ポート |
| --------- | ------------------------------------- | ---------- |
| `dolt`    | Dolt SQL Server (MySQL互換, DB名 `cookhub`) | 3306       |
| `adminer` | DB管理用Web UI                        | 8084       |

`api/src/db/sql/` は `/docker-entrypoint-initdb.d` としてマウントされており、**初回起動時に
一度だけ**実行される。

| テーブル               | 役割                                                             |
| ---------------------- | ---------------------------------------------------------------- |
| `accounts`             | アカウント本体。パスワードは bcrypt ハッシュのみ保存する         |
| `access_tokens`        | アクセストークン。SHA-256 ハッシュのみ保存する                   |
| `repos_information`    | レシピ本体（`title`, `is_private`, `parent_recipe_id` など）     |
| `recipe_environment`   | 必須環境（調理器具・人数など）の key/value                       |
| `recipe_ingredients`   | 材料                                                             |
| `recipe_steps`         | 手順                                                             |
| `recipe_pull_requests` | プルリクエスト（`source_recipe_id` → `target_recipe_id`）        |

初期化スクリプトは外部キーの依存順に番号が振られており、上の表と同じ順で実行される。

```
01_init_accounts_table.sql            accounts
02_init_access_tokens_table.sql       access_tokens
03_init_repos_information_table.sql   repos_information
04_init_recipe_environment.sql        recipe_environment
05_init_recipe_ingredients.sql        recipe_ingredients
06_init_recipe_steps.sql              recipe_steps
07_init_recipe_pull_requests.sql      recipe_pull_requests
99_dolt_commit.sql                    初期スキーマを Dolt にコミットする
```

### Dolt のバージョン管理

書き込みのあとに `CALL DOLT_COMMIT` を実行し、データの変更履歴を Dolt のコミットとして残す。
コミットの author には操作したユーザーの username / email が入る。履歴は SQL から参照できる。

```sql
SELECT commit_hash, author, message FROM dolt_log ORDER BY commit_order DESC;
SELECT * FROM dolt_status;        -- 未コミットの変更
SELECT * FROM dolt_diff('HEAD~1', 'HEAD', 'repos_information');
```

コミットが不要な場合は `api/.env` で `DOLT_AUTO_COMMIT=false` にする。コミットに失敗しても
APIのレスポンスは成功のまま（`commit` が `null` になる）、エラーはログにのみ出力する。

## セットアップ

### 1. インフラの起動

リポジトリ直下に `.env` を用意する。

```env
DOLT_ROOT_PASSWORD=xxxxx     # Dolt の root ユーザー (コンテナ内からのみ接続可)
COOKHUB_DB_PASSWORD=xxxxx    # API が使う cookhub ユーザーのパスワード
```

```bash
docker compose up -d
```

### 2. APIサーバーの起動

`api/.env` を用意する。

```env
DOLT_HOST=127.0.0.1
DOLT_PORT=3306
DOLT_USER=cookhub
DOLT_PASSWORD=xxxxx          # COOKHUB_DB_PASSWORD と同じ値
DOLT_DATABASE=cookhub
DOLT_AUTO_COMMIT=true        # 書き込みのたびにDoltコミットを作る
PORT=3001                    # 任意 (デフォルト: 3001)
```

```bash
cd api
npm install
npm start
```

`api/.env` の値は起動時に検証される。`DOLT_PORT` が数値でないといった設定ミスがあると、
接続に失敗するまで待たずに、どの項目が悪いのかを表示して起動を止める。

## 認証

`register` / `login` で発行されたトークンを `Authorization` ヘッダーに載せる。

```
Authorization: Bearer <token>
```

アクセストークンは40文字の16進文字列で、有効期限は無い。DBには SHA-256 ハッシュしか
保存しないため、発行時のレスポンス以外で値を確認することはできない。ログインのたびに
新しいトークンが発行されるので、不要になった古いトークンは `access_tokens` テーブルから
適宜削除すること。

エンドポイントは認証の要否で3種類に分かれる。

| 種別 | 挙動 |
| --- | --- |
| 必須 | トークンが無い／無効なら `401` を返し、処理に入らない |
| 任意 | トークンがあれば閲覧者として扱う。無ければ未ログイン扱いで続行する（トークンを渡したのに無効な場合は `401`） |
| 不要 | `register` / `login` のみ |

## API一覧

「ボディ」の **必須** は送らないとエラーになるもの、**任意** は送っても送らなくてもよいもの、
**なし** は送っても一切読まれないもの。

| メソッド | パス | 認証 | ボディ | 概要 |
| --- | --- | --- | --- | --- |
| POST | `/api/accounts/register` | 不要 | 必須 `username` `email` `password` | アカウント作成 + トークン発行 |
| POST | `/api/accounts/login` | 不要 | 必須 `username` `password` | ログイン + トークン発行 |
| GET | `/api/accounts/session` | 必須 | なし | ログイン状態の確認 |
| POST | `/api/repos` | 必須 | 必須 `title` | レシピ作成 |
| GET | `/api/repos/mine` | 必須 | なし | 自分のレシピ一覧 |
| GET | `/api/repos/trend` | 任意 | なし | 公開レシピ一覧 |
| GET | `/api/repos/:id` | 任意 | なし | レシピ詳細 |
| GET | `/api/repos/:id/commits` | 任意 | なし | 変更履歴の一覧 |
| GET | `/api/repos/:id/commits/:commitId` | 任意 | なし | 変更履歴1件の詳細 |
| POST | `/api/repos/:id/fork` | 必須 | 任意（全項目） | レシピを複製（アレンジ / 移植） |
| PATCH | `/api/repos/:id` | 必須 | 必須 `title` | レシピ編集（オーナーのみ） |
| DELETE | `/api/repos/:id` | 必須 | なし | レシピ削除（オーナーのみ） |
| POST | `/api/repos/:id/pull-request/create` | 必須 | 必須 `title` | プルリクエスト作成（`:id` = 自分のフォーク） |
| POST | `/api/repos/:id/pull-request/merge` | 必須 | 任意 `commit_message` のみ | プルリクエストのマージ（`:id` = **プルリクエストのID**） |

`Content-Type: application/json` を付けてボディを送る場合、JSONとして壊れていると
`400` になる（ボディを送らないときはヘッダーごと省略してよい）。

`:id` は数値でなければ `400` を返す。`:commitId` は Dolt のコミットハッシュなので数値ではなく、
英数字以外が混ざっていれば `400`、形は正しいが存在しなければ `404` になる。

## API仕様

### POST /api/accounts/register

必要なもの: **ボディのみ**。トークンは要らない。

```json
{ "username": "string", "email": "string", "password": "string" }
```

`username` は255文字まで、`email` はメールアドレスの形式で255文字まで、`password` は72文字まで
（bcrypt が73文字目以降を見ないため、黙って切り捨てずに弾く）。

- `201`: 作成されたアカウント情報 + `token`
- `400`: 必須項目不足・形式違い
- `409`: username/email が既に使われている

### POST /api/accounts/login

必要なもの: **ボディのみ**。トークンは要らない。

```json
{ "username": "string", "password": "string" }
```

- `200`: アカウント情報 + `token`
- `400`: 必須項目不足
- `401`: 認証失敗（トークンの形式が違う場合もここに含む）

### GET /api/accounts/session

必要なもの: **トークンのみ**。ボディは読まれない。

- `200`: アカウント情報
- `401`: トークンが未指定または無効

### POST /api/repos

必要なもの: **トークン**（作成者になる）＋ **ボディ**。
ボディの必須項目は `title`（または `name`）だけで、他はすべて任意。

```json
{
  "title": "肉じゃが",
  "description": "定番の肉じゃが",
  "is_private": false,
  "is_draft": false,
  "thumbnail": "https://example.com/a.png",
  "environment": [{ "key_name": "人数", "value": "2人分" }],
  "ingredients": [{ "name": "じゃがいも", "amount": 3, "unit": "個" }],
  "steps": [{ "body": "じゃがいもを切る", "image_url": null }],
  "commit_message": "任意。省略時は「レシピ作成: <title>」"
}
```

`is_private` / `is_draft` は真偽値、`ingredients[].amount` は数値（`"3"` のような数字の文字列も
受け付ける）。「少々」のように数量が無い材料は `amount` / `unit` を省略するか `null` にする。
文字列の長さはDBの列に合わせて、`title` / `thumbnail` / `key_name` / `value` / 材料名が255文字、
`unit` が50文字まで。`commit_message` は送るなら空文字以外。

- `201`: `{ "ok": true, "commit": "<コミットハッシュ>", "data": {...} }`
- `400`: `title`（または `name`）が無い / 型・長さがスキーマに合わない
- `401`: トークンが未指定または無効
- `409`: 同じ名前のレシピを既に持っている

### GET /api/repos/mine

必要なもの: **トークンのみ**（そのトークンの持ち主のレシピを返す）。ボディは読まれない。

- `200`: `{ "ok": true, "data": [...] }` — 自分のレシピを作成日時の新しい順に返す（非公開も含む）

### GET /api/repos/trend

必要なもの: **なし**。トークンは任意で、付けると自分のレシピの
`permissions.admin` が `true` になる（返る件数は変わらない）。

- `200`: `{ "ok": true, "data": [...] }` — 公開レシピを作成日時の新しい順に最大100件取得し、
  `stars_count` の降順に並べ替えたもの

```json
{
  "id": 1,
  "name": "肉じゃが",
  "full_name": "tanaka/肉じゃが",
  "description": "定番の肉じゃが",
  "owner": { "user_id": 1, "username": "tanaka" },
  "private": false,
  "draft": false,
  "thumbnail": null,
  "permissions": { "admin": false, "push": false, "pull": true },
  "default_branch": "main",
  "fork": false,
  "fork_type": 0,
  "parent_id": null,
  "stars_count": 0,
  "created_at": "2026-09-13T06:33:10.000Z",
  "updated_at": "2026-09-13T06:33:10.000Z"
}
```

`permissions` は閲覧者から見た権限で、`admin`（オーナーか）、`push`（= `admin`）、
`pull`（公開レシピか、オーナー自身）を持つ。

### GET /api/repos/:id

必要なもの: 公開レシピなら**なし**。非公開レシピはオーナーのトークンが要る（無いと `403`）。

- `200`: レシピ詳細。一覧の形に加えて `environment` / `ingredients` / `steps` と、
  直近のコミット `latest_commit` が入る
- `400`: `:id` が数値でない
- `403`: 非公開レシピで、自分のものではない
- `404`: レシピが無い

### GET /api/repos/:id/commits

必要なもの: `GET /api/repos/:id` と同じ。

- `200`: そのレシピに触れたコミットを新しい順に最大100件。材料や手順だけの変更も含む
- `400` / `403` / `404`: 上と同じ

コミット1件はこの形。`GET /api/repos/:id` の `latest_commit` も同じ。
日時のキーはレシピ本体の `created_at` ではなく `date`。

```json
{
  "sha": "vs1l2rrki3msk3vcbgn5pmcltab7kc7i",
  "message": "レシピ更新: 肉じゃが",
  "author": { "username": "tanaka", "email": "tanaka@example.com" },
  "date": "2026-09-17T10:41:58.000Z"
}
```

### GET /api/repos/:id/commits/:commitId

必要なもの: `GET /api/repos/:id` と同じ。`:commitId` は `GET /api/repos/:id/commits` の `sha`。

- `200`: コミット1件の詳細。`changes` にそのコミットで変わった内容が
  `info` / `environment` / `ingredients` / `steps` ごとに入り、各行は `diff_type`
  （`added` / `modified` / `removed`）と変更前 `from_*` / 変更後 `to_*` の値を持つ
- `403`: 非公開レシピで、自分のものではない
- `404`: レシピまたはコミットが無い

### POST /api/repos/:id/fork

必要なもの: **トークン**（複製したレシピのオーナーになる）。ボディは**任意**で丸ごと省略できる。
`:id` は**複製したい元レシピ**のID。材料・手順・必須環境は
元レシピをそのまま引き継ぎ、渡した項目だけが上書きされる。

```json
{
  "fork_type": 1,
  "title": "肉じゃが（砂糖ひかえめ）",
  "ingredients": [{ "name": "砂糖", "amount": 10, "unit": "g" }]
}
```

`fork_type` は `1` = アレンジ（デフォルト）、`2` = 移植（別の環境・人数に作り直したもの）。
元レシピは `parent_recipe_id` に残るので、あとから派生をたどれる。レシピ名は `title` でも
`name` でも指定でき、どちらも送らなければ元レシピと同じ名前になる。

- `201`: 複製されたレシピ。`fork: true` と派生元の `parent_id` が入る
- `400`: `fork_type` が 1 / 2 以外
- `401`: トークンが未指定または無効
- `403`: 非公開レシピで、自分のものではない
- `404`: 元レシピが無い
- `409`: 同じ名前のレシピを既に持っている（`title` を指定して複製する）

### PATCH /api/repos/:id

必要なもの: **オーナーのトークン**（他人のレシピは `403`）＋ **ボディ**。
ボディは `POST /api/repos` と同じ形だが、**送られてきた項目だけ**が書き換わり、
省略した項目は現状維持になる（`title` も省略できる）。
`environment` / `ingredients` / `steps` は**配列を渡したときだけ**丸ごと差し替えられる
（省略すれば現状維持、`[]` を渡せば全削除）。

子テーブルの各行には `GET /api/repos/:id` で返る `id` を付けて送れる。付けた行は
その既存行の書き換えになり、付けなかった行は**配列の並び順**で既存行に当てはめられる
（余った既存行は削除、足りないぶんは追加）。どちらの送り方でも、中身が変わっていない
行は変更履歴の差分に出てこない。行の並べ替えだけをした場合は、動いた行が
`modified` として差分に並ぶ。

- `200`: 更新後のレシピ
- `400`: `title`（または `name`）が無い / 型・長さがスキーマに合わない / `:id` が数値でない
- `403`: 自分のレシピではない
- `404`: レシピが無い

### DELETE /api/repos/:id

必要なもの: **オーナーのトークンのみ**（他人のレシピは `403`）。ボディは読まれない。
材料・手順・必須環境・そのレシピが関わるプルリクエストも一緒に削除される。

- `200`: `{ "ok": true, "commit": "...", "data": { "id": 1 } }`
- `403`: 自分のレシピではない
- `404`: レシピが無い

### POST /api/repos/:id/pull-request/create

`:id` は**自分のフォーク**（提案元）のレシピID。取り込み先はそのフォーク元
（`parent_recipe_id`）が自動的に使われるので、ボディで指定する必要は無い。
フォークではないレシピを指定すると `400` になる。

必要なもの: **トークン**（`:id` のフォークのオーナーであること。他人のレシピを指定すると `403`）
＋ **ボディ**。`title` のみ必須項目で、`content` は説明文、`commit_message` の省略時は
`プルリクエスト作成: <title>`。

```json
{
  "title": "砂糖を減らしたい",
  "content": "10g だと甘すぎたので 5g にしました"
}
```

- `201`: 作成されたプルリクエスト。**この `data.id` がマージに使うID**

```json
{
  "ok": true,
  "commit": "vs1l2rrki3msk3vcbgn5pmcltab7kc7i",
  "data": {
    "id": 7,
    "target_recipe_id": 1,
    "source_recipe_id": 2,
    "user_id": 5,
    "title": "砂糖を減らしたい",
    "content": "10g だと甘すぎたので 5g にしました",
    "status": 0,
    "merged_commit_hash": null,
    "created_at": "2026-09-17T10:41:58.000Z",
    "updated_at": "2026-09-17T10:41:58.000Z",
    "merged_at": null
  }
}
```

- `400`: `title` が無い / フォーク元が無いレシピを指定した / `:id` が数値でない
- `401`: トークンが未指定または無効
- `403`: 指定したレシピが自分のものではない
- `404`: レシピが無い

### POST /api/repos/:id/pull-request/merge

`:id` は**プルリクエストのID**（レシピIDではない）。`pull-request/create` のレスポンスの
`data.id` を使う。PRの一覧取得APIはまだ無いので、この値は作成時に控えておく必要がある。

マージできるのは**取り込み先（フォーク元）のオーナー**だけ。提案したユーザー自身は
マージできない（`403`）。

必要なもの: **取り込み先レシピのオーナーのトークンのみ**。ボディは**任意**で、
読まれるのは `commit_message` だけ。省略時は
`プルリクエストをマージ: <PRのtitle>` になる。ボディごと省略しても `200` で通る。

提案元レシピの**説明・必須環境・材料・手順**が取り込み先に丸ごと書き写される
（取り込み先の既存の材料・手順は置き換えられる）。タイトル・公開設定・サムネイルなど
取り込み先自身の属性は変わらない。提案元のレシピはそのまま残る。

- `200`: マージ後のプルリクエスト。`status` が `1`、`merged_at` と
  `merged_commit_hash` が埋まる
- `400`: `:id` が数値でない
- `401`: トークンが未指定または無効
- `403`: 取り込み先のオーナーではない（提案者自身がマージしようとした場合を含む）
- `404`: プルリクエストが無い
- `409`: 既にマージ済み
