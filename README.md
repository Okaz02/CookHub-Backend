# cookhub

Dolt（MySQL互換のバージョン管理データベース）を基盤とした、レシピのバージョン管理サービス。
レシピを GitHub / Gitea のリポジトリになぞらえて扱い、作成・編集・フォーク・プルリクエストの
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
        ├── routes/           # HTTPルーティング
        ├── middleware/       # 認証・パラメータ検証・非同期ラッパー
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
| `services/` | repo / commit | 権限判定、入力検証、DB行→APIレスポンスへの変換 |
| `routes/` | repo / commit | HTTPの入出力のみ。`req.account?.user_id` を service に渡すだけ |

service層の関数名は、内部で権限チェックを行うものだけ `Checked` を含む
（`getCheckedRepoDetail` / `updateCheckedRepository` など）。`require*`（`requireViewableRepo`,
`requireAdministrableRepo`）は「権限が無ければ例外を投げる」という意味で統一している。

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

コミットは `-A`（その時点の未コミット変更をすべて含む）で作られるため、無関係なテーブルの
変更も同じコミットに入る。コミットが不要な場合は `api/.env` で `DOLT_AUTO_COMMIT=false` に
する。コミットに失敗してもAPIのレスポンスは成功のまま、エラーはログにのみ出力する。

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

| メソッド | パス | 認証 | 概要 |
| --- | --- | --- | --- |
| POST | `/api/accounts/register` | 不要 | アカウント作成 + トークン発行 |
| POST | `/api/accounts/login` | 不要 | ログイン + トークン発行 |
| GET | `/api/accounts/session` | 必須 | ログイン状態の確認 |
| POST | `/api/repos` | 必須 | レシピ作成 |
| GET | `/api/repos/mine` | 必須 | 自分のレシピ一覧 |
| GET | `/api/repos/trend` | 任意 | 公開レシピ一覧 |
| GET | `/api/repos/:id` | 任意 | レシピ詳細 |
| GET | `/api/repos/:id/commits` | 任意 | 変更履歴の一覧 |
| GET | `/api/repos/:id/commits/:commitId` | 任意 | 変更履歴1件の詳細 |
| POST | `/api/repos/:id/fork` | 必須 | レシピを複製（アレンジ / 移植） |
| PATCH | `/api/repos/:id` | 必須 | レシピ編集（オーナーのみ） |
| DELETE | `/api/repos/:id` | 必須 | レシピ削除（オーナーのみ） |
| POST | `/api/repos/:id/pull-request/create` | 必須 | プルリクエスト作成（`:id` = 自分のフォーク） |
| POST | `/api/repos/:id/pull-request/merge` | 必須 | プルリクエストのマージ（`:id` = **プルリクエストのID**） |

`:id` と `:commitId` のうち `:id` は数値でなければ `400` を返す。`:commitId` は Dolt の
コミットハッシュ（英数字）なので数値検証の対象外で、存在しなければ `404` になる。

## API仕様

### POST /api/accounts/register

```json
{ "username": "string", "email": "string", "password": "string" }
```

- `201`: 作成されたアカウント情報 + `token`
- `400`: 必須項目不足
- `409`: username/email が既に使われている

### POST /api/accounts/login

```json
{ "username": "string", "password": "string" }
```

- `200`: アカウント情報 + `token`
- `400`: 必須項目不足
- `401`: 認証失敗

### GET /api/accounts/session

- `200`: アカウント情報
- `401`: トークンが未指定または無効

### POST /api/repos

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

- `201`: `{ "ok": true, "commit": "<コミットハッシュ>", "data": {...} }`
- `400`: `title`（または `name`）が無い
- `401`: トークンが未指定または無効
- `409`: 同じ名前のレシピを既に持っている

### GET /api/repos/mine

- `200`: `{ "ok": true, "data": [...] }` — 自分のレシピを作成日時の新しい順に返す（非公開も含む）

### GET /api/repos/trend

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

- `200`: レシピ詳細。一覧の形に加えて `environment` / `ingredients` / `steps` と、
  直近のコミット `latest_commit` が入る
- `403`: 非公開レシピで、自分のものではない
- `404`: レシピが無い

### GET /api/repos/:id/commits

- `200`: そのレシピに触れたコミットを新しい順に最大100件。材料や手順だけの変更も含む
- `403` / `404`: 上と同じ

### GET /api/repos/:id/commits/:commitId

- `200`: コミット1件の詳細。`changes` にそのコミットで変わった内容が
  `info` / `environment` / `ingredients` / `steps` ごとに入り、各行は `diff_type`
  （`added` / `modified` / `removed`）と変更前 `from_*` / 変更後 `to_*` の値を持つ
- `403`: 非公開レシピで、自分のものではない
- `404`: レシピまたはコミットが無い

### POST /api/repos/:id/fork

```json
{
  "fork_type": 1,
  "title": "肉じゃが（砂糖ひかえめ）",
  "ingredients": [{ "name": "砂糖", "amount": 10, "unit": "g" }]
}
```

元レシピを自分のレシピとして複製する。body はすべて任意で、材料・手順・必須環境は
元レシピをそのまま引き継ぎ、渡した項目だけが上書きされる（body が空なら丸ごとコピー）。
`fork_type` は `1` = アレンジ（デフォルト）、`2` = 移植（別の環境・人数に作り直したもの）。
元レシピは `parent_recipe_id` に残るので、あとから派生をたどれる。

- `201`: 複製されたレシピ。`fork: true` と派生元の `parent_id` が入る
- `400`: `fork_type` が 1 / 2 以外
- `401`: トークンが未指定または無効
- `403`: 非公開レシピで、自分のものではない
- `404`: 元レシピが無い
- `409`: 同じ名前のレシピを既に持っている（`title` を指定して複製する）

### PATCH /api/repos/:id

body は `POST /api/repos` と同じ。`environment` / `ingredients` / `steps` は配列を
渡したときだけ差し替えられる（省略すれば現状維持）。

- `200`: 更新後のレシピ
- `400`: `title`（または `name`）が無い / `:id` が数値でない
- `403`: 自分のレシピではない
- `404`: レシピが無い

### DELETE /api/repos/:id

- `200`: `{ "ok": true, "commit": "...", "data": { "id": 1 } }`
- `403`: 自分のレシピではない
- `404`: レシピが無い

### POST /api/repos/:id/pull-request/create

`:id` は**自分のフォーク**（提案元）のレシピID。取り込み先はそのフォーク元
（`parent_recipe_id`）が自動的に使われる。

```json
{
  "title": "砂糖を減らしたい",
  "content": "10g だと甘すぎたので 5g にしました",
  "commit_message": "任意"
}
```

- `201`: 作成されたプルリクエスト（`source_recipe_id` / `target_recipe_id` / `status` など）
- `400`: `title` が無い / フォーク元が無いレシピを指定した
- `403`: 自分のレシピではない
- `404`: レシピが無い

### POST /api/repos/:id/pull-request/merge

`:id` は**プルリクエストのID**（レシピIDではない）。マージできるのは取り込み先
（フォーク元）のオーナーだけ。

提案元レシピの**説明・必須環境・材料・手順**が取り込み先に書き写される。タイトルや
公開設定など取り込み先自身の属性は変わらない。

- `200`: マージ後のプルリクエスト（`status: 1`, `merged_at`, `merged_commit_hash`）
- `403`: 取り込み先のオーナーではない
- `404`: プルリクエストが無い
- `409`: 既にマージ済み

## 未実装

- **スター（いいね）**: `stars_count` カラムとレスポンスの項目はあるが、増減させる
  エンドポイントもテーブルも無いため、常に `0` のまま。`GET /api/repos/trend` の
  並べ替えも実質機能していない
- **プルリクエストのクローズ / 却下**: `status` は `0`（オープン）と `1`（マージ済み）
  しか使っていない
- レシピの家系図、通知、画像アップロード、タグ
