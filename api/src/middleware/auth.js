const { getAccountBySession } = require('../services/accountService');
const { accessTokenSchema } = require('../schemas/accountSchemas');

function extractToken(req) {
    const [, token] = (req.headers.authorization || '').split(' ');
    return token;
}

// 必須認証。トークンが無い/形が違う/無効なら 401 を返し、ルート本体には到達させない
async function requireAuth(req, res, next) {
    const token = accessTokenSchema.safeParse(extractToken(req));
    if (!token.success) {
        const err = new Error('認証が必要です');
        err.status = 401;
        next(err);
        return;
    }

    try {
        req.account = await getAccountBySession(token.data);
        next();
    } catch (error) {
        next(error);
    }
}

// 任意認証。トークンがあれば req.account にセットし、無ければ req.account = null のまま次へ進む。
// トークンが渡されているのに使えない場合は、形が違うのか失効しているのかに関わらず 401 にする
async function optionalAuth(req, res, next) {
    const rawToken = extractToken(req);
    if (!rawToken) {
        req.account = null;
        next();
        return;
    }

    const token = accessTokenSchema.safeParse(rawToken);
    if (!token.success) {
        const err = new Error('トークンが無効です');
        err.status = 401;
        next(err);
        return;
    }

    try {
        req.account = await getAccountBySession(token.data);
        next();
    } catch (error) {
        next(error);
    }
}

module.exports = { requireAuth, optionalAuth };
