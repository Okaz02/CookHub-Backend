-- レシピへのプルリクエスト（変更提案）。fork した自分のレシピ（source）の変更を、
-- 元のレシピ（target）に取り込んでほしいという提案を表す。
USE cookhub;

CREATE TABLE IF NOT EXISTS recipe_pull_requests (
    id                  INT          NOT NULL AUTO_INCREMENT,
    target_recipe_id    INT          NOT NULL,
    source_recipe_id    INT          NOT NULL,
    user_id             INT          NOT NULL,
    title               VARCHAR(255) NOT NULL,
    content             TEXT         NULL,
    -- open = 提案中 / merged = 取り込み済み（クローズは未実装）
    status              ENUM('open', 'merged') NOT NULL DEFAULT 'open',
    merged_commit_hash  VARCHAR(40)  NULL,
    created_at          TIMESTAMP    NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP    NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    merged_at           TIMESTAMP    NULL,
    PRIMARY KEY (id),
    INDEX idx_recipe_pull_requests_target_recipe_id (target_recipe_id),
    INDEX idx_recipe_pull_requests_source_recipe_id (source_recipe_id),
    INDEX idx_recipe_pull_requests_user_id (user_id),
    FOREIGN KEY (target_recipe_id) REFERENCES recipes(recipe_id) ON DELETE CASCADE,
    FOREIGN KEY (source_recipe_id) REFERENCES recipes(recipe_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES accounts(user_id)
);
