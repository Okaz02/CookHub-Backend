-- 行が無い前提で作り直す
USE cookhub;

DROP TABLE IF EXISTS recipe_issues;

CREATE TABLE IF NOT EXISTS recipe_issues (
    id          INT          NOT NULL AUTO_INCREMENT,
    recipe_id   INT          NOT NULL,
    user_id     INT          NOT NULL,
    title       VARCHAR(255) NOT NULL,
    content     TEXT         NULL,
    status      ENUM('open', 'closed') NOT NULL DEFAULT 'open',
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    closed_at   TIMESTAMP    NULL,
    PRIMARY KEY (id),
    INDEX idx_recipe_issues_recipe_id (recipe_id),
    INDEX idx_recipe_issues_user_id (user_id),
    FOREIGN KEY (recipe_id) REFERENCES recipes(recipe_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES accounts(user_id)
);

CALL DOLT_COMMIT('-A', '--skip-empty', '--author', 'cookhub-migration <migration@cookhub.local>', '-m', 'recipe_issues の定義を修正');
