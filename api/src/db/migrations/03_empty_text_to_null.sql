-- 「値なし」を NULL にそろえる。
--
-- 入力側は recipeSchemas.js が空文字を null に寄せるようになったが、それが効くのは
-- これから入ってくる値だけ。02_trim_existing_text_values.sql で空白だけの値を TRIM した
-- 結果 '' になった行など、既に '' で入っているものはここで一度 NULL にそろえる。
-- 放置すると「値なし」が NULL と '' の2通りで混ざり、次の保存で変更履歴に
-- 「（空）→（空）」という中身の無い差分が1回残る。
--
-- 対象は NULL を許している列だけ（NOT NULL の列に '' が入っていることは無い）。
-- 02_trim_existing_text_values.sql を流したあとに実行すること。
USE cookhub;

UPDATE recipes              SET description = NULL WHERE description = '';
UPDATE recipes              SET thumbnail   = NULL WHERE thumbnail   = '';
UPDATE recipe_ingredients   SET unit        = NULL WHERE unit        = '';
UPDATE recipe_steps         SET image_url   = NULL WHERE image_url   = '';
UPDATE recipe_pull_requests SET content     = NULL WHERE content     = '';

CALL DOLT_COMMIT('-A', '--skip-empty', '--author', 'cookhub-migration <migration@cookhub.local>', '-m', '空文字で入っていた「値なし」を NULL にそろえる');
