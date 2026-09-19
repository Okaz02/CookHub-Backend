-- レシピの必須環境（人数・調理器具など）の key/value。
-- 表示順は sort_order で持ち、API は配列の並び順でこれを振り直す。
USE cookhub;

CREATE TABLE IF NOT EXISTS recipe_environment (
    id         INT          NOT NULL AUTO_INCREMENT,
    recipe_id  INT          NOT NULL,
    sort_order INT          NOT NULL DEFAULT 0,
    key_name   VARCHAR(255) NOT NULL,
    value      VARCHAR(255) NOT NULL,
    created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_recipe_environment_recipe_id (recipe_id),
    CONSTRAINT fk_recipe_environment_recipe
        FOREIGN KEY (recipe_id) REFERENCES recipes (recipe_id)
);
