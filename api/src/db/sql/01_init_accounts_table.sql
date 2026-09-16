-- cookhub のアカウント本体。Gitea を使っていた頃は Gitea 側が持っていた認証情報を
-- Dolt 上のこのテーブルで直接管理する（パスワードは bcrypt ハッシュのみ保存）。
USE cookhub;

CREATE TABLE IF NOT EXISTS accounts (
    user_id       INT          NOT NULL AUTO_INCREMENT,
    username      VARCHAR(255) NOT NULL,
    email         VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id),
    UNIQUE KEY uq_accounts_username (username),
    UNIQUE KEY uq_accounts_email (email)
);
