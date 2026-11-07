const crypto = require('crypto');
const rateLimitDb = require('../db/rateLimitDb');
const { httpError } = require('../utils/httpError');

function toBucketKey(name, key) {
    return crypto.createHash('sha256').update(`${name}:${key}`).digest('hex');
}

function rateLimit({ name, windowMs, max, keys }) {
    let lastCleanupAt = 0;

    async function cleanup(now) {
        if (now - lastCleanupAt < windowMs) {
            return;
        }
        lastCleanupAt = now;
        await rateLimitDb.deleteExpiredRateLimitHits(now);
    }

    return async (req, res, next) => {
        try {
            const now = Date.now();
            const windowStart = Math.floor(now / windowMs) * windowMs;
            const resetAt = windowStart + windowMs;

            await cleanup(now);

            const counts = await Promise.all(
                keys(req)
                    .filter((key) => key != null)
                    .map((key) => rateLimitDb.incrementRateLimitHit(toBucketKey(name, key), windowStart, resetAt))
            );

            if (counts.some((count) => count > max)) {
                res.set('Retry-After', String(Math.ceil((resetAt - now) / 1000)));
                next(httpError(429, '試行回数が多すぎます。しばらく待ってから再度お試しください'));
                return;
            }
            next();
        } catch (error) {
            next(error);
        }
    };
}

module.exports = rateLimit;
