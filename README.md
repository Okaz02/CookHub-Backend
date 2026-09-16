# cookhub

Dolt（MySQL互換のバージョン管理データベース）を基盤としたアカウント管理システム。
アカウントとリポジトリのデータは Dolt 上で管理され、更新のたびに Dolt のコミットとして
履歴が残る。

## 構成

```
cookhub/
├── docker-compose.yml   # Dolt / Adminer
├── dolt/data/           # Dolt のデータ (docker volume)
└── api/                 # Node.js (Express) API サーバー
    ├── server.js         # エントリポイント
    └── src/
        ├── app.js            # Express アプリ定義
        ├── routes/           # HTTPルーティング
        ├── services/         # ビジネスロジック
        ├── clients/          # Dolt のバージョン管理操作
        └── db/               # Dolt への接続・クエリ・スキーマ定義
```

### インフラ (docker-compose.yml)

| サービス  | 役割                                  | 公開ポート |
| --------- | ------------------------------------- | ---------- |
| `dolt`    | Dolt SQL Server (MySQL互換, DB名 `cookhub`) | 3306       |
| `adminer` | DB管理用Web UI                        | 8084       |

`api/src/db/sql/` は `/docker-entrypoint-initdb.d` としてマウントされており、**初回起動時に
一度だけ**実行されてテーブルを作成し、初期スキーマを Dolt にコミットする。

| テーブル        | 役割                                                     |
| --------------- | -------------------------------------------------------- |
| `accounts`      | アカウント本体。パスワードは bcrypt ハッシュのみ保存する |
| `access_tokens` | アクセストークン。SHA-256 ハッシュのみ保存する           |
| `repos`         | リポジトリのメタデータ (`stars_count` など)              |

### API (api/)

Express製のAPIサーバー。`/api/accounts` 配下でアカウントの登録・ログインを、
`/api/repos` 配下でリポジトリの検索を提供する。

- `POST /api/accounts/register` — `accounts` テーブルにアカウントを作成する。あわせて
  アクセストークンを発行し、レスポンスに含める。作成内容は Dolt のコミットとして記録される。
- `POST /api/accounts/login` — username/password を検証し、成功したらアカウント情報を返す。
  あわせてアクセストークンを発行する。
- `GET /api/accounts/session` — パスワードの代わりにアクセストークン
  (`Authorization: token <トークン>`) でログイン状態を確認する。
- `GET /api/repos/trend` — 公開リポジトリを作成日時の新しい順に最大100件取得し、
  stars 数の降順に並べ替えて返す。

### Dolt のバージョン管理

アカウント作成などの書き込みのあとに `CALL DOLT_COMMIT` を実行し、データの変更履歴を
Dolt のコミットとして残す。履歴は SQL から参照できる。

```sql
SELECT commit_hash, author, message FROM dolt_log ORDER BY commit_order DESC;
SELECT * FROM dolt_status;        -- 未コミットの変更
SELECT * FROM dolt_diff('HEAD~1', 'HEAD', 'accounts');
```

コミットが不要な場合は `api/.env` で `DOLT_AUTO_COMMIT=false` にする。コミットに失敗しても
APIのレスポンスは成功のまま、エラーはログにのみ出力する。

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

初回起動時に `cookhub` データベースとテーブルが自動的に作成される。

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

### 3. リポジトリの登録

リポジトリを作成するエンドポイントは無いため、`repos` テーブルに直接登録する
(Adminer からでもよい)。

```sql
INSERT INTO repos (owner_id, name, description, stars_count)
VALUES (1, 'curry', 'カレーのレシピ', 5);
```

## API仕様

### POST /api/accounts/register

```json
{
  "username": "string",
  "email": "string",
  "password": "string"
}
```

- `201`: 作成されたアカウント情報 + `token` (アクセストークン)
- `400`: 必須項目不足
- `409`: username/email が既に使われている

### POST /api/accounts/login

```json
{
  "username": "string",
  "password": "string"
}
```

- `200`: アカウント情報 + `token` (アクセストークン)
- `400`: 必須項目不足
- `401`: 認証失敗

### GET /api/accounts/session

```
Authorization: token <register/loginで受け取ったtoken>
```

- `200`: アカウント情報
- `400`: トークン未指定
- `401`: トークンが無効

アクセストークンは40文字の16進文字列で、有効期限は無い。DBには SHA-256 ハッシュしか
保存しないため、発行時のレスポンス以外で値を確認することはできない。ログインのたびに
新しいトークンが発行されるので、不要になった古いトークンは `access_tokens` テーブルから
適宜削除すること。

### GET /api/repos/trend

- `200`: `{ "ok": true, "data": [...] }` — 公開リポジトリを作成日時の新しい順に最大100件
  取得し、`stars_count` の降順に並べ替えたもの

```json
{
  "id": 1,
  "name": "curry",
  "full_name": "tanaka/curry",
  "description": "カレーのレシピ",
  "owner": { "user_id": 1, "username": "tanaka" },
  "private": false,
  "default_branch": "main",
  "stars_count": 5,
  "created_at": "2026-09-13T06:33:10.000Z",
  "updated_at": "2026-09-13T06:33:10.000Z"
}
```

### POST /api/repos/:id/fork

```
Authorization: token <register/loginで受け取ったtoken>
```

```json
{
  "forkType": 1,
  "title": "肉じゃが（砂糖ひかえめ）",
  "ingredients": [{ "name": "砂糖", "amount": 10, "unit": "g" }]
}
```

元レシピを自分のレシピとして複製する。body はすべて任意で、材料・手順・必須環境は
元レシピをそのまま引き継ぎ、渡した項目だけが上書きされる（body が空なら丸ごとコピー）。
`forkType` は `1` = アレンジ（デフォルト）、`2` = 移植（別の環境・人数に作り直したもの）。

- `201`: `{ "ok": true, "commit": "<コミットハッシュ>", "data": {...} }` —
  複製されたレシピ。`fork: true` と派生元の `parent_id` が入る
- `400`: `forkType` が 1 / 2 以外
- `401`: トークンが無効
- `403`: 非公開レシピで、自分のものではない
- `404`: 元レシピが無い
- `409`: 同じ名前のレシピを既に持っている（`title` を指定して複製する）

### GET /api/repos/:id/commit/:sha

- `200`: コミット1件の詳細。`changes` にそのコミットで変わった内容が
  `repo` / `environment` / `ingredients` / `steps` ごとに入り、各行は `diff_type`
  （`added` / `modified` / `removed`）と変更前 `from_*` / 変更後 `to_*` の値を持つ
- `403`: 非公開レシピで、自分のものではない
- `404`: レシピまたはコミットが無い
