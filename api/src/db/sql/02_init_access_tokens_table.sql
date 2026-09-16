-- アクセストークン。Gitea が発行していたトークンの置き換えで、cookhub 側で発行する。
-- 平文は発行時のレスポンスにしか現れず、DB には SHA-256 ハッシュだけを保存する。
USE cookhub;

CREATE TABLE IF NOT EXISTS access_tokens (
    token_id     INT          NOT NULL AUTO_INCREMENT,
    user_id      INT          NOT NULL,
    name         VARCHAR(255) NOT NULL,
    token_hash   CHAR(64)     NOT NULL,
    created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP    NULL,
    PRIMARY KEY (token_id),
    UNIQUE KEY uq_access_tokens_token_hash (token_hash),
    KEY idx_access_tokens_user_id (user_id),
    CONSTRAINT fk_access_tokens_user
        FOREIGN KEY (user_id) REFERENCES accounts (user_id) ON DELETE CASCADE
);
