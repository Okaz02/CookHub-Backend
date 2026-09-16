const express = require('express');
const { getAccountBySession } = require('../services/accountService');
const {
    searchReposByStars,
    createRepository,
    forkRepository,
    searchReposByCurrentUser,
    getRepoDetail,
    getRepoCommits,
    getRepoCommit,
    updateRepository,
    deleteRepository
} = require('../services/repoService');

const router = express.Router();

router.post('/create', async (req, res, next) => {
    try {
        const [, token] = (req.headers.authorization || '').split(' ');
        const account = await getAccountBySession(token);
        const result = await createRepository(account.user_id, req.body);
        res.status(201).json(result);
    } catch (error) {
        next(error);
    }
});

router.get('/mine', async (req, res, next) => {
    try {
        const [, token] = (req.headers.authorization || '').split(' ');
        const account = await getAccountBySession(token);
        const result = await searchReposByCurrentUser(account.user_id);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
});

router.get('/trend', async (req, res, next) => {
    try {
        const [, token] = (req.headers.authorization || '').split(' ');
        const account = token ? await getAccountBySession(token) : null;
        const result = await searchReposByStars(account && account.user_id);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
});

// トークンは任意。非公開リポジトリは管理者（オーナー）のトークンがないと 403 になる。
router.get('/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const [, token] = (req.headers.authorization || '').split(' ');
        const account = token ? await getAccountBySession(token) : null;
        const result = await getRepoDetail(id, account && account.user_id);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
});

router.get('/:id/commits', async (req, res, next) => {
    try {
        const { id } = req.params;
        const [, token] = (req.headers.authorization || '').split(' ');
        const account = token ? await getAccountBySession(token) : null;
        const result = await getRepoCommits(id, account && account.user_id);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
});

router.get('/:id/commit/:commitId', async (req, res, next) => {
    try {
        const { id, commitId } = req.params;
        const [, token] = (req.headers.authorization || '').split(' ');
        const account = token ? await getAccountBySession(token) : null;
        const result = await getRepoCommit(id, commitId, account && account.user_id);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
});

// 既存レシピを自分のレシピとして複製する。body は任意で、
// forkType（1 = アレンジ / 2 = 移植）や title などを渡すとその項目だけ変えて複製できる。
router.post('/:id/fork', async (req, res, next) => {
    try {
        const { id } = req.params;
        const [, token] = (req.headers.authorization || '').split(' ');
        const account = await getAccountBySession(token);
        const result = await forkRepository(account.user_id, id, req.body);
        res.status(201).json(result);
    } catch (error) {
        next(error);
    }
});

router.patch('/:id/update', async (req, res, next) => {
    try {
        const { id } = req.params;
        const [, token] = (req.headers.authorization || '').split(' ');
        const account = await getAccountBySession(token);
        const result = await updateRepository(account.user_id, id, req.body);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
});

router.delete('/:id/delete', async (req, res, next) => {
    try {
        const { id } = req.params;
        const [, token] = (req.headers.authorization || '').split(' ');
        const account = await getAccountBySession(token);
        const result = await deleteRepository(account.user_id, id);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
});

module.exports = router;
