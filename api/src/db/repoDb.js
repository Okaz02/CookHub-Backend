const { commitDolt } = require('../clients/doltClient');
const { pool } = require('./pool');

// レシピ取得の共通部分。呼び出し側で WHERE / ORDER BY / LIMIT を足して使う。
// カラム名はDBのまま返し、repo語彙への翻訳はservice層のtoRepo()に任せる
const RECIPE_SELECT = `
    SELECT r.recipe_id,
           r.title,
           r.description,
           r.default_branch,
           r.thumbnail,
           r.stars_count,
           r.is_private,
           r.is_draft,
           r.parent_recipe_id,
           r.fork_type,
           r.created_at,
           r.updated_at,
           a.user_id,
           a.username
    FROM repos_information r
    JOIN accounts a ON a.user_id = r.owner_id`;

// あるレシピに触れたコミットの一覧。子テーブルだけの変更（材料の増減など）も
// 履歴に出したいので、4つの差分テーブルを横断してコミットハッシュを集める
const COMMIT_LIST_SELECT = `
    SELECT l.commit_hash, l.message, l.committer, l.email, l.date
    FROM dolt_log l
    WHERE l.commit_hash IN (
        SELECT to_commit FROM dolt_diff_repos_information        WHERE to_recipe_id = ? OR from_recipe_id = ?
        UNION SELECT to_commit FROM dolt_diff_recipe_environment WHERE to_recipe_id = ? OR from_recipe_id = ?
        UNION SELECT to_commit FROM dolt_diff_recipe_ingredients WHERE to_recipe_id = ? OR from_recipe_id = ?
        UNION SELECT to_commit FROM dolt_diff_recipe_steps       WHERE to_recipe_id = ? OR from_recipe_id = ?
    )
    ORDER BY l.date DESC
    LIMIT ?`;

// コミット1件のメタ情報。dolt_log は全レシピ共通なのでハッシュだけで引ける
const COMMIT_SELECT = `
    SELECT l.commit_hash, l.message, l.committer, l.email, l.date
    FROM dolt_log l
    WHERE l.commit_hash = ?`;

// そのコミットでレシピのどこが変わったか。Before/After を並べて表示するため、
// 変更前（from_）と変更後（to_）の値を表示に使う列だけ取り出す
const COMMIT_DIFF_REPO = `
    SELECT diff_type,
           from_title, to_title,
           from_thumbnail, to_thumbnail,
           from_description, to_description,
           from_is_private, to_is_private,
           from_is_draft, to_is_draft
    FROM dolt_diff_repos_information
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

function normalizeJsonValue(...values) {
    const value = values.find(
        (candidate) => candidate !== undefined && candidate !== null && candidate !== ''
    );

    if (value === undefined) {
        return null;
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }

    return JSON.stringify(value);
}

function normalizeRecipeInput(recipe = {}) {
    return {
        title: normalizeJsonValue(recipe.title, recipe.name),
        description: normalizeJsonValue(recipe.description, null),
        defaultBranch: normalizeJsonValue(recipe.default_branch, 'main'),
        parentRecipeId: normalizeJsonValue(recipe.parent_recipe_id, null),
        isPrivate: normalizeJsonValue(recipe.is_private, false),
        isDraft: normalizeJsonValue(recipe.is_draft, false),
        forkType: normalizeJsonValue(recipe.fork_type, 0),
        thumbnail: normalizeJsonValue(recipe.thumbnail, null)
    };
}

function normalizeEnvironment(environment) {
    if (!Array.isArray(environment)) {
        return [];
    }

    return environment.map((entry = {}) => ({
        id: entry.id != null ? Number(entry.id) : null,
        keyName: entry.key_name,
        value: entry.value
    }));
}

function normalizeIngredients(ingredients) {
    if (!Array.isArray(ingredients)) {
        return [];
    }

    return ingredients.map((ingredient = {}) => ({
        id: ingredient.id != null ? Number(ingredient.id) : null,
        name: ingredient.name,
        amount: ingredient.amount ?? null,
        unit: ingredient.unit ?? null
    }));
}

function normalizeSteps(steps) {
    if (!Array.isArray(steps)) {
        return [];
    }

    return steps.map((step = {}) => ({
        id: step.id != null ? Number(step.id) : null,
        body: step.body,
        imageUrl: step.image_url ?? null
    }));
}

const CHILD_TABLES = {
    environment: {
        values: (row) => [row.keyName, row.value],
        selectIds: 'SELECT id FROM recipe_environment WHERE recipe_id = ?',
        update: `UPDATE recipe_environment
                 SET sort_order = ?, key_name = ?, value = ?
                 WHERE id = ? AND recipe_id = ?`,
        insert: `INSERT INTO recipe_environment (recipe_id, sort_order, key_name, value)
                 VALUES (?, ?, ?, ?)`,
        deleteIds: 'DELETE FROM recipe_environment WHERE id IN (?)'
    },
    ingredients: {
        values: (row) => [row.name, row.amount, row.unit],
        selectIds: 'SELECT id FROM recipe_ingredients WHERE recipe_id = ?',
        update: `UPDATE recipe_ingredients
                 SET sort_order = ?, name = ?, amount = ?, unit = ?
                 WHERE id = ? AND recipe_id = ?`,
        insert: `INSERT INTO recipe_ingredients (recipe_id, sort_order, name, amount, unit)
                 VALUES (?, ?, ?, ?, ?)`,
        deleteIds: 'DELETE FROM recipe_ingredients WHERE id IN (?)'
    },
    steps: {
        values: (row) => [row.body, row.imageUrl],
        selectIds: 'SELECT id FROM recipe_steps WHERE recipe_id = ?',
        update: `UPDATE recipe_steps
                 SET sort_order = ?, body = ?, image_url = ?
                 WHERE id = ? AND recipe_id = ?`,
        insert: `INSERT INTO recipe_steps (recipe_id, sort_order, body, image_url)
                 VALUES (?, ?, ?, ?)`,
        deleteIds: 'DELETE FROM recipe_steps WHERE id IN (?)'
    }
};

async function syncChildRows(connection, recipeId, tableKey, rows) {
    const child = CHILD_TABLES[tableKey];
    const [existing] = await connection.query(child.selectIds, [recipeId]);
    const existingIds = new Set(existing.map((row) => row.id));
    const keptIds = new Set();

    for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        if (existingIds.has(row.id)) {
            await connection.execute(child.update, [i, ...child.values(row), row.id, recipeId]);
            keptIds.add(row.id);
        } else {
            await connection.execute(child.insert, [recipeId, i, ...child.values(row)]);
        }
    }

    const removedIds = [...existingIds].filter((id) => !keptIds.has(id));
    if (removedIds.length > 0) {
        await connection.query(child.deleteIds, [removedIds]);
    }
}

async function createRecipe(ownerId, recipe, commitMessage) {
    const { title, description, defaultBranch, parentRecipeId, isPrivate, isDraft, forkType, thumbnail } =
        normalizeRecipeInput(recipe);

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [result] = await connection.execute(
            `INSERT INTO repos_information (
                owner_id,
                parent_recipe_id,
                title,
                thumbnail,
                description,
                default_branch,
                stars_count,
                is_private,
                is_draft,
                fork_type
            ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
            [
                ownerId,
                parentRecipeId === null ? null : Number(parentRecipeId),
                title,
                thumbnail,
                description,
                defaultBranch,
                Number(isPrivate),
                Number(isDraft),
                Number(forkType)
            ]
        );

        const recipeId = result.insertId;

        const environment = normalizeEnvironment(recipe.environment);
        if (environment.length > 0) {
            await connection.query(
                'INSERT INTO recipe_environment (recipe_id, sort_order, key_name, value) VALUES ?',
                [environment.map((row, i) => [recipeId, i, row.keyName, row.value])]
            );
        }

        const ingredients = normalizeIngredients(recipe.ingredients);
        if (ingredients.length > 0) {
            await connection.query(
                'INSERT INTO recipe_ingredients (recipe_id, sort_order, name, amount, unit) VALUES ?',
                [ingredients.map((row, i) => [recipeId, i, row.name, row.amount, row.unit])]
            );
        }

        const steps = normalizeSteps(recipe.steps);
        if (steps.length > 0) {
            await connection.query(
                'INSERT INTO recipe_steps (recipe_id, sort_order, body, image_url) VALUES ?',
                [steps.map((row, i) => [recipeId, i, row.body, row.imageUrl])]
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
         WHERE r.is_private = FALSE
         ORDER BY r.created_at DESC
         LIMIT ?`,
        [Number(limit)]
    );
    return rows;
}

async function listRecipesByOwnerId(ownerId) {
    const [rows] = await pool.query(
        `${RECIPE_SELECT}
         WHERE r.owner_id = ?
         ORDER BY r.created_at DESC`,
        [Number(ownerId)]
    );
    return rows;
}

async function listCommitsByRecipeId(recipeId, limit = 100) {
    const id = Number(recipeId);
    const [rows] = await pool.query(COMMIT_LIST_SELECT, [
        id, id,
        id, id,
        id, id,
        id, id,
        Number(limit)
    ]);
    return rows;
}

async function getCommitByRecipeId(recipeId, commitHash) {
    const [logs] = await pool.query(COMMIT_SELECT, [commitHash]);
    if (!logs[0]) {
        return null;
    }

    const id = Number(recipeId);
    const params = [commitHash, id, id];
    const [[info], [environment], [ingredients], [steps]] = await Promise.all([
        pool.query(COMMIT_DIFF_REPO, params),
        pool.query(COMMIT_DIFF_ENVIRONMENT, params),
        pool.query(COMMIT_DIFF_INGREDIENTS, params),
        pool.query(COMMIT_DIFF_STEPS, params)
    ]);

    return { ...logs[0], changes: { info, environment, ingredients, steps } };
}

async function getRecipeById(recipeId) {
    const id = Number(recipeId);
    const [rows] = await pool.query(`${RECIPE_SELECT} WHERE r.recipe_id = ?`, [id]);

    const row = rows[0];
    if (!row) {
        return null;
    }

    const [[environment], [ingredients], [steps], commits] = await Promise.all([
        pool.query(
            'SELECT id, key_name, value FROM recipe_environment WHERE recipe_id = ? ORDER BY sort_order',
            [id]
        ),
        pool.query(
            'SELECT id, name, amount, unit FROM recipe_ingredients WHERE recipe_id = ? ORDER BY sort_order',
            [id]
        ),
        pool.query(
            'SELECT id, body, image_url FROM recipe_steps WHERE recipe_id = ? ORDER BY sort_order',
            [id]
        ),
        listCommitsByRecipeId(id, 1)
    ]);

    return { ...row, environment, ingredients, steps, latest_commit: commits[0] || null };
}

async function deleteRecipeById(recipeId, userId, commitMessage) {
    const id = Number(recipeId);
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        await connection.execute('DELETE FROM recipe_environment WHERE recipe_id = ?', [id]);
        await connection.execute('DELETE FROM recipe_ingredients WHERE recipe_id = ?', [id]);
        await connection.execute('DELETE FROM recipe_steps WHERE recipe_id = ?', [id]);
        await connection.execute('DELETE FROM repos_information WHERE recipe_id = ?', [id]);

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

async function updateRecipeById(recipeId, userId, recipe, commitMessage) {
    const normalizedRecipe = normalizeRecipeInput(recipe);
    const id = Number(recipeId);

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        await connection.execute(
            `UPDATE repos_information
             SET title = ?,
                 description = ?,
                 default_branch = ?,
                 is_private = ?,
                 is_draft = ?,
                 thumbnail = ?
             WHERE recipe_id = ?`,
            [
                normalizedRecipe.title,
                normalizedRecipe.description,
                normalizedRecipe.defaultBranch,
                Number(normalizedRecipe.isPrivate),
                Number(normalizedRecipe.isDraft),
                normalizedRecipe.thumbnail,
                id
            ]
        );

        if (Array.isArray(recipe.environment)) {
            await syncChildRows(connection, id, 'environment', normalizeEnvironment(recipe.environment));
        }

        if (Array.isArray(recipe.ingredients)) {
            await syncChildRows(connection, id, 'ingredients', normalizeIngredients(recipe.ingredients));
        }

        if (Array.isArray(recipe.steps)) {
            await syncChildRows(connection, id, 'steps', normalizeSteps(recipe.steps));
        }

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

module.exports = {
    createRecipe,
    listCommitsByRecipeId,
    getCommitByRecipeId,
    listRecentRecipes,
    listRecipesByOwnerId,
    getRecipeById,
    updateRecipeById,
    deleteRecipeById
};
