const express = require('express');
const { registerAccount, loginAccount, getAccountBySession } = require('../services/accountService');

const router = express.Router();

router.post('/register', async (req, res, next) => {
    try {
        const { username, email, password } = req.body;
        const account = await registerAccount(username, email, password);
        res.status(201).json(account);
    } catch (error) {
        next(error);
    }
});

router.post('/login', async (req, res, next) => {
    try {
        const { username, password } = req.body;
        const account = await loginAccount(username, password);
        res.status(200).json(account);
    } catch (error) {
        next(error);
    }
});

// ログイン済みかどうかの確認: `Authorization: token <アクセストークン>` で認証する
router.get('/session', async (req, res, next) => {
    try {
        const [, token] = (req.headers.authorization || '').split(' ');
        const account = await getAccountBySession(token);
        res.status(200).json(account);
    } catch (error) {
        next(error);
    }
});

module.exports = router;
