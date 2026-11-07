const { ArkErrors } = require('arktype');
const { getAccountBySession } = require('../services/accountService');
const { accessTokenSchema } = require('../schemas/accountSchemas');
const { httpError } = require('../utils/httpError');
const { readSessionCookie, isWebClient } = require('../utils/sessionCookie');

function extractCredential(req) {
    const [scheme, token] = (req.headers.authorization || '').split(' ');
    if (scheme === 'Bearer' && token) {
        return { token, viaCookie: false };
    }

    const cookieToken = readSessionCookie(req);
    return cookieToken ? { token: cookieToken, viaCookie: true } : null;
}

async function authenticate(req, credential, next) {
    const token = accessTokenSchema(credential.token);
    if (token instanceof ArkErrors) {
        next(httpError(401, 'トークンが無効です'));
        return;
    }
    if (credential.viaCookie && !isWebClient(req)) {
        next(httpError(403, '不正なリクエストです'));
        return;
    }

    try {
        req.account = await getAccountBySession(token);
        req.accessToken = token;
        next();
    } catch (error) {
        next(error);
    }
}

async function requireAuth(req, res, next) {
    const credential = extractCredential(req);
    if (!credential) {
        next(httpError(401, '認証が必要です'));
        return;
    }

    await authenticate(req, credential, next);
}

async function optionalAuth(req, res, next) {
    const credential = extractCredential(req);
    if (!credential) {
        req.account = null;
        next();
        return;
    }

    await authenticate(req, credential, next);
}

module.exports = { requireAuth, optionalAuth };
