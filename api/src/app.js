require('dotenv').config();
const express = require('express');
const cors = require('cors');

const accountRoutes = require('./routes/accountRoutes');
const repoRoutes = require('./routes/repoRoutes');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/accounts', accountRoutes);
app.use('/api/repos', repoRoutes);

// eslint-disable-next-line no-unused-vars
app.use((error, req, res, next) => {
    const status = error.status || 500;
    if (status === 500) {
        console.error(error);
    }
    res.status(status).json({ error: error.message });
});

module.exports = app;
