const config = require('../config');

const SESSION_COOKIE_NAME = 'cookhub_session';
const CLIENT_HEADER = 'x-cookhub-client';
const WEB_CLIENT = 'web';

function parseCookies(header) {
    const cookies = {};
    (header || '').split(';').forEach((part) => {
        const index = part.indexOf('=');
        if (index < 0) {
            return;
        }
        const name = part.slice(0, index).trim();
        const value = part.slice(index + 1).trim();
        try {
            cookies[name] = decodeURIComponent(value);
        } catch {
            cookies[name] = value;
        }
    });
    return cookies;
}

function readSessionCookie(req) {
    return parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME];
}

function isWebClient(req) {
    return req.headers[CLIENT_HEADER] === WEB_CLIENT;
}

function baseCookieOptions() {
    return {
        httpOnly: true,
        secure: config.cookieSecure,
        sameSite: config.cookieSameSite,
        path: '/api'
    };
}

function setSessionCookie(res, token) {
    res.cookie(SESSION_COOKIE_NAME, token, { ...baseCookieOptions(), maxAge: config.tokenTtlMs });
}

function clearSessionCookie(res) {
    res.clearCookie(SESSION_COOKIE_NAME, baseCookieOptions());
}

module.exports = {
    readSessionCookie,
    isWebClient,
    setSessionCookie,
    clearSessionCookie
};
