const { ArkErrors } = require('arktype');
const { getAccountBySession } = require('../services/accountService');
const { accessTokenSchema } = require('../schemas/accountSchemas');

function extractToken(req) {
    const [, token] = (req.headers.authorization || '').split(' ');
    return token;
}

async function requireAuth(req, res, next) {
    const token = accessTokenSchema(extractToken(req));
    if (token instanceof ArkErrors) {
        const err = new Error('認証が必要です');
        err.status = 401;
        next(err);
        return;
    }

    try {
        req.account = await getAccountBySession(token);
        next();
    } catch (error) {
        next(error);
    }
}

// トークンが付いていて使えないときは 401
async function optionalAuth(req, res, next) {
    const rawToken = extractToken(req);
    if (!rawToken) {
        req.account = null;
        next();
        return;
    }

    const token = accessTokenSchema(rawToken);
    if (token instanceof ArkErrors) {
        const err = new Error('トークンが無効です');
        err.status = 401;
        next(err);
        return;
    }

    try {
        req.account = await getAccountBySession(token);
        next();
    } catch (error) {
        next(error);
    }
}

module.exports = { requireAuth, optionalAuth };
