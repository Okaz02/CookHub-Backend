// 設定の読み込みと zod の日本語化（下のエラーハンドラが返すメッセージ）を先に済ませる
require('./config');
const express = require('express');
const cors = require('cors');
const { z } = require('zod');

const accountRoutes = require('./routes/accountRoutes');
const repoRoutes = require('./routes/repoRoutes');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/accounts', accountRoutes);
app.use('/api/repos', repoRoutes);

// eslint-disable-next-line no-unused-vars
app.use((error, req, res, next) => {
    // 入力がスキーマに合わなかった場合。どの項目が駄目だったのかまで返す
    if (error instanceof z.ZodError) {
        const message = error.issues
            .map((issue) => (issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
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
