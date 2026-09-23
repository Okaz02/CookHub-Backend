-- is_private / is_draft の組み合わせを、意味のある1つの ENUM にまとめる。
USE cookhub;

ALTER TABLE recipes
    ADD COLUMN recipe_status_enum
        ENUM('public', 'private', 'public_draft', 'private_draft')
        NOT NULL DEFAULT 'public'
        AFTER is_draft;

UPDATE recipes SET recipe_status_enum = CASE
    WHEN is_draft = TRUE AND is_private = TRUE THEN 'private_draft'
    WHEN is_draft = TRUE THEN 'public_draft'
    WHEN is_private = TRUE THEN 'private'
    ELSE 'public'
END;

ALTER TABLE recipes
    DROP COLUMN is_private,
    DROP COLUMN is_draft,
    CHANGE recipe_status_enum recipe_status
        ENUM('public', 'private', 'public_draft', 'private_draft')
        NOT NULL DEFAULT 'public';

CALL DOLT_COMMIT('-A', '--skip-empty', '--author', 'cookhub-migration <migration@cookhub.local>', '-m', 'レシピの公開状態をENUMに統合');