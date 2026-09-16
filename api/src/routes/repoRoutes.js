const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const validateNumericParams = require('../middleware/validateNumericParams');
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

router.post('/', requireAuth, asyncHandler(async (req, res) => {
    const result = await createRepository(req.account?.user_id, req.body);
    res.status(201).json(result);
}));

router.get('/mine', requireAuth, asyncHandler(async (req, res) => {
    const result = await searchReposByCurrentUser(req.account?.user_id);
    res.status(200).json(result);
}));

router.get('/trend', optionalAuth, asyncHandler(async (req, res) => {
    const result = await searchReposByStars(req.account?.user_id);
    res.status(200).json(result);
}));

// トークンは任意。非公開リポジトリは管理者（オーナー）のトークンがないと 403 になる。
router.get('/:id', validateNumericParams('id'), optionalAuth, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await getRepoDetail(id, req.account?.user_id);
    res.status(200).json(result);
}));

router.get('/:id/commits', validateNumericParams('id'), optionalAuth, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await getRepoCommits(id, req.account?.user_id);
    res.status(200).json(result);
}));

// commitId は Dolt のコミットハッシュ（数値ではない）なので数値バリデーションの対象外。
// 存在しないハッシュは getRepoCommit 側が 404 を返す。
router.get('/:id/commits/:commitId', validateNumericParams('id'), optionalAuth, asyncHandler(async (req, res) => {
    const { id, commitId } = req.params;
    const result = await getRepoCommit(id, commitId, req.account?.user_id);
    res.status(200).json(result);
}));

// 既存レシピを自分のレシピとして複製する。body は任意で、
// fork_type（1 = アレンジ / 2 = 移植）や title などを渡すとその項目だけ変えて複製できる。
router.post('/:id/fork', validateNumericParams('id'), requireAuth, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await forkRepository(req.account?.user_id, id, req.body);
    res.status(201).json(result);
}));

router.patch('/:id', validateNumericParams('id'), requireAuth, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await updateRepository(req.account?.user_id, id, req.body);
    res.status(200).json(result);
}));

router.delete('/:id', validateNumericParams('id'), requireAuth, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await deleteRepository(req.account?.user_id, id);
    res.status(200).json(result);
}));

module.exports = router;
