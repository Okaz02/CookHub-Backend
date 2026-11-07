const path = require('path');
const { once } = require('events');

process.env.DOTENV_CONFIG_QUIET = 'true';

const SRC = path.join(__dirname, '..', 'src');

function mockModule(relativePath, exports) {
    const resolved = require.resolve(path.join(SRC, relativePath));
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

function loadModule(relativePath) {
    return require(path.join(SRC, relativePath));
}

function memoryRateLimitDb() {
    const hits = new Map();
    return {
        incrementRateLimitHit: async (bucketKey, windowStart) => {
            const key = `${bucketKey}:${windowStart}`;
            hits.set(key, (hits.get(key) ?? 0) + 1);
            return hits.get(key);
        },
        deleteExpiredRateLimitHits: async () => {}
    };
}

async function startApp() {
    const app = loadModule('app.js');
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}/api`;

    async function call(method, urlPath, { token, body, headers = {} } = {}) {
        const res = await fetch(base + urlPath, {
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...headers
            },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        return { status: res.status, headers: res.headers, body: await res.json() };
    }

    return {
        call,
        close: () => new Promise((resolve) => server.close(resolve))
    };
}

const OWNER_TOKEN = 'a'.repeat(40);
const OTHER_TOKEN = 'b'.repeat(40);

function mockSessions(extra = {}) {
    mockModule('services/accountService.js', {
        getAccountBySession: async (token) => ({ user_id: token === OWNER_TOKEN ? 10 : 20, username: 'u' }),
        registerAccount: async () => ({ user_id: 1 }),
        loginAccount: async () => ({ user_id: 1 }),
        logoutAccount: async () => ({ ok: true }),
        ...extra
    });
}

module.exports = {
    mockModule,
    loadModule,
    memoryRateLimitDb,
    startApp,
    mockSessions,
    OWNER_TOKEN,
    OTHER_TOKEN
};
