USE cookhub;

-- 既存のテーブル定義が残っていると `CREATE TABLE IF NOT EXISTS` では古いカラムが消えない。
-- 依存関係の逆順で落としてから、以後の初期化スクリプトで再作成する。
DROP TABLE IF EXISTS recipe_pull_requests;
DROP TABLE IF EXISTS recipe_steps;
DROP TABLE IF EXISTS recipe_ingredients;
DROP TABLE IF EXISTS recipe_environment;
DROP TABLE IF EXISTS recipes;
DROP TABLE IF EXISTS repos_information;   -- 改名前の名前。古いDBを作り直すときのため
DROP TABLE IF EXISTS access_tokens;
DROP TABLE IF EXISTS accounts;
