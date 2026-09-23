require('dotenv').config();
// arktype 本体より先に読み込む。
// フォーク・更新では DB 行に入力を重ねて検証するので、入力ではない列を落とす
require('arktype/config').configure({ onUndeclaredKey: 'delete' });
const express = require('express');
const cors = require('cors');
const { ArkErrors } = require('arktype');

const accountRoutes = require('./routes/accountRoutes');
const recipeRoutes = require('./routes/recipeRoutes');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/accounts', accountRoutes);
app.use('/api/recipes', recipeRoutes);

// .assert() で投げられた ArkErrors は TraversalError に包まれて来る
function toSchemaIssues(error) {
    return error instanceof ArkErrors ? error : error?.arkErrors;
}

// eslint-disable-next-line no-unused-vars
app.use((error, req, res, next) => {
    const issues = toSchemaIssues(error);
    if (issues) {
        res.status(400).json({ error: issues.summary });
        return;
    }

    const status = error.status || 500;
    if (status === 500) {
        console.error(error);
    }
    res.status(status).json({ error: error.message });
});

module.exports = app;
