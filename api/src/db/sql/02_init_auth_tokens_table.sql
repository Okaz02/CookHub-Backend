USE cookhub;

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
