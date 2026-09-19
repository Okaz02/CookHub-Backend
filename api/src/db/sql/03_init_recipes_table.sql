-- レシピ本体。タイトル・公開設定といったレシピのメタデータを持ち、
-- 材料・手順・必須環境は recipe_* テーブルにぶら下げる。
-- 同じ人が同じ名前のレシピを2つ持てないよう (owner_id, title) に一意制約を張る
-- （API はこの重複エラーを 409 に変換している）。
USE cookhub;

CREATE TABLE IF NOT EXISTS recipes (
    recipe_id        INT          NOT NULL AUTO_INCREMENT,
    owner_id         INT          NOT NULL,
    parent_recipe_id INT          NULL,             -- フォーク元。オリジナルなら NULL
    title            VARCHAR(255) NOT NULL,
    thumbnail        VARCHAR(255) NULL,
    description      TEXT         NULL,
    default_branch   VARCHAR(255) NOT NULL DEFAULT 'main',
    stars_count      INT          NOT NULL DEFAULT 0,
    is_private       TINYINT(1)   NOT NULL DEFAULT 0,
    is_draft         TINYINT(1)   NOT NULL,
    fork_type        TINYINT      NOT NULL,         -- 0 = オリジナル / 1 = アレンジ / 2 = 移植
    created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (recipe_id),
    UNIQUE KEY uq_recipes_owner_title (owner_id, title),
    KEY idx_recipes_created_at (created_at),
    CONSTRAINT fk_recipes_owner
        FOREIGN KEY (owner_id) REFERENCES accounts (user_id) ON DELETE CASCADE
);
