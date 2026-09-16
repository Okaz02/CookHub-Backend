const { getAccountBySession } = require('../services/accountService');

function extractToken(req) {
    const [, token] = (req.headers.authorization || '').split(' ');
    return token;
}

// 必須認証。トークンが無い/無効なら 401 を返し、ルート本体には到達させない
async function requireAuth(req, res, next) {
    try {
        req.account = await getAccountBySession(extractToken(req));
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
