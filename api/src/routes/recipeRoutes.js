const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const validateParams = require('../middleware/validateParams');
const { recipeParamsSchema, commitParamsSchema } = require('../schemas/recipeSchemas');
const {
    searchRecipesByStars,
    createRecipe,
    forkCheckedRecipe,
    searchRecipesByCurrentUser,
    getCheckedRecipeDetail,
    getCheckedRecipeCommits,
    getCheckedRecipeCommit,
    updateCheckedRecipe,
    deleteCheckedRecipe,
    createCheckedPullRequest,
    mergeCheckedPullRequest
} = require('../services/recipeService');

const router = express.Router();

router.post('/', requireAuth, asyncHandler(async (req, res) => {
    const result = await createRecipe(req.account.user_id, req.body);
    res.status(201).json(result);
}));

router.get('/mine', requireAuth, asyncHandler(async (req, res) => {
    const result = await searchRecipesByCurrentUser(req.account.user_id);
    res.status(200).json(result);
}));

router.get('/trend', optionalAuth, asyncHandler(async (req, res) => {
    const result = await searchRecipesByStars(req.account?.user_id);
    res.status(200).json(result);
}));

// トークンは任意。非公開レシピは管理者（オーナー）のトークンがないと 403 になる。
router.get('/:id', validateParams(recipeParamsSchema), optionalAuth, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await getCheckedRecipeDetail(id, req.account?.user_id);
    res.status(200).json(result);
}));

router.get('/:id/commits', validateParams(recipeParamsSchema), optionalAuth, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await getCheckedRecipeCommits(id, req.account?.user_id);
    res.status(200).json(result);
}));

router.get('/:id/commits/:commitId', validateParams(commitParamsSchema), optionalAuth, asyncHandler(async (req, res) => {
    const { id, commitId } = req.params;
    const result = await getCheckedRecipeCommit(id, commitId, req.account?.user_id);
    res.status(200).json(result);
}));

router.post('/:id/fork', validateParams(recipeParamsSchema), requireAuth, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await forkCheckedRecipe(req.account.user_id, id, req.body);
    res.status(201).json(result);
}));

router.post('/:id/pull-request/create', validateParams(recipeParamsSchema), requireAuth, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await createCheckedPullRequest(req.account.user_id, id, req.body);
    res.status(201).json(result);
}));

router.post('/:id/pull-request/merge', validateParams(recipeParamsSchema), requireAuth, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await mergeCheckedPullRequest(req.account.user_id, id, req.body);
    res.status(200).json(result);
}));

router.patch('/:id', validateParams(recipeParamsSchema), requireAuth, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await updateCheckedRecipe(req.account.user_id, id, req.body);
    res.status(200).json(result);
}));

router.delete('/:id', validateParams(recipeParamsSchema), requireAuth, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await deleteCheckedRecipe(req.account.user_id, id);
    res.status(200).json(result);
}));

module.exports = router;
