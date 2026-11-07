USE cookhub;

UPDATE recipes
SET thumbnail = NULL
WHERE thumbnail IS NOT NULL
  AND LOWER(thumbnail) NOT LIKE 'http://%'
  AND LOWER(thumbnail) NOT LIKE 'https://%';

UPDATE recipe_steps
SET image_url = NULL
WHERE image_url IS NOT NULL
  AND LOWER(image_url) NOT LIKE 'http://%'
  AND LOWER(image_url) NOT LIKE 'https://%';

CALL DOLT_COMMIT('-A', '--skip-empty', '--author', 'cookhub-migration <migration@cookhub.local>', '-m', 'http(s) 以外の画像URLを除去');
