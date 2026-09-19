-- レシピの材料。amount は「3」「0.5」のような数量で、単位は unit に分けて持つ。
-- 「少々」のように数量が無いものは amount / unit とも NULL。
USE cookhub;

CREATE TABLE IF NOT EXISTS recipe_ingredients (
    id         INT            NOT NULL AUTO_INCREMENT,
    recipe_id  INT            NOT NULL,
    sort_order INT            NOT NULL DEFAULT 0,
    name       VARCHAR(255)   NOT NULL,
    amount     DECIMAL(10, 2) NULL,
    unit       VARCHAR(50)    NULL,
    created_at TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_recipe_ingredients_recipe_id (recipe_id),
    CONSTRAINT fk_recipe_ingredients_recipe
        FOREIGN KEY (recipe_id) REFERENCES recipes (recipe_id)
);
