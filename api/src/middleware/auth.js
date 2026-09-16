const { getAccountBySession } = require('../services/accountService');

function extractToken(req) {
    const [, token] = (req.headers.authorization || '').split(' ');
    return token;
}

// 必須認証。トークンが無い/無効なら 401 を返し、ルート本体には到達させない。
// getAccountBySession はトークン未指定を 400 として扱うので、ここで 401 に揃える
async function requireAuth(req, res, next) {
    const token = extractToken(req);
    if (!token) {
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

// 任意認証。トークンがあれば req.account にセットし、無ければ req.account = null のまま次へ進む
// トークンが渡されているのに無効な場合は getAccountBySession が投げるエラーをそのまま伝える
async function optionalAuth(req, res, next) {
    const token = extractToken(req);
    if (!token) {
        req.account = null;
        next();
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
