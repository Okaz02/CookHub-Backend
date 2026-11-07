const { commitDolt } = require('../clients/doltClient');
const { httpError } = require('../utils/httpError');
const { pool } = require('./pool');
const { withTransaction } = require('./transaction');

const RECIPE_SELECT = `
    SELECT r.recipe_id,
           r.title,
           r.description,
           r.default_branch,
           r.thumbnail,
           (SELECT COUNT(*) FROM recipe_stars st WHERE st.recipe_id = r.recipe_id) AS stars_count,
           r.recipe_status,
           r.parent_recipe_id,
           r.fork_type,
           r.created_at,
           r.updated_at,
           a.user_id,
           a.username
    FROM recipes r
    JOIN accounts a ON a.user_id = r.owner_id`;

// 子テーブルだけの変更も履歴に出すため、4つの差分テーブルからハッシュを集める
const RECIPE_COMMIT_HASHES = `
    SELECT to_commit FROM dolt_diff_recipes                  WHERE to_recipe_id = ? OR from_recipe_id = ?
    UNION SELECT to_commit FROM dolt_diff_recipe_environment WHERE to_recipe_id = ? OR from_recipe_id = ?
    UNION SELECT to_commit FROM dolt_diff_recipe_ingredients WHERE to_recipe_id = ? OR from_recipe_id = ?
    UNION SELECT to_commit FROM dolt_diff_recipe_steps       WHERE to_recipe_id = ? OR from_recipe_id = ?`;

const COMMIT_COLUMNS = 'l.commit_hash, l.message, l.committer, l.email, l.date';

const COMMIT_LIST_SELECT = `
    SELECT ${COMMIT_COLUMNS}
    FROM dolt_log l
    WHERE l.commit_hash IN (${RECIPE_COMMIT_HASHES})
    ORDER BY l.date DESC
    LIMIT ?`;

const COMMIT_SELECT = `
    SELECT ${COMMIT_COLUMNS}
    FROM dolt_log l
    WHERE l.commit_hash = ?
      AND l.commit_hash IN (${RECIPE_COMMIT_HASHES})`;

function recipeCommitParams(recipeId) {
    return Array(8).fill(recipeId);
}

const COMMIT_DIFF_RECIPE = `
    SELECT diff_type,
           from_title, to_title,
           from_thumbnail, to_thumbnail,
           from_description, to_description,
           from_recipe_status, to_recipe_status
    FROM dolt_diff_recipes
    WHERE to_commit = ? AND (to_recipe_id = ? OR from_recipe_id = ?)`;

const COMMIT_DIFF_ENVIRONMENT = `
    SELECT diff_type,
           from_sort_order, to_sort_order,
           from_key_name, to_key_name,
           from_value, to_value
    FROM dolt_diff_recipe_environment
    WHERE to_commit = ? AND (to_recipe_id = ? OR from_recipe_id = ?)
    ORDER BY to_sort_order, from_sort_order`;

const COMMIT_DIFF_INGREDIENTS = `
    SELECT diff_type,
           from_sort_order, to_sort_order,
           from_name, to_name,
           from_amount, to_amount,
           from_unit, to_unit
    FROM dolt_diff_recipe_ingredients
    WHERE to_commit = ? AND (to_recipe_id = ? OR from_recipe_id = ?)
    ORDER BY to_sort_order, from_sort_order`;

const COMMIT_DIFF_STEPS = `
    SELECT diff_type,
           from_sort_order, to_sort_order,
           from_body, to_body,
           from_image_url, to_image_url
    FROM dolt_diff_recipe_steps
    WHERE to_commit = ? AND (to_recipe_id = ? OR from_recipe_id = ?)
    ORDER BY to_sort_order, from_sort_order`;

const CHILD_TABLES = {
    environment: {
        values: (row) => [row.key_name, row.value],
        selectIds: 'SELECT id FROM recipe_environment WHERE recipe_id = ? ORDER BY sort_order, id',
        update: `UPDATE recipe_environment
                 SET sort_order = ?, key_name = ?, value = ?
                 WHERE id = ? AND recipe_id = ?`,
        insert: `INSERT INTO recipe_environment (recipe_id, sort_order, key_name, value)
                 VALUES (?, ?, ?, ?)`,
        deleteIds: 'DELETE FROM recipe_environment WHERE id IN (?)'
    },
    ingredients: {
        values: (row) => [row.name, row.amount, row.unit],
        selectIds: 'SELECT id FROM recipe_ingredients WHERE recipe_id = ? ORDER BY sort_order, id',
        update: `UPDATE recipe_ingredients
                 SET sort_order = ?, name = ?, amount = ?, unit = ?
                 WHERE id = ? AND recipe_id = ?`,
        insert: `INSERT INTO recipe_ingredients (recipe_id, sort_order, name, amount, unit)
                 VALUES (?, ?, ?, ?, ?)`,
        deleteIds: 'DELETE FROM recipe_ingredients WHERE id IN (?)'
    },
    steps: {
        values: (row) => [row.body, row.image_url],
        selectIds: 'SELECT id FROM recipe_steps WHERE recipe_id = ? ORDER BY sort_order, id',
        update: `UPDATE recipe_steps
                 SET sort_order = ?, body = ?, image_url = ?
                 WHERE id = ? AND recipe_id = ?`,
        insert: `INSERT INTO recipe_steps (recipe_id, sort_order, body, image_url)
                 VALUES (?, ?, ?, ?)`,
        deleteIds: 'DELETE FROM recipe_steps WHERE id IN (?)'
    }
};

// id の無い行には余っている既存行を順に割り当て、変わっていない行を Dolt の差分に出さない
function matchExistingRows(rows, existingIds) {
    const available = new Set(existingIds);

    const targetIds = rows.map((row) => {
        if (row.id != null && available.has(row.id)) {
            available.delete(row.id);
            return row.id;
        }
        return null;
    });

    const spare = existingIds.filter((id) => available.has(id));
    let spareIndex = 0;
    for (let i = 0; i < targetIds.length; i += 1) {
        if (targetIds[i] === null && spareIndex < spare.length) {
            targetIds[i] = spare[spareIndex];
            spareIndex += 1;
        }
    }

    return targetIds;
}

async function syncChildRows(connection, recipeId, tableKey, rows) {
    const child = CHILD_TABLES[tableKey];
    const [existing] = await connection.query(child.selectIds, [recipeId]);
    const existingIds = existing.map((row) => row.id);
    const targetIds = matchExistingRows(rows, existingIds);

    for (let i = 0; i < rows.length; i += 1) {
        const targetId = targetIds[i];
        if (targetId != null) {
            await connection.execute(child.update, [i, ...child.values(rows[i]), targetId, recipeId]);
        } else {
            await connection.execute(child.insert, [recipeId, i, ...child.values(rows[i])]);
        }
    }

    const keptIds = new Set(targetIds.filter((id) => id != null));
    const removedIds = existingIds.filter((id) => !keptIds.has(id));
    if (removedIds.length > 0) {
        await connection.query(child.deleteIds, [removedIds]);
    }
}

async function syncAllChildRows(connection, recipeId, recipe) {
    for (const tableKey of Object.keys(CHILD_TABLES)) {
        if (recipe[tableKey]) {
            await syncChildRows(connection, recipeId, tableKey, recipe[tableKey]);
        }
    }
}

async function createRecipe(ownerId, recipe, parentRecipeId, commitMessage) {
    const recipeId = await withTransaction(async (connection) => {
        const [result] = await connection.execute(
            `INSERT INTO recipes (
                owner_id,
                parent_recipe_id,
                title,
                thumbnail,
                description,
                default_branch,
                recipe_status,
                fork_type
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                ownerId,
                parentRecipeId,
                recipe.title,
                recipe.thumbnail,
                recipe.description,
                recipe.default_branch,
                recipe.recipe_status,
                recipe.fork_type
            ]
        );

        await syncAllChildRows(connection, result.insertId, recipe);
        return result.insertId;
    });

    const commit = await commitDolt(commitMessage, ownerId);
    return { commit, recipe: await getRecipeRowById(recipeId) };
}

async function listRecentRecipes(limit = 100) {
    const [rows] = await pool.query(
        `${RECIPE_SELECT}
         WHERE r.recipe_status = 'public'
         ORDER BY r.created_at DESC
         LIMIT ?`,
        [limit]
    );
    return rows;
}

async function listRecipesByOwnerId(ownerId) {
    const [rows] = await pool.query(
        `${RECIPE_SELECT}
         WHERE r.owner_id = ?
         ORDER BY r.created_at DESC`,
        [ownerId]
    );
    return rows;
}

async function listCommitsByRecipeId(recipeId, limit = 100) {
    const [rows] = await pool.query(COMMIT_LIST_SELECT, [...recipeCommitParams(recipeId), limit]);
    return rows;
}

async function getCommitByRecipeId(recipeId, commitHash) {
    const [logs] = await pool.query(COMMIT_SELECT, [commitHash, ...recipeCommitParams(recipeId)]);
    if (!logs[0]) {
        return null;
    }

    const params = [commitHash, recipeId, recipeId];
    const [[info], [environment], [ingredients], [steps]] = await Promise.all([
        pool.query(COMMIT_DIFF_RECIPE, params),
        pool.query(COMMIT_DIFF_ENVIRONMENT, params),
        pool.query(COMMIT_DIFF_INGREDIENTS, params),
        pool.query(COMMIT_DIFF_STEPS, params)
    ]);

    return { ...logs[0], changes: { info, environment, ingredients, steps } };
}

function asOfClause(commitHash) {
    return commitHash ? ' AS OF ?' : '';
}

function asOfParams(commitHash, params) {
    return commitHash ? [commitHash, ...params] : params;
}

async function getRecipeChildren(recipeId, commitHash = null) {
    const asOf = asOfClause(commitHash);
    const params = asOfParams(commitHash, [recipeId]);
    const [[environment], [ingredients], [steps]] = await Promise.all([
        pool.query(
            `SELECT id, key_name, value FROM recipe_environment${asOf} WHERE recipe_id = ? ORDER BY sort_order`,
            params
        ),
        pool.query(
            `SELECT id, name, amount, unit FROM recipe_ingredients${asOf} WHERE recipe_id = ? ORDER BY sort_order`,
            params
        ),
        pool.query(
            `SELECT id, body, image_url FROM recipe_steps${asOf} WHERE recipe_id = ? ORDER BY sort_order`,
            params
        )
    ]);

    return { environment, ingredients, steps };
}

async function getRecipeRowById(recipeId) {
    const [rows] = await pool.query(`${RECIPE_SELECT} WHERE r.recipe_id = ?`, [recipeId]);
    return rows[0] || null;
}

async function getRecipeById(recipeId) {
    const row = await getRecipeRowById(recipeId);
    if (!row) {
        return null;
    }

    const [children, commits] = await Promise.all([
        getRecipeChildren(recipeId),
        listCommitsByRecipeId(recipeId, 1)
    ]);

    return { ...row, ...children, latest_commit: commits[0] || null };
}

async function getRecipeSnapshot(recipeId, commitHash) {
    const [rows] = await pool.query(
        'SELECT title, description, thumbnail, recipe_status FROM recipes AS OF ? WHERE recipe_id = ?',
        [commitHash, recipeId]
    );
    if (!rows[0]) {
        return null;
    }

    const children = await getRecipeChildren(recipeId, commitHash);
    return { ...rows[0], ...children };
}

async function listEnvironmentByRecipeIds(recipeIds) {
    if (recipeIds.length === 0) {
        return [];
    }

    const [rows] = await pool.query(
        `SELECT recipe_id, key_name, value
         FROM recipe_environment
         WHERE recipe_id IN (?)
         ORDER BY recipe_id, sort_order`,
        [recipeIds]
    );
    return rows;
}

async function listRecipesByParentIds(parentIds) {
    if (parentIds.length === 0) {
        return [];
    }

    const [rows] = await pool.query(
        `${RECIPE_SELECT}
         WHERE r.parent_recipe_id IN (?)
         ORDER BY r.created_at`,
        [parentIds]
    );
    return rows;
}

async function deleteRecipeById(recipeId, userId, commitMessage) {
    await withTransaction(async (connection) => {
        await connection.execute('DELETE FROM recipe_environment WHERE recipe_id = ?', [recipeId]);
        await connection.execute('DELETE FROM recipe_ingredients WHERE recipe_id = ?', [recipeId]);
        await connection.execute('DELETE FROM recipe_steps WHERE recipe_id = ?', [recipeId]);
        await connection.execute('DELETE FROM recipe_issues WHERE recipe_id = ?', [recipeId]);
        await connection.execute('DELETE FROM recipe_stars WHERE recipe_id = ?', [recipeId]);
        await connection.execute(
            'DELETE FROM recipe_pull_requests WHERE target_recipe_id = ? OR source_recipe_id = ?',
            [recipeId, recipeId]
        );
        await connection.execute('DELETE FROM recipes WHERE recipe_id = ?', [recipeId]);
    });

    const commit = await commitDolt(commitMessage, userId);
    return { commit };
}

async function applyRecipeUpdate(connection, recipeId, recipe) {
    await connection.execute(
        `UPDATE recipes
         SET title = ?,
             description = ?,
             default_branch = ?,
             recipe_status = ?,
             thumbnail = ?
         WHERE recipe_id = ?`,
        [
            recipe.title,
            recipe.description,
            recipe.default_branch,
            recipe.recipe_status,
            recipe.thumbnail,
            recipeId
        ]
    );

    await syncAllChildRows(connection, recipeId, recipe);
}

async function updateRecipeById(recipeId, userId, recipe, commitMessage) {
    await withTransaction((connection) => applyRecipeUpdate(connection, recipeId, recipe));

    const commit = await commitDolt(commitMessage, userId);
    return { commit };
}

// 取り込む側の id は取り込まれる側の行を指していない
function withoutRowIds(rows) {
    return rows.map((row) => ({ ...row, id: null }));
}

const PULL_REQUEST_SELECT = `
    SELECT p.*,
           a.username,
           s.title AS source_title,
           s.owner_id AS source_owner_id,
           s.recipe_status AS source_recipe_status,
           t.title AS target_title,
           t.owner_id AS target_owner_id,
           t.recipe_status AS target_recipe_status
    FROM recipe_pull_requests p
    JOIN accounts a ON a.user_id = p.user_id
    JOIN recipes s ON s.recipe_id = p.source_recipe_id
    JOIN recipes t ON t.recipe_id = p.target_recipe_id`;

async function getPullRequestById(prId) {
    const [rows] = await pool.query(`${PULL_REQUEST_SELECT} WHERE p.id = ?`, [prId]);
    return rows[0] || null;
}

async function listPullRequestsByTargetRecipeId(recipeId) {
    const [rows] = await pool.query(
        `${PULL_REQUEST_SELECT}
         WHERE p.target_recipe_id = ?
         ORDER BY p.created_at DESC`,
        [recipeId]
    );
    return rows;
}

async function listPullRequestsByUserId(userId) {
    const [rows] = await pool.query(
        `${PULL_REQUEST_SELECT}
         WHERE p.user_id = ?
         ORDER BY p.created_at DESC`,
        [userId]
    );
    return rows;
}

async function finishPullRequest(connection, prId, status) {
    const timestampColumn = status === 'merged' ? 'merged_at' : 'closed_at';
    const [result] = await connection.execute(
        `UPDATE recipe_pull_requests
         SET status = ?, ${timestampColumn} = NOW()
         WHERE id = ? AND status = 'open'`,
        [status, prId]
    );
    if (result.affectedRows === 0) {
        throw httpError(409, 'このプルリクエストは既に対応済みです');
    }
}

async function createPullRequest(sourceRecipeId, targetRecipeId, userId, pullRequest, commitMessage) {
    const { title, content } = pullRequest;

    const [result] = await pool.execute(
        `INSERT INTO recipe_pull_requests (source_recipe_id, target_recipe_id, user_id, title, content)
         VALUES (?, ?, ?, ?, ?)`,
        [sourceRecipeId, targetRecipeId, userId, title, content]
    );

    const created = await getPullRequestById(result.insertId);
    const commit = await commitDolt(commitMessage, userId);

    return { commit, pullRequest: created };
}

// merged_commit_hash は --skip-empty で null になり得るので、マージ済みかは status で見る
async function mergePullRequest(prId, source, target, userId, commitMessage) {
    const mergedContent = {
        ...target,
        description: source.description,
        environment: withoutRowIds(source.environment),
        ingredients: withoutRowIds(source.ingredients),
        steps: withoutRowIds(source.steps)
    };

    await withTransaction(async (connection) => {
        await finishPullRequest(connection, prId, 'merged');
        await applyRecipeUpdate(connection, target.recipe_id, mergedContent);
    });

    const commit = await commitDolt(commitMessage, userId);
    if (commit) {
        await pool.execute('UPDATE recipe_pull_requests SET merged_commit_hash = ? WHERE id = ?', [commit, prId]);
        await commitDolt(`プルリクエストのマージコミットを記録: #${prId}`, userId);
    }

    return { commit, pullRequest: await getPullRequestById(prId) };
}

async function closePullRequest(prId, userId, commitMessage) {
    await withTransaction((connection) => finishPullRequest(connection, prId, 'closed'));
    const commit = await commitDolt(commitMessage, userId);

    return { commit, pullRequest: await getPullRequestById(prId) };
}

async function isRecipeStarred(recipeId, userId) {
    const [rows] = await pool.query(
        'SELECT 1 FROM recipe_stars WHERE recipe_id = ? AND user_id = ?',
        [recipeId, userId]
    );
    return rows.length > 0;
}

async function countRecipeStars(recipeId) {
    const [rows] = await pool.query(
        'SELECT COUNT(*) AS stars_count FROM recipe_stars WHERE recipe_id = ?',
        [recipeId]
    );
    return rows[0].stars_count;
}

async function setRecipeStar(recipeId, userId, starred, commitMessage) {
    if (starred) {
        await pool.execute(
            'INSERT IGNORE INTO recipe_stars (recipe_id, user_id) VALUES (?, ?)',
            [recipeId, userId]
        );
    } else {
        await pool.execute(
            'DELETE FROM recipe_stars WHERE recipe_id = ? AND user_id = ?',
            [recipeId, userId]
        );
    }

    const commit = await commitDolt(commitMessage, userId);
    return { commit, starred, stars_count: await countRecipeStars(recipeId) };
}

async function getIssueById(issueId) {
    const [rows] = await pool.query('SELECT * FROM recipe_issues WHERE id = ?', [issueId]);
    return rows[0] || null;
}

async function createIssue(recipeId, userId, issue, commitMessage) {
    const [result] = await pool.execute(
        'INSERT INTO recipe_issues (recipe_id, user_id, title, content) VALUES (?, ?, ?, ?)',
        [recipeId, userId, issue.title, issue.content]
    );

    const created = await getIssueById(result.insertId);
    const commit = await commitDolt(commitMessage, userId);

    return { commit, issue: created };
}

module.exports = {
    createRecipe,
    listCommitsByRecipeId,
    getCommitByRecipeId,
    listRecentRecipes,
    listRecipesByOwnerId,
    getRecipeById,
    getRecipeRowById,
    getRecipeSnapshot,
    listRecipesByParentIds,
    listEnvironmentByRecipeIds,
    updateRecipeById,
    deleteRecipeById,
    getPullRequestById,
    listPullRequestsByTargetRecipeId,
    listPullRequestsByUserId,
    createPullRequest,
    mergePullRequest,
    closePullRequest,
    isRecipeStarred,
    setRecipeStar,
    createIssue
};
