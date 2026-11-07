USE cookhub;

ALTER TABLE recipe_pull_requests
    MODIFY `status` ENUM('open', 'merged', 'closed') NOT NULL DEFAULT 'open';
ALTER TABLE recipe_pull_requests
    ADD COLUMN closed_at TIMESTAMP NULL AFTER merged_at;

CREATE TABLE IF NOT EXISTS recipe_stars (
    recipe_id  INT       NOT NULL,
    user_id    INT       NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (recipe_id, user_id),
    INDEX idx_recipe_stars_user_id (user_id),
    FOREIGN KEY (recipe_id) REFERENCES recipes(recipe_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES accounts(user_id) ON DELETE CASCADE
);

ALTER TABLE recipes DROP COLUMN stars_count;
ALTER TABLE recipes ADD INDEX idx_recipes_parent_recipe_id (parent_recipe_id);

CALL DOLT_COMMIT('-A', '--skip-empty', '--author', 'cookhub-migration <migration@cookhub.local>', '-m', 'プルリクエストの見送り・いいね・派生ツリー用の索引を追加');
