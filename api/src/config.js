function positiveInteger(value, fallback) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : fallback;
}

function list(value) {
    if (!value) {
        return null;
    }
    const items = value.split(',').map((item) => item.trim()).filter(Boolean);
    return items.length > 0 ? items : null;
}

function trustProxy(value) {
    if (!value) {
        return null;
    }
    return /^\d+$/.test(value) ? Number(value) : value;
}

const tokenTtlDays = positiveInteger(process.env.TOKEN_TTL_DAYS, 30);

const config = {
    tokenTtlDays,
    tokenTtlMs: tokenTtlDays * 24 * 60 * 60 * 1000,
    corsOrigins: list(process.env.CORS_ORIGINS),
    trustProxy: trustProxy(process.env.TRUST_PROXY),
    cookieSecure: process.env.COOKIE_SECURE !== 'false',
    cookieSameSite: ['strict', 'lax', 'none'].includes(process.env.COOKIE_SAMESITE)
        ? process.env.COOKIE_SAMESITE
        : 'lax'
};

module.exports = config;
