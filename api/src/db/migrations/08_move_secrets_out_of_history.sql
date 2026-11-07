USE cookhub;

REPLACE INTO dolt_ignore (pattern, ignored) VALUES
    ('account_credentials', true),
    ('auth_tokens', true),
    ('rate_limit_hits', true);

CREATE TABLE IF NOT EXISTS account_credentials (
    user_id       INT          NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id)
);

INSERT INTO account_credentials (user_id, password_hash)
SELECT user_id, password_hash FROM accounts;

ALTER TABLE accounts DROP COLUMN password_hash;

CREATE TABLE IF NOT EXISTS auth_tokens (
    token_id     INT          NOT NULL AUTO_INCREMENT,
    user_id      INT          NOT NULL,
    name         VARCHAR(255) NOT NULL,
    token_hash   CHAR(64)     NOT NULL,
    created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at   TIMESTAMP    NOT NULL,
    last_used_at TIMESTAMP    NULL,
    PRIMARY KEY (token_id),
    UNIQUE KEY uq_auth_tokens_token_hash (token_hash),
    KEY idx_auth_tokens_user_id (user_id),
    KEY idx_auth_tokens_expires_at (expires_at)
);

DROP TABLE access_tokens;

CREATE TABLE IF NOT EXISTS rate_limit_hits (
    bucket_key   CHAR(64) NOT NULL,
    window_start BIGINT   NOT NULL,
    hit_count    INT      NOT NULL DEFAULT 0,
    expires_at   BIGINT   NOT NULL,
    PRIMARY KEY (bucket_key, window_start),
    KEY idx_rate_limit_hits_expires_at (expires_at)
);

CALL DOLT_COMMIT('-A', '--skip-empty', '--author', 'cookhub-migration <migration@cookhub.local>', '-m', '認証情報を履歴に残らないテーブルへ移動');
