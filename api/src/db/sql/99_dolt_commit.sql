-- 初期スキーマを Dolt のコミットとして記録する（以降の変更はAPIがコミットする）
USE cookhub;

CALL DOLT_COMMIT('-A', '--skip-empty', '--author', 'cookhub-init <init@cookhub.local>', '-m', 'accounts / access_tokens / repos の初期スキーマ');
