const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { registerAccount, loginAccount } = require('../services/accountService');

const router = express.Router();

router.post('/register', asyncHandler(async (req, res) => {
    const account = await registerAccount(req.body);
    res.status(201).json(account);
}));

router.post('/login', asyncHandler(async (req, res) => {
    const account = await loginAccount(req.body);
    res.status(200).json(account);
}));

router.get('/session', requireAuth, asyncHandler(async (req, res) => {
    res.status(200).json(req.account);
}));

module.exports = router;
