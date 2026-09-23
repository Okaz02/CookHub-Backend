-- 意味が決まっている番号の列を ENUM に置き換える。
--
-- recipes.fork_type（0/1/2）と recipe_pull_requests.status（0/1）は、取りうる値が
-- あらかじめ決まっているのに TINYINT で持っていた。番号だけを見てもどれが何なのか
-- 分からず、範囲外の値（fork_type = 7 など）もDBは受け付けてしまう。
-- ENUM にすると値そのものが名前になり、範囲外はDBが弾く。
--
-- 新しく docker compose up する環境では api/src/db/sql/ の初期化スクリプトが最初から
-- ENUM で作るので、このファイルを流す必要は無い。既にデータが入っているDBを
-- 作り直さずに移行したいときだけ使う。
--
-- ENUM の 0 番は MySQL では「不正な値」を表す特別な番号で、TINYINT の 0 をそのまま
-- ENUM に MODIFY すると弾かれる。番号と名前の対応はこちらで決めたいので、
-- 新しい列を足して CASE で詰め替えてから、古い列と入れ替える。
USE cookhub;

ALTER TABLE recipes
    ADD COLUMN fork_type_enum ENUM('original', 'arrange', 'port') NOT NULL DEFAULT 'original' AFTER fork_type;

UPDATE recipes SET fork_type_enum = CASE fork_type
    WHEN 1 THEN 'arrange'
    WHEN 2 THEN 'port'
    ELSE 'original'   -- 0 と、入ってしまっていた範囲外の値
END;

ALTER TABLE recipes DROP COLUMN fork_type;
ALTER TABLE recipes CHANGE fork_type_enum fork_type
    ENUM('original', 'arrange', 'port') NOT NULL DEFAULT 'original';

-- status は Dolt のパーサーではキーワード扱いになる場所があり、ALTER TABLE の中では
-- バッククォートで囲まないと構文エラーになる
ALTER TABLE recipe_pull_requests
    ADD COLUMN status_enum ENUM('open', 'merged') NOT NULL DEFAULT 'open' AFTER `status`;

-- マージ済みの判定は merged_at の有無で行っているので、status が食い違っている行も
-- ここで merged_at に合わせて直す
UPDATE recipe_pull_requests SET status_enum = CASE
    WHEN merged_at IS NOT NULL THEN 'merged'
    ELSE 'open'
END;

ALTER TABLE recipe_pull_requests DROP COLUMN `status`;
ALTER TABLE recipe_pull_requests CHANGE status_enum `status`
    ENUM('open', 'merged') NOT NULL DEFAULT 'open';

CALL DOLT_COMMIT('-A', '--skip-empty', '--author', 'cookhub-migration <migration@cookhub.local>', '-m', 'fork_type と プルリクエストの status を ENUM に変更');
