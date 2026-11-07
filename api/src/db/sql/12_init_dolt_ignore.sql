USE cookhub;

REPLACE INTO dolt_ignore (pattern, ignored) VALUES
    ('account_credentials', true),
    ('auth_tokens', true),
    ('rate_limit_hits', true);
