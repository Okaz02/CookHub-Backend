// 設定の読み込みとスキーマ検証の日本語化（下のエラーハンドラが返すメッセージ）を先に済ませる
require('./config');
const express = require('express');
const cors = require('cors');
const { ArkErrors } = require('arktype');

const accountRoutes = require('./routes/accountRoutes');
const recipeRoutes = require('./routes/recipeRoutes');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/recipes', recipeRoutes);

// スキーマ検証で弾かれた項目の一覧を取り出す。検証のエラーは、スキーマを直接呼ぶ側
// （ミドルウェア）からは ArkErrors がそのまま、.assert() を使う側（service 層）からは
// TraversalError に包まれて渡ってくる。検証以外のエラーなら undefined
function toSchemaIssues(error) {
    return error instanceof ArkErrors ? error : error?.arkErrors;
}

// eslint-disable-next-line no-unused-vars
app.use((error, req, res, next) => {
    const issues = toSchemaIssues(error);
    if (issues) {
        const message = issues
            .map((issue) => (issue.path.length > 0 ? `${issue.propString}: ${issue.problem}` : issue.problem))
            .join(' / ');
        res.status(400).json({ error: message });
        return;
    }

    const status = error.status || 500;
    if (status === 500) {
        console.error(error);
    }
    res.status(status).json({ error: error.message });
});

module.exports = app;
