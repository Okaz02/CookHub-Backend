-- 既に保存されている文字列の前後の空白を落とす。
--
-- 入力側は recipeSchemas.js の .trim() で正規化されるようになったが、それが効くのは
-- これから入ってくる値だけ。既に「 少々」のような形で入っている行はここで一度きれいにする。
-- 放置しても次にそのレシピを保存したときに正規化されるが、そのとき変更履歴に
-- 「 少々 → 少々」という、見た目には何も変わっていない差分が1回残ってしまう。
--
-- 01_rename_repos_information_to_recipes.sql を流したあとに実行すること
-- （まだ流していないDBでは recipes テーブルが無いので失敗する）。
--
-- SQL の TRIM() が落とすのは半角スペースだけで、改行や全角スペースは残る。
-- 今回混ざっていたのは半角スペースなのでこれで足りる。
USE cookhub;

UPDATE recipes            SET title       = TRIM(title)       WHERE title       <> TRIM(title);
UPDATE recipes            SET description = TRIM(description) WHERE description <> TRIM(description);
UPDATE recipes            SET thumbnail   = TRIM(thumbnail)   WHERE thumbnail   <> TRIM(thumbnail);
UPDATE recipe_environment SET key_name    = TRIM(key_name)    WHERE key_name    <> TRIM(key_name);
UPDATE recipe_environment SET value       = TRIM(value)       WHERE value       <> TRIM(value);
UPDATE recipe_ingredients SET name        = TRIM(name)        WHERE name        <> TRIM(name);
UPDATE recipe_ingredients SET unit        = TRIM(unit)        WHERE unit        <> TRIM(unit);
UPDATE recipe_steps       SET body        = TRIM(body)        WHERE body        <> TRIM(body);
UPDATE recipe_steps       SET image_url   = TRIM(image_url)   WHERE image_url   <> TRIM(image_url);

CALL DOLT_COMMIT('-A', '--skip-empty', '--author', 'cookhub-migration <migration@cookhub.local>', '-m', '既存データの前後の空白を除去');
