const { pool } = require('./pool');

async function incrementRateLimitHit(bucketKey, windowStart, expiresAt) {
    await pool.execute(
        `INSERT INTO rate_limit_hits (bucket_key, window_start, hit_count, expires_at)
         VALUES (?, ?, 1, ?)
         ON DUPLICATE KEY UPDATE hit_count = hit_count + 1`,
        [bucketKey, windowStart, expiresAt]
    );
    const [rows] = await pool.execute(
        'SELECT hit_count FROM rate_limit_hits WHERE bucket_key = ? AND window_start = ?',
        [bucketKey, windowStart]
    );
    return rows[0]?.hit_count ?? 1;
}

async function deleteExpiredRateLimitHits(now) {
    await pool.execute('DELETE FROM rate_limit_hits WHERE expires_at < ?', [now]);
}

module.exports = {
    incrementRateLimitHit,
    deleteExpiredRateLimitHits
};
