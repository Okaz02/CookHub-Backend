const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { registerAccount, loginAccount } = require('../services/accountService');

const router = express.Router();

router.post('/register', asyncHandler(async (req, res) => {
    const { username, email, password } = req.body;
    const account = await registerAccount(username, email, password);
    res.status(201).json(account);
}));

router.post('/login', asyncHandler(async (req, res) => {
    const { username, password } = req.body;
    const account = await loginAccount(username, password);
    res.status(200).json(account);
}));

// ログイン済みかどうかの確認: `Authorization: token <アクセストークン>` で認証する
router.get('/session', requireAuth, asyncHandler(async (req, res) => {
    res.status(200).json(req.account);
}));

module.exports = router;
