USE cookhub;

CREATE TABLE IF NOT EXISTS rate_limit_hits (
    bucket_key   CHAR(64) NOT NULL,
    window_start BIGINT   NOT NULL,
    hit_count    INT      NOT NULL DEFAULT 0,
    expires_at   BIGINT   NOT NULL,
    PRIMARY KEY (bucket_key, window_start),
    KEY idx_rate_limit_hits_expires_at (expires_at)
);
