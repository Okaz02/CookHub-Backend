const app = require('./src/app');
const { PORT } = require('./src/config');

app.listen(PORT, () => {
    console.log(`cookhub api listening on port ${PORT}`);
});
