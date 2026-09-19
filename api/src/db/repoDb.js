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

// 送られてきた行を「既存のどの行を書き換えるか」に対応づける。戻り値は rows と同じ長さで、
// 書き換える既存行の id か、新しく足す行なら null が並ぶ。
// id が入っていればその行を使い、入っていなければ余っている既存行を上から順に使い回す。
//
// id 無しを一律 INSERT（＋既存を全部 DELETE）にしてしまうと、id を送ってこない
// クライアントからの更新で、中身が1つも変わっていない材料や手順まで Dolt の差分に
// 「削除」「追加」として並んでしまう。位置で拾い直せば、実際に変わった行だけが差分に出る
function matchExistingRows(rows, existingIds) {
    const available = new Set(existingIds);

    // id 指定のぶんを先に確保する。順番を逆にすると、位置で取った行が後ろの id 指定とぶつかる
    const targetIds = rows.map((row) => {
        if (row.id != null && available.has(row.id)) {
            available.delete(row.id);
            return row.id;
        }
        return null;
    });

    // 誰にも指定されなかった既存行を、id の無い行へ前から順に割り当てる（足りなければ新規行）
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

// recipe は repoSchemas の recipeSchema を通った値。列の型・既定値の補完は済んでいる。
// parentRecipeId はフォーク元のレシピID（オリジナルなら null）
async function createRecipe(ownerId, recipe, parentRecipeId, commitMessage) {
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
                parentRecipeId,
                recipe.title,
                recipe.thumbnail,
                recipe.description,
                recipe.default_branch,
                Number(recipe.is_private),
                Number(recipe.is_draft),
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
         WHERE r.is_private = FALSE
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
        pool.query(COMMIT_DIFF_REPO, params),
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
        await connection.execute('DELETE FROM repos_information WHERE recipe_id = ?', [recipeId]);

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

// repos_information の本体列と子テーブル(environment/ingredients/steps)を、
// 開いている connection の中でまとめて書き換える。updateRecipeById と
// mergePullRequest の両方から使う（同じ書き換えを2箇所に書かないため）。
// recipe は recipeSchema を通った値か、同じ形に組み立てた既存のレシピ行
async function applyRecipeUpdate(connection, recipeId, recipe) {
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
            recipe.title,
            recipe.description,
            recipe.default_branch,
            Number(recipe.is_private),
            Number(recipe.is_draft),
            recipe.thumbnail,
            recipeId
        ]
    );

    // 省略された子テーブルは現状維持。[] が渡されたときだけ全削除になる
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

// 取り込む側の行の id は取り込まれる側の行を指していないので、そのまま渡すと
// 無関係な行を書き換えてしまう。id を外して syncChildRows に位置で対応づけさせる
function withoutRowIds(rows) {
    return rows.map((row) => ({ ...row, id: null }));
}

// recipe_pull_requests.status のコード。0（デフォルト）が open で、それ以外は未定義だったので
// マージ済みを表す値を決める
const PR_STATUS_MERGED = 1;

async function getPullRequestById(prId) {
    const [rows] = await pool.query('SELECT * FROM recipe_pull_requests WHERE id = ?', [prId]);
    return rows[0] || null;
}

// source（フォークした自分のレシピ）の変更を target（フォーク元のレシピ）に
// 取り込んでほしいという提案を1件作る
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

// PR を1件マージする。source の中身（説明・必須環境・材料・手順）を target に書き写す。
// マージ済みかどうかは merged_at の有無で判定する（target が source と既に同じ内容の場合、
// commitDolt は --skip-empty により null を返すことがあるため merged_commit_hash では判定できない）。
// タイトルや公開設定など target 自体の属性は変えない
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

    // マージで生まれたコミットのハッシュはコミット後にしか分からないため、
    // レシピ本体の書き換えとは別に記録し、そのための変更も改めてコミットする
    await pool.execute(
        'UPDATE recipe_pull_requests SET status = ?, merged_commit_hash = ?, merged_at = NOW() WHERE id = ?',
        [PR_STATUS_MERGED, commit, pullRequest.id]
    );
    await commitDolt(`プルリクエストをマージ済みとして記録: #${pullRequest.id}`, userId);

    return { commit, pullRequest: await getPullRequestById(pullRequest.id) };
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
