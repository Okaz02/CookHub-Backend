const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const { registerAccount, loginAccount, logoutAccount } = require('../services/accountService');
const { isWebClient, setSessionCookie, clearSessionCookie } = require('../utils/sessionCookie');

const FIFTEEN_MINUTES = 15 * 60 * 1000;

const loginLimit = rateLimit({
    name: 'login',
    windowMs: FIFTEEN_MINUTES,
    max: 10,
    keys: (req) => [
        `ip:${req.ip}`,
        typeof req.body?.username === 'string' ? `user:${req.body.username.trim()}` : null
    ]
});

const registerLimit = rateLimit({
    name: 'register',
    windowMs: FIFTEEN_MINUTES,
    max: 5,
    keys: (req) => [`ip:${req.ip}`]
});

function respondWithSession(req, res, status, { token, ...account }) {
    if (isWebClient(req)) {
        setSessionCookie(res, token);
        res.status(status).json(account);
        return;
    }
    res.status(status).json({ ...account, token });
}

const router = express.Router();

router.post('/register', registerLimit, asyncHandler(async (req, res) => {
    respondWithSession(req, res, 201, await registerAccount(req.body));
}));

router.post('/login', loginLimit, asyncHandler(async (req, res) => {
    respondWithSession(req, res, 200, await loginAccount(req.body));
}));

router.get('/session', requireAuth, asyncHandler(async (req, res) => {
    res.status(200).json(req.account);
}));

router.post('/logout', requireAuth, asyncHandler(async (req, res) => {
    const result = await logoutAccount(req.accessToken);
    clearSessionCookie(res);
    res.status(200).json(result);
}));

module.exports = router;
