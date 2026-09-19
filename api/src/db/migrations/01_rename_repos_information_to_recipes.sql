-- repos_information を recipes に改名する。
--
-- 新しく docker compose up する環境では api/src/db/sql/ の初期化スクリプトが最初から
-- recipes を作るので、このファイルを流す必要は無い。既にデータが入っているDBを
-- 作り直さずに移行したいときだけ使う。
--
-- 子テーブル（recipe_environment / recipe_ingredients / recipe_steps /
-- recipe_pull_requests）から repos_information を指している外部キーは、
-- RENAME TABLE が参照先を自動で追従させるので張り直さなくてよい。
-- 索引と外部キーの名前だけはテーブル名に追従しないので、ここで付け直す。
USE cookhub;

RENAME TABLE repos_information TO recipes;

ALTER TABLE recipes RENAME INDEX uq_repos_owner_name TO uq_recipes_owner_title;
ALTER TABLE recipes RENAME INDEX idx_repos_created_at TO idx_recipes_created_at;

ALTER TABLE recipes DROP FOREIGN KEY fk_repos_owner;
ALTER TABLE recipes ADD CONSTRAINT fk_recipes_owner
    FOREIGN KEY (owner_id) REFERENCES accounts (user_id) ON DELETE CASCADE;

CALL DOLT_COMMIT('-A', '--skip-empty', '--author', 'cookhub-migration <migration@cookhub.local>', '-m', 'repos_information を recipes に改名');
