const { commitDolt } = require('../clients/doltClient');
const { pool } = require('./pool');

const RECIPE_SELECT = `
    SELECT r.recipe_id,
           r.title,
           r.description,
           r.default_branch,
           r.thumbnail,
           r.stars_count,
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
const COMMIT_LIST_SELECT = `
    SELECT l.commit_hash, l.message, l.committer, l.email, l.date
    FROM dolt_log l
    WHERE l.commit_hash IN (
        SELECT to_commit FROM dolt_diff_recipes                  WHERE to_recipe_id = ? OR from_recipe_id = ?
        UNION SELECT to_commit FROM dolt_diff_recipe_environment WHERE to_recipe_id = ? OR from_recipe_id = ?
        UNION SELECT to_commit FROM dolt_diff_recipe_ingredients WHERE to_recipe_id = ? OR from_recipe_id = ?
        UNION SELECT to_commit FROM dolt_diff_recipe_steps       WHERE to_recipe_id = ? OR from_recipe_id = ?
    )
    ORDER BY l.date DESC
    LIMIT ?`;

const COMMIT_SELECT = `
    SELECT l.commit_hash, l.message, l.committer, l.email, l.date
    FROM dolt_log l
    WHERE l.commit_hash = ?`;

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

// id の無い行には余っている既存行を順に割り当てる。一律に削除＋追加にすると、
// 変わっていない行まで Dolt の差分に出る
function matchExistingRows(rows, existingIds) {
    const available = new Set(existingIds);

    // 先に確保しないと、位置で取った行が後ろの id 指定とぶつかる
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

async function createRecipe(ownerId, recipe, parentRecipeId, commitMessage) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [result] = await connection.execute(
            `INSERT INTO recipes (
                owner_id,
                parent_recipe_id,
                title,
                thumbnail,
                description,
                default_branch,
                stars_count,
                recipe_status,
                fork_type
            ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
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

        const recipeId = result.insertId;

        if (recipe.environment && recipe.environment.length > 0) {
            await connection.query(
                'INSERT INTO recipe_environment (recipe_id, sort_order, key_name, value) VALUES ?',
                [recipe.environment.map((row, i) => [recipeId, i, row.key_name, row.value])]
            );
        }

        if (recipe.ingredients && recipe.ingredients.length > 0) {
            await connection.query(
                'INSERT INTO recipe_ingredients (recipe_id, sort_order, name, amount, unit) VALUES ?',
                [recipe.ingredients.map((row, i) => [recipeId, i, row.name, row.amount, row.unit])]
            );
        }

        if (recipe.steps && recipe.steps.length > 0) {
            await connection.query(
                'INSERT INTO recipe_steps (recipe_id, sort_order, body, image_url) VALUES ?',
                [recipe.steps.map((row, i) => [recipeId, i, row.body, row.image_url])]
            );
        }

        await connection.commit();

        const [rows] = await pool.query(`${RECIPE_SELECT} WHERE r.recipe_id = ?`, [recipeId]);
        const commit = await commitDolt(commitMessage, ownerId);

        return { commit, recipe: rows[0] || null };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
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
    const [rows] = await pool.query(COMMIT_LIST_SELECT, [
        recipeId, recipeId,
        recipeId, recipeId,
        recipeId, recipeId,
        recipeId, recipeId,
        limit
    ]);
    return rows;
}

async function getCommitByRecipeId(recipeId, commitHash) {
    const [logs] = await pool.query(COMMIT_SELECT, [commitHash]);
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

async function getRecipeById(recipeId) {
    const [rows] = await pool.query(`${RECIPE_SELECT} WHERE r.recipe_id = ?`, [recipeId]);

    const row = rows[0];
    if (!row) {
        return null;
    }

    const [[environment], [ingredients], [steps], commits] = await Promise.all([
        pool.query(
            'SELECT id, key_name, value FROM recipe_environment WHERE recipe_id = ? ORDER BY sort_order',
            [recipeId]
        ),
        pool.query(
            'SELECT id, name, amount, unit FROM recipe_ingredients WHERE recipe_id = ? ORDER BY sort_order',
            [recipeId]
        ),
        pool.query(
            'SELECT id, body, image_url FROM recipe_steps WHERE recipe_id = ? ORDER BY sort_order',
            [recipeId]
        ),
        listCommitsByRecipeId(recipeId, 1)
    ]);

    return { ...row, environment, ingredients, steps, latest_commit: commits[0] || null };
}

async function deleteRecipeById(recipeId, userId, commitMessage) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        await connection.execute('DELETE FROM recipe_environment WHERE recipe_id = ?', [recipeId]);
        await connection.execute('DELETE FROM recipe_ingredients WHERE recipe_id = ?', [recipeId]);
        await connection.execute('DELETE FROM recipe_steps WHERE recipe_id = ?', [recipeId]);
        await connection.execute(
            'DELETE FROM recipe_pull_requests WHERE target_recipe_id = ? OR source_recipe_id = ?',
            [recipeId, recipeId]
        );
        await connection.execute('DELETE FROM recipes WHERE recipe_id = ?', [recipeId]);

        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }

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

    if (recipe.environment) {
        await syncChildRows(connection, recipeId, 'environment', recipe.environment);
    }

    if (recipe.ingredients) {
        await syncChildRows(connection, recipeId, 'ingredients', recipe.ingredients);
    }

    if (recipe.steps) {
        await syncChildRows(connection, recipeId, 'steps', recipe.steps);
    }
}

async function updateRecipeById(recipeId, userId, recipe, commitMessage) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        await applyRecipeUpdate(connection, recipeId, recipe);
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }

    const commit = await commitDolt(commitMessage, userId);
    return { commit };
}

// 取り込む側の id は取り込まれる側の行を指していない
function withoutRowIds(rows) {
    return rows.map((row) => ({ ...row, id: null }));
}

async function getPullRequestById(prId) {
    const [rows] = await pool.query('SELECT * FROM recipe_pull_requests WHERE id = ?', [prId]);
    return rows[0] || null;
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

// merged_commit_hash は --skip-empty で null になり得るので、マージ済みかは merged_at で見る
async function mergePullRequest(prId, userId, commitMessage) {
    const pullRequest = await getPullRequestById(prId);
    if (!pullRequest) {
        return null;
    }
    if (pullRequest.merged_at) {
        const err = new Error('このプルリクエストは既にマージ済みです');
        err.status = 409;
        throw err;
    }

    const source = await getRecipeById(pullRequest.source_recipe_id);
    const target = await getRecipeById(pullRequest.target_recipe_id);
    const mergedContent = {
        ...target,
        description: source.description,
        environment: withoutRowIds(source.environment),
        ingredients: withoutRowIds(source.ingredients),
        steps: withoutRowIds(source.steps)
    };

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        await applyRecipeUpdate(connection, pullRequest.target_recipe_id, mergedContent);
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }

    const commit = await commitDolt(commitMessage, userId);

    // マージのコミットハッシュはコミット後にしか分からないので、記録してから改めてコミットする
    await pool.execute(
        'UPDATE recipe_pull_requests SET status = ?, merged_commit_hash = ?, merged_at = NOW() WHERE id = ?',
        ['merged', commit, pullRequest.id]
    );
    await commitDolt(`プルリクエストをマージ済みとして記録: #${pullRequest.id}`, userId);

    return { commit, pullRequest: await getPullRequestById(pullRequest.id) };
}

async function createIssue(targetRecipeId) {
    const [rows] = await pool.execute(
        'SELECT * FROM recipe_pull_requests WHERE target_recipe_id = ?',
        [targetRecipeId]
    );
    return rows;
}

module.exports = {
    createRecipe,
    listCommitsByRecipeId,
    getCommitByRecipeId,
    listRecentRecipes,
    listRecipesByOwnerId,
    getRecipeById,
    updateRecipeById,
    deleteRecipeById,
    getPullRequestById,
    createPullRequest,
    mergePullRequest
};
