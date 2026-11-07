USE cookhub;

CREATE TABLE IF NOT EXISTS recipe_stars (
    recipe_id  INT       NOT NULL,
    user_id    INT       NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (recipe_id, user_id),
    INDEX idx_recipe_stars_user_id (user_id),
    FOREIGN KEY (recipe_id) REFERENCES recipes(recipe_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES accounts(user_id) ON DELETE CASCADE
);
