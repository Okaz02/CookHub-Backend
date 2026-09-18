const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const validateParams = require('../middleware/validateParams');
const { repoParamsSchema, commitParamsSchema } = require('../schemas/repoSchemas');
const {
    searchReposByStars,
    createRepository,
    forkCheckedRepository,
    searchReposByCurrentUser,
    getCheckedRepoDetail,
    getCheckedRepoCommits,
    getCheckedRepoCommit,
    updateCheckedRepository,
    deleteCheckedRepository,
    createCheckedPullRequest,
    mergeCheckedPullRequest
} = require('../services/repoService');

const router = express.Router();

router.post('/', requireAuth, asyncHandler(async (req, res) => {
    const result = await createRepository(req.account.user_id, req.body);
    res.status(201).json(result);
}));

router.get('/mine', requireAuth, asyncHandler(async (req, res) => {
    const result = await searchReposByCurrentUser(req.account.user_id);
    res.status(200).json(result);
}));

router.get('/trend', optionalAuth, asyncHandler(async (req, res) => {
    const result = await searchReposByStars(req.account?.user_id);
    res.status(200).json(result);
}));

// トークンは任意。非公開リポジトリは管理者（オーナー）のトークンがないと 403 になる。
router.get('/:id', validateParams(repoParamsSchema), optionalAuth, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await getCheckedRepoDetail(id, req.account?.user_id);
    res.status(200).json(result);
}));

router.get('/:id/commits', validateParams(repoParamsSchema), optionalAuth, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await getCheckedRepoCommits(id, req.account?.user_id);
    res.status(200).json(result);
}));

router.get('/:id/commits/:commitId', validateParams(commitParamsSchema), optionalAuth, asyncHandler(async (req, res) => {
    const { id, commitId } = req.params;
    const result = await getCheckedRepoCommit(id, commitId, req.account?.user_id);
    res.status(200).json(result);
}));

router.post('/:id/fork', validateParams(repoParamsSchema), requireAuth, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await forkCheckedRepository(req.account.user_id, id, req.body);
    res.status(201).json(result);
}));

router.post('/:id/pull-request/create', validateParams(repoParamsSchema), requireAuth, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await createCheckedPullRequest(req.account.user_id, id, req.body);
    res.status(201).json(result);
}));

router.post('/:id/pull-request/merge', validateParams(repoParamsSchema), requireAuth, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await mergeCheckedPullRequest(req.account.user_id, id, req.body);
    res.status(200).json(result);
}));

router.patch('/:id', validateParams(repoParamsSchema), requireAuth, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await updateCheckedRepository(req.account.user_id, id, req.body);
    res.status(200).json(result);
}));

router.delete('/:id', validateParams(repoParamsSchema), requireAuth, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await deleteCheckedRepository(req.account.user_id, id);
    res.status(200).json(result);
}));

module.exports = router;
