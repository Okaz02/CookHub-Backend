USE cookhub;

CREATE TABLE IF NOT EXISTS account_credentials (
    user_id       INT          NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id)
);
