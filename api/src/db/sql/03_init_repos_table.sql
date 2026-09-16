-- リポジトリ一覧。Gitea のリポジトリに相当するメタデータを cookhub 側で保持し、
-- 実データは default_branch が指す Dolt のブランチでバージョン管理する。
USE cookhub;

CREATE TABLE IF NOT EXISTS repos (
    repo_id        INT          NOT NULL AUTO_INCREMENT,
    owner_id       INT          NOT NULL,
    name           VARCHAR(255) NOT NULL,
    description    TEXT         NULL,
    default_branch VARCHAR(255) NOT NULL DEFAULT 'main',
    stars_count    INT          NOT NULL DEFAULT 0,
    is_private     BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (repo_id),
    UNIQUE KEY uq_repos_owner_name (owner_id, name),
    KEY idx_repos_created_at (created_at),
    CONSTRAINT fk_repos_owner
        FOREIGN KEY (owner_id) REFERENCES accounts (user_id) ON DELETE CASCADE
);
