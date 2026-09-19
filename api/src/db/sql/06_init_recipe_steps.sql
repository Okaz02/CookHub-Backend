-- レシピの手順（ステップ）。recipe_ingredients と同様に recipes にぶら下がる。
USE cookhub;

CREATE TABLE IF NOT EXISTS recipe_steps (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    recipe_id     INT NOT NULL,
    sort_order    INT NOT NULL DEFAULT 0,
    body          TEXT NOT NULL,
    image_url     VARCHAR(255) NULL,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (recipe_id) REFERENCES recipes(recipe_id) ON DELETE CASCADE,
    INDEX idx_recipe_id (recipe_id)
);
