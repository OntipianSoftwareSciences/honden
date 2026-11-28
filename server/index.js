import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Pool } from 'pg';
import { WebSocket, WebSocketServer } from 'ws';
import * as webPush from 'web-push';
import { fcmConfigured, sendFcmCallMessage } from './fcm.js';
import { canAccessConversation, createSecret, isAfterCursor, isOriginAllowed, isValidChatId, isValidMessageId, isValidMessageText, isValidMomentText, issueToken, verifyToken, } from './protocol.js';
const here = dirname(fileURLToPath(import.meta.url));
const legacyDataDir = join(here, 'data');
const apkReleaseUrl = 'https://github.com/OntipianSoftwareSciences/honden/releases/download/apk-latest/honden.apk';
const errorCopy = 'Something went wrong on our side. Nothing was sent. Try again in a moment.';
const accountError = "We couldn't find that account. Check the spelling and try again.";
const takenError = 'That @username is already taken. Try another one.';
const mismatchError = "Those passwords don't match. Try again.";
const recoveryError = "That recovery code doesn't match. Check it and try again.";
const rateLimitError = 'Too many tries. Wait a minute and try again.';
const recoveryNotice = 'Your recovery code is still the same. Keep it safe.';
const globalThreadId = '#honey-den';
const globalError = 'Please keep #honey-den kind and link-free.';
const globalRateLimit = new Map();
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
let vapidConfigured = false;
try {
    if (!vapidPublicKey || !vapidPrivateKey)
        throw new Error('VAPID keys missing');
    webPush.setVapidDetails('mailto:taulikespie@gmail.com', vapidPublicKey, vapidPrivateKey);
    vapidConfigured = true;
}
catch {
    console.warn('Web Push disabled: VAPID keys missing or invalid, push will not work until they are set correctly in Render');
}
function normalizeCallUsername(value) {
    return value.trim().replace(/^@/, '').toLowerCase();
}
function blockedGlobalText(text) {
    return (/(https?:\/\/|www\.|t\.me\/|discord\.gg\/|bit\.ly\/|tinyurl\.com\/)/i.test(text) ||
        /\b(f[\*u]ck|sh[i\*]t|b[i\*]tch|n[i\*]gg\w*|f[a\*]g\w*|retard\w*)\b/i.test(text));
}
function isMessage(value) {
    if (!value || typeof value !== 'object')
        return false;
    const item = value;
    return (typeof item.id === 'string' &&
        typeof item.chatId === 'string' &&
        typeof item.sender === 'string' &&
        (item.recipient == null || typeof item.recipient === 'string') &&
        typeof item.text === 'string' &&
        typeof item.time === 'string');
}
function isStoredUser(value) {
    if (!value || typeof value !== 'object')
        return false;
    const user = value;
    return (typeof user.username === 'string' &&
        typeof user.salt === 'string' &&
        typeof user.passwordHash === 'string');
}
function cleanUsername(value) {
    if (typeof value !== 'string')
        return null;
    const name = value.trim().replace(/^@/, '').trim().toLowerCase();
    return /^[a-z0-9_]{2,24}$/.test(name) ? name : null;
}
/** Only plain https://ko-fi.com/<name> links are accepted, with no query or fragment. */
function normalizeKoFiUrl(value) {
    if (typeof value !== 'string')
        return null;
    const raw = value.trim();
    if (!raw)
        return null;
    try {
        const url = new URL(raw);
        if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'ko-fi.com')
            return null;
        if (url.port || url.username || url.password || url.search || url.hash)
            return null;
        const path = url.pathname.replace(/\/+$/, '');
        if (!/^\/[A-Za-z0-9_-]{1,40}$/.test(path))
            return null;
        return `https://ko-fi.com${path}`;
    }
    catch {
        return null;
    }
}
function readJsonArray(file, guard) {
    if (!existsSync(file))
        return [];
    try {
        const parsed = JSON.parse(readFileSync(file, 'utf8'));
        return Array.isArray(parsed) ? parsed.filter(guard) : [];
    }
    catch {
        return [];
    }
}
function jsonPaths(name) {
    return [join(legacyDataDir, name)];
}
function readMessagesFromJson() {
    const seen = new Set();
    const found = [];
    for (const file of jsonPaths('messages.json')) {
        for (const message of readJsonArray(file, isMessage)) {
            if (seen.has(message.id))
                continue;
            seen.add(message.id);
            found.push(message);
        }
    }
    return found;
}
function readUsersFromJson() {
    const seen = new Set();
    const found = [];
    for (const file of jsonPaths('users.json')) {
        for (const user of readJsonArray(file, isStoredUser)) {
            const username = cleanUsername(user.username) ?? user.username;
            if (seen.has(username))
                continue;
            seen.add(username);
            found.push({ ...user, username });
        }
    }
    return found;
}
function parseJwk(value) {
    if (!value)
        return null;
    if (typeof value === 'object')
        return value;
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        }
        catch {
            return null;
        }
    }
    return null;
}
let messages = [];
let moments = [];
let users = [];
let pool = null;
let sessionSecret = '';
const storageSource = 'Postgres';
let writeQueue = Promise.resolve();
async function migrateJsonToPostgres(activePool) {
    const marker = await activePool.query("SELECT value FROM storage_meta WHERE key = 'json_migrated'");
    if ((marker.rowCount ?? 0) > 0)
        return;
    const jsonUsers = readUsersFromJson();
    const jsonMessages = readMessagesFromJson();
    const client = await activePool.connect();
    try {
        await client.query('BEGIN');
        for (const user of jsonUsers) {
            await client.query(`INSERT INTO users
          (username, salt, password_hash, public_jwk, recovery_salt, recovery_hash, recovery_attempts, recovery_locked_until)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (username) DO NOTHING`, [
                user.username,
                user.salt,
                user.passwordHash,
                user.publicJwk ? JSON.stringify(user.publicJwk) : null,
                user.recoverySalt ?? null,
                user.recoveryHash ?? null,
                user.recoveryAttempts ?? 0,
                user.recoveryLockedUntil ?? 0,
            ]);
        }
        for (const message of jsonMessages) {
            await client.query(`INSERT INTO messages (id, chat_id, sender, sender_id, recipient_id, text, time)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING`, [
                message.id,
                message.chatId,
                message.sender,
                message.sender,
                message.chatId === globalThreadId ? null : message.chatId,
                message.text,
                message.time,
            ]);
        }
        await client.query(`INSERT INTO storage_meta (key, value) VALUES ('json_migrated', '1')
       ON CONFLICT (key) DO NOTHING`);
        await client.query('COMMIT');
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
}
async function loadFromPostgres(activePool) {
    const userRows = await activePool.query('SELECT * FROM users ORDER BY username');
    users = userRows.rows.map((row) => ({
        username: String(row.username),
        salt: String(row.salt),
        passwordHash: String(row.password_hash),
        publicJwk: parseJwk(row.public_jwk),
        koFiUrl: row.ko_fi_url == null ? null : String(row.ko_fi_url),
        privateKeyBackup: parseJwk(row.private_key_backup) ?? undefined,
        recoverySalt: row.recovery_salt == null ? undefined : String(row.recovery_salt),
        recoveryHash: row.recovery_hash == null ? undefined : String(row.recovery_hash),
        recoveryAttempts: Number(row.recovery_attempts ?? 0),
        recoveryLockedUntil: Number(row.recovery_locked_until ?? 0),
    }));
    const messageRows = await activePool.query(`SELECT id, chat_id, sender, recipient_id, text, time
     FROM messages ORDER BY time ASC, id ASC`);
    messages = messageRows.rows.map((row) => {
        const chatId = String(row.chat_id);
        const sender = String(row.sender);
        return {
            id: String(row.id),
            chatId,
            sender,
            recipient: row.recipient_id == null
                ? null
                : String(row.recipient_id) || (chatId === globalThreadId ? null : chatId),
            text: String(row.text),
            time: String(row.time),
        };
    });
    const momentRows = await activePool.query(`SELECT id, chat_id, sender, text, time
     FROM moments ORDER BY time ASC, id ASC`);
    moments = momentRows.rows.map((row) => ({
        id: String(row.id),
        chatId: String(row.chat_id),
        sender: String(row.sender),
        text: String(row.text),
        time: String(row.time),
    }));
}
function queuePostgresWrite(write) {
    const next = writeQueue.then(write, write);
    writeQueue = next.then(() => undefined, () => undefined);
    return next;
}
async function initStorage() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        console.warn('DATABASE_URL is required. HonDen stores accounts and messages in Postgres.');
        throw new Error('DATABASE_URL is required. HonDen stores accounts and messages in Postgres.');
    }
    const activePool = new Pool({
        connectionString: databaseUrl,
        max: 3,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    });
    try {
        await activePool.query(`
        CREATE TABLE IF NOT EXISTS users (
          username text PRIMARY KEY,
          salt text NOT NULL,
          password_hash text NOT NULL,
          public_jwk jsonb,
          private_key_backup jsonb,
          recovery_salt text,
          recovery_hash text,
          recovery_attempts integer NOT NULL DEFAULT 0,
          recovery_locked_until bigint NOT NULL DEFAULT 0
        )
      `);
        await activePool.query(`
        CREATE TABLE IF NOT EXISTS messages (
          id text PRIMARY KEY,
          chat_id text NOT NULL,
          sender text NOT NULL,
          text text NOT NULL,
          time text NOT NULL
        )
      `);
        await activePool.query(`
        CREATE TABLE IF NOT EXISTS moments (
          id text PRIMARY KEY,
          chat_id text NOT NULL,
          sender text NOT NULL,
          text text NOT NULL,
          time text NOT NULL
        )
      `);
        await activePool.query(`
        CREATE TABLE IF NOT EXISTS storage_meta (
          key text PRIMARY KEY,
          value text NOT NULL
        )
      `);
        await activePool.query(`
        CREATE TABLE IF NOT EXISTS push_subscriptions (
          id text PRIMARY KEY,
          username text NOT NULL,
          device_id text,
          subscription jsonb NOT NULL,
          call_notifications boolean NOT NULL DEFAULT true
        )
      `);
        await activePool.query('ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS message_notifications boolean NOT NULL DEFAULT false');
        await activePool.query(`
        CREATE TABLE IF NOT EXISTS fcm_tokens (
          token text PRIMARY KEY,
          username text NOT NULL,
          device_id text,
          call_notifications boolean NOT NULL DEFAULT true
        )
      `);
        await activePool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS private_key_backup jsonb');
        await activePool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS ko_fi_url text');
        await activePool.query('ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_id text');
        await activePool.query('ALTER TABLE messages ADD COLUMN IF NOT EXISTS recipient_id text');
        await activePool.query(`UPDATE messages
       SET sender_id = sender,
           recipient_id = CASE WHEN chat_id = $1 THEN NULL ELSE chat_id END
       WHERE sender_id IS NULL OR recipient_id IS NULL`, [globalThreadId]);
        await activePool.query('CREATE INDEX IF NOT EXISTS idx_messages_chat_time ON messages (chat_id, time, id)');
        await activePool.query('CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages (sender_id, time, id)');
        await activePool.query('CREATE INDEX IF NOT EXISTS idx_messages_recipient_id ON messages (recipient_id, time, id)');
        const secretRow = await activePool.query("SELECT value FROM storage_meta WHERE key = 'session_secret'");
        const storedSecret = secretRow.rows[0];
        if (storedSecret && typeof storedSecret.value === 'string') {
            sessionSecret = storedSecret.value;
        }
        else {
            sessionSecret = createSecret(process.env.JWT_SECRET);
            await activePool.query(`INSERT INTO storage_meta (key, value) VALUES ('session_secret', $1)
         ON CONFLICT (key) DO NOTHING`, [sessionSecret]);
        }
        await migrateJsonToPostgres(activePool);
        pool = activePool;
        await loadFromPostgres(activePool);
        console.log(`Loaded ${users.length} users, ${messages.length} messages, ${moments.length} moments from ${storageSource}`);
    }
    catch (error) {
        void activePool.end().catch(() => undefined);
        pool = null;
        throw error;
    }
}
try {
    await initStorage();
}
catch (error) {
    console.error('Postgres storage unavailable', error);
    process.exit(1);
}
function insertMessage(message) {
    const activePool = pool;
    if (!activePool)
        throw new Error('Postgres storage is not available');
    return queuePostgresWrite(async () => {
        const result = await activePool.query(`INSERT INTO messages (id, chat_id, sender, sender_id, recipient_id, text, time)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`, [
            message.id,
            message.chatId,
            message.sender,
            message.sender,
            message.recipient,
            message.text,
            message.time,
        ]);
        return (result.rowCount ?? 0) > 0;
    });
}
function deletePersistedMessage(id, sender) {
    const activePool = pool;
    if (!activePool)
        throw new Error('Postgres storage is not available');
    return queuePostgresWrite(async () => {
        const result = await activePool.query('DELETE FROM messages WHERE id = $1 AND sender = $2', [id, sender]);
        return (result.rowCount ?? 0) > 0;
    });
}
function tokenUser(req) {
    const header = req.headers.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
        return verifyToken(header.slice(7), sessionSecret);
    }
    const queryToken = req.query.token;
    return verifyToken(typeof queryToken === 'string' ? queryToken : undefined, sessionSecret);
}
function tokenFor(username) {
    return issueToken(username, sessionSecret);
}
function persistUsers() {
    const activePool = pool;
    if (!activePool)
        throw new Error('Postgres storage is not available');
    return queuePostgresWrite(async () => {
        const client = await activePool.connect();
        try {
            await client.query('BEGIN');
            await client.query('DELETE FROM users');
            for (const user of users) {
                await client.query(`INSERT INTO users
            (username, salt, password_hash, public_jwk, ko_fi_url, private_key_backup, recovery_salt, recovery_hash, recovery_attempts, recovery_locked_until)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [
                    user.username,
                    user.salt,
                    user.passwordHash,
                    user.publicJwk ? JSON.stringify(user.publicJwk) : null,
                    normalizeKoFiUrl(user.koFiUrl),
                    user.privateKeyBackup ? JSON.stringify(user.privateKeyBackup) : null,
                    user.recoverySalt ?? null,
                    user.recoveryHash ?? null,
                    user.recoveryAttempts ?? 0,
                    user.recoveryLockedUntil ?? 0,
                ]);
            }
            await client.query('COMMIT');
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    });
}
function hashPassword(password, salt) {
    return scryptSync(password, salt, 64).toString('hex');
}
function verifyHash(value, salt, hash) {
    const expected = Buffer.from(hash, 'hex');
    const actual = Buffer.from(hashPassword(value, salt), 'hex');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
}
function recoveryGroup() {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from(randomBytes(4), (byte) => alphabet[byte % alphabet.length]).join('');
}
function newRecoveryCode() {
    let code = '';
    do {
        code = `honey-${recoveryGroup()}-${recoveryGroup()}`;
    } while (users.some((user) => user.recoveryHash && user.recoverySalt
        ? verifyHash(code, user.recoverySalt, user.recoveryHash)
        : false));
    return code;
}
const app = express();
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
    }
    next();
});
app.use(express.json({ limit: '80mb' }));
app.post('/api/accounts', async (req, res) => {
    const username = cleanUsername(req.body?.username);
    const password = req.body?.password;
    if (!username || typeof password !== 'string' || !password) {
        res.status(400).json({ error: accountError });
        return;
    }
    if (users.some((user) => user.username === username)) {
        res.status(409).json({ error: takenError });
        return;
    }
    const salt = randomBytes(16).toString('hex');
    const recoveryCode = newRecoveryCode();
    const recoverySalt = randomBytes(16).toString('hex');
    users.push({
        username,
        salt,
        passwordHash: hashPassword(password, salt),
        publicJwk: null,
        recoverySalt,
        recoveryHash: hashPassword(recoveryCode, recoverySalt),
        recoveryAttempts: 0,
        recoveryLockedUntil: 0,
    });
    await persistUsers();
    res.status(201).json({ username, recoveryCode, token: tokenFor(username) });
});
app.post('/api/login', (req, res) => {
    const username = cleanUsername(req.body?.username);
    const password = req.body?.password;
    const user = users.find((item) => item.username === username);
    const expected = user ? Buffer.from(user.passwordHash, 'hex') : Buffer.alloc(0);
    const actual = user && typeof password === 'string'
        ? Buffer.from(hashPassword(password, user.salt), 'hex')
        : Buffer.alloc(0);
    if (!user || expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
        res.status(401).json({ error: accountError });
        return;
    }
    res.json({ username: user.username, token: tokenFor(user.username) });
});
app.post('/api/reset', async (req, res) => {
    const body = req.body;
    const username = cleanUsername(body.username);
    const user = users.find((item) => item.username === username);
    if (!user) {
        res.status(401).json({ error: accountError });
        return;
    }
    if (typeof body.newPassword !== 'string' || !body.newPassword) {
        res.status(400).json({ error: accountError });
        return;
    }
    if (body.newPassword !== body.confirmPassword) {
        res.status(400).json({ error: mismatchError });
        return;
    }
    if (!user.recoveryHash || !user.recoverySalt) {
        res.status(403).json({ error: recoveryError });
        return;
    }
    if (user.recoveryLockedUntil && Date.now() < user.recoveryLockedUntil) {
        res.status(429).json({ error: rateLimitError });
        return;
    }
    const code = typeof body.recoveryCode === 'string'
        ? body.recoveryCode.trim().toLowerCase().replace(/\s+/g, '')
        : '';
    if (!verifyHash(code, user.recoverySalt, user.recoveryHash)) {
        const attempts = (user.recoveryAttempts ?? 0) + 1;
        user.recoveryAttempts = attempts;
        if (attempts >= 3) {
            user.recoveryLockedUntil = Date.now() + 60_000;
            user.recoveryAttempts = 0;
            res.status(429).json({ error: rateLimitError });
        }
        else {
            res.status(403).json({ error: recoveryError });
        }
        await persistUsers();
        return;
    }
    user.recoveryAttempts = 0;
    user.recoveryLockedUntil = 0;
    const salt = randomBytes(16).toString('hex');
    user.salt = salt;
    user.passwordHash = hashPassword(body.newPassword, salt);
    await persistUsers();
    res.json({
        username: user.username,
        notice: recoveryNotice,
        token: tokenFor(user.username),
    });
});
app.patch('/api/profile', async (req, res) => {
    const viewer = tokenUser(req);
    if (!viewer) {
        res.status(401).json({ error: accountError });
        return;
    }
    const user = users.find((item) => item.username === viewer);
    if (!user) {
        res.status(404).json({ error: accountError });
        return;
    }
    const body = req.body;
    if (body && Object.prototype.hasOwnProperty.call(body, 'koFiUrl')) {
        const raw = typeof body.koFiUrl === 'string' ? body.koFiUrl.trim() : '';
        const koFiUrl = raw ? normalizeKoFiUrl(raw) : null;
        if (raw && !koFiUrl) {
            res.status(400).json({ error: 'Use a Ko-fi link like https://ko-fi.com/yourname' });
            return;
        }
        user.koFiUrl = koFiUrl;
        await persistUsers();
    }
    res.json({ ok: true, koFiUrl: normalizeKoFiUrl(user.koFiUrl) });
});
app.get('/api/users/:username', (req, res) => {
    const received = String(req.params.username ?? '');
    console.log('[users lookup] received username:', JSON.stringify(received));
    console.log('[users lookup] stored usernames:', JSON.stringify(users.map((user) => user.username)));
    const username = cleanUsername(received);
    if (!username) {
        res.status(400).json({ error: accountError });
        return;
    }
    const user = users.find((item) => item.username === username);
    if (!user) {
        res.status(404).json({ error: accountError });
        return;
    }
    res.json({
        username: user.username,
        publicKey: user.publicJwk ?? null,
        publicJwk: user.publicJwk ?? null,
        koFiUrl: normalizeKoFiUrl(user.koFiUrl),
    });
});
app.get('/api/public-key', (req, res) => {
    const username = cleanUsername(req.query.username);
    const user = users.find((item) => item.username === username);
    if (!user?.publicJwk) {
        res.status(404).json({ error: accountError });
        return;
    }
    res.json({ username: user.username, publicJwk: user.publicJwk });
});
app.post('/api/public-key', async (req, res) => {
    const username = cleanUsername(req.body?.username);
    const viewer = tokenUser(req);
    if (!viewer || viewer !== username) {
        res.status(401).json({ error: accountError });
        return;
    }
    const body = req.body;
    const publicJwk = body?.publicJwk;
    const fromBackup = body?.fromBackup === true;
    const fromPassword = body?.fromPassword === true;
    const user = users.find((item) => item.username === username);
    if (!user || !publicJwk || typeof publicJwk !== 'object' || Array.isArray(publicJwk)) {
        res.status(400).json({ error: accountError });
        return;
    }
    // A client that decrypted the backup, or logged in with the account password,
    // proves it owns the account and may repair a stale key from an old device.
    if (!user.publicJwk || !user.privateKeyBackup || fromBackup || fromPassword) {
        user.publicJwk = publicJwk;
        await persistUsers();
        console.info(`Public key stored${fromBackup ? ' from backup' : fromPassword ? ' from password login' : ''}`, username);
    }
    res.json({ ok: true, publicJwk: user.publicJwk });
});
app.get('/api/key-backup', (req, res) => {
    const viewer = tokenUser(req);
    if (!viewer) {
        res.status(401).json({ error: accountError });
        return;
    }
    const user = users.find((item) => item.username === viewer);
    res.json({ backup: user?.privateKeyBackup ?? null });
});
app.post('/api/key-backup', async (req, res) => {
    const viewer = tokenUser(req);
    if (!viewer) {
        res.status(401).json({ error: accountError });
        return;
    }
    const backup = req.body?.backup;
    if (!backup || typeof backup !== 'object' || Array.isArray(backup)) {
        res.status(400).json({ error: accountError });
        return;
    }
    const value = backup;
    if (typeof value.salt !== 'string' ||
        typeof value.iv !== 'string' ||
        typeof value.ciphertext !== 'string') {
        res.status(400).json({ error: accountError });
        return;
    }
    const user = users.find((item) => item.username === viewer);
    if (!user) {
        res.status(404).json({ error: accountError });
        return;
    }
    // Re-wrap the same private key after a password reset. The token proves the
    // caller just supplied the account password, and the key itself never changes.
    user.privateKeyBackup = value;
    await persistUsers();
    console.info('Private key backup stored', viewer);
    res.json({ ok: true });
});
app.get('/api/vapid-public-key', (_req, res) => {
    if (!vapidConfigured) {
        res.status(503).json({ error: 'Push notifications are not configured.' });
        return;
    }
    res.json({ publicKey: vapidPublicKey });
});
app.post('/api/push-subscription', async (req, res) => {
    const viewer = tokenUser(req);
    if (!viewer) {
        res.status(401).json({ error: errorCopy });
        return;
    }
    const body = req.body;
    const subscription = body?.subscription;
    if (!subscription || typeof subscription !== 'object' || Array.isArray(subscription)) {
        res.status(400).json({ error: errorCopy });
        return;
    }
    const endpoint = subscription.endpoint;
    if (typeof endpoint !== 'string' || !endpoint || !pool) {
        res.status(503).json({ error: errorCopy });
        return;
    }
    try {
        await pool.query(`INSERT INTO push_subscriptions
         (id, username, device_id, subscription, call_notifications, message_notifications)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         username = EXCLUDED.username,
         device_id = EXCLUDED.device_id,
         subscription = EXCLUDED.subscription,
         call_notifications = EXCLUDED.call_notifications,
         message_notifications = EXCLUDED.message_notifications`, [
            endpoint,
            viewer,
            typeof body.deviceId === 'string' ? body.deviceId : '',
            JSON.stringify(subscription),
            body.callNotifications === true,
            body.messageNotifications === true,
        ]);
        res.json({ ok: true });
    }
    catch (error) {
        console.error('[push] subscription save failed', error instanceof Error ? error.message : 'unknown');
        res.status(503).json({ error: errorCopy });
    }
});
app.delete('/api/push-subscription', async (req, res) => {
    const viewer = tokenUser(req);
    if (!viewer || !pool) {
        res.status(401).json({ error: errorCopy });
        return;
    }
    const endpoint = req.body?.endpoint;
    if (typeof endpoint !== 'string' || !endpoint) {
        res.status(400).json({ error: errorCopy });
        return;
    }
    try {
        await pool.query('DELETE FROM push_subscriptions WHERE id = $1 AND username = $2', [
            endpoint,
            viewer,
        ]);
        res.json({ ok: true });
    }
    catch (error) {
        console.error('[push] subscription delete failed', error instanceof Error ? error.message : 'unknown');
        res.status(503).json({ error: errorCopy });
    }
});
app.post('/api/fcm-token', async (req, res) => {
    const viewer = tokenUser(req);
    if (!viewer || !pool) {
        res.status(401).json({ error: errorCopy });
        return;
    }
    const body = req.body;
    const token = typeof body?.token === 'string' ? body.token.trim() : '';
    if (!token || token.length > 4096) {
        res.status(400).json({ error: errorCopy });
        return;
    }
    try {
        await pool.query(`INSERT INTO fcm_tokens (token, username, device_id, call_notifications)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (token) DO UPDATE SET
         username = EXCLUDED.username,
         device_id = EXCLUDED.device_id,
         call_notifications = EXCLUDED.call_notifications`, [token, viewer, typeof body.deviceId === 'string' ? body.deviceId : '', body.callNotifications !== false]);
        res.json({ ok: true });
    }
    catch (error) {
        console.error('[fcm] token save failed', error instanceof Error ? error.message : 'unknown');
        res.status(503).json({ error: errorCopy });
    }
});
app.delete('/api/fcm-token', async (req, res) => {
    const viewer = tokenUser(req);
    if (!viewer || !pool) {
        res.status(401).json({ error: errorCopy });
        return;
    }
    const token = req.body?.token;
    if (typeof token !== 'string' || !token) {
        res.status(400).json({ error: errorCopy });
        return;
    }
    try {
        await pool.query('DELETE FROM fcm_tokens WHERE token = $1 AND username = $2', [token, viewer]);
        res.json({ ok: true });
    }
    catch (error) {
        console.error('[fcm] token delete failed', error instanceof Error ? error.message : 'unknown');
        res.status(503).json({ error: errorCopy });
    }
});
app.get(['/download', '/download/'], (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.type('html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Download HonDen for Android</title>
    <style>
      body { margin: 0; background: #fff7f2; color: #3b2733; font-family: system-ui, -apple-system, sans-serif; }
      main { max-width: 960px; margin: 0 auto; padding: 56px 28px 72px; }
      h1 { margin: 0 0 18px; color: #b23a68; font-size: 44px; line-height: 1.1; }
      p { font-size: 22px; line-height: 1.6; }
      .download {
        display: flex; min-height: 88px; align-items: center; justify-content: center;
        margin: 32px 0; padding: 16px 28px; border-radius: 18px; background: #ff6b9d;
        color: #fff; font-size: 28px; font-weight: 800; text-align: center;
        text-decoration: none; box-shadow: 0 10px 28px rgba(178, 58, 104, 0.24);
        outline-offset: 5px;
      }
      .download:focus-visible { outline: 6px solid #7a1f45; }
      .note { border-radius: 16px; background: #fff; padding: 24px; font-size: 20px; }
      .meta { color: #7a5266; font-size: 18px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Download HonDen for Android</h1>
      <p class="meta">One universal ARM64 APK for Galaxy S21 and Meta Quest 2. Android 10 / API 29+.</p>
      <a class="download" href="/downloads/honden.apk" download="honden.apk">Download HonDen for Android</a>
      <p class="note">On Quest 2, open this page in Quest Browser, tap Download, tap the downloaded file, Allow unknown sources, tap Install, then open HonDen from Unknown Sources in your library. On Galaxy S21, open this page in Chrome, tap Download, tap the downloaded file, Allow install unknown apps, tap Install.</p>
    </main>
  </body>
</html>`);
});
app.get('/downloads/honden.apk', async (_req, res) => {
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', 'attachment; filename="honden.apk"');
    res.setHeader('Cache-Control', 'no-store');
    try {
        // Always stream the current signed release asset; never fall back to a
        // stale local file that could be an old unsigned APK.
        const upstream = await fetch(apkReleaseUrl, { redirect: 'follow' });
        if (!upstream.ok || !upstream.body) {
            throw new Error(`APK download returned ${upstream.status}`);
        }
        const length = upstream.headers.get('content-length');
        if (length)
            res.setHeader('Content-Length', length);
        const stream = Readable.fromWeb(upstream.body);
        stream.on('error', () => res.destroy());
        stream.pipe(res);
    }
    catch (error) {
        console.warn('[apk] download unavailable', error instanceof Error ? error.message : 'unknown');
        res.status(404).json({ error: 'The Android APK is being prepared. Check back in a moment.' });
    }
});
app.get('/health', (_req, res) => {
    res.json({ ok: true, storage: storageSource, version: '0.1.0' });
});
app.get('/api/app-version', (_req, res) => {
    res.json({
        version: '0.1.0',
        apkUrl: 'https://honden.onrender.com/downloads/honden.apk',
    });
});
app.get('/api/chats', (req, res) => {
    const viewer = tokenUser(req);
    if (!viewer) {
        res.status(401).json({ error: errorCopy });
        return;
    }
    const peers = new Map();
    for (const message of messages) {
        if (!canAccessConversation(message.sender, message.recipient, viewer))
            continue;
        const peer = message.sender === viewer ? message.recipient : message.sender;
        if (!peer || peer === viewer || peer === globalThreadId)
            continue;
        const time = Date.parse(message.time);
        peers.set(peer, Math.max(peers.get(peer) ?? 0, Number.isFinite(time) ? time : 0));
    }
    res.json([...peers].map(([username, createdAt]) => ({ username, createdAt })));
});
app.get('/api/messages', (req, res) => {
    const viewer = tokenUser(req);
    if (!viewer) {
        res.status(401).json({ error: errorCopy });
        return;
    }
    const requestedChatId = req.query.chatId;
    if (typeof requestedChatId !== 'string' ||
        (requestedChatId !== '*' && !isValidChatId(requestedChatId, globalThreadId))) {
        res.status(400).json({ error: errorCopy });
        return;
    }
    const chatId = requestedChatId;
    const afterTime = typeof req.query.afterTime === 'string' ? req.query.afterTime : undefined;
    const afterId = typeof req.query.afterId === 'string' ? req.query.afterId : undefined;
    const cursor = afterTime && afterId ? { time: afterTime, id: afterId } : null;
    const requestedLimit = Number(req.query.limit);
    const limit = Number.isFinite(requestedLimit)
        ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 200)
        : 200;
    let visible = messages.filter((message) => {
        if (message.chatId === globalThreadId)
            return chatId === '*' || chatId === globalThreadId;
        return (canAccessConversation(message.sender, message.recipient, viewer) &&
            (chatId === '*' || message.chatId === chatId));
    });
    if (cursor)
        visible = visible.filter((item) => isAfterCursor(item.time, item.id, cursor));
    visible.sort((a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id));
    res.json(visible.slice(0, limit));
});
app.post('/api/messages', async (req, res) => {
    const viewer = tokenUser(req);
    if (!viewer) {
        res.status(401).json({ error: errorCopy });
        return;
    }
    const body = req.body;
    if (!body || !isValidChatId(body.chatId, globalThreadId) || !isValidMessageText(body.text)) {
        res.status(400).json({ error: errorCopy });
        return;
    }
    if (body.chatId !== globalThreadId &&
        body.chatId !== viewer &&
        !users.some((user) => user.username === body.chatId)) {
        res.status(403).json({ error: errorCopy });
        return;
    }
    if (body.chatId === globalThreadId) {
        if (blockedGlobalText(body.text)) {
            res.status(400).json({ error: globalError });
            return;
        }
        const lastPostedAt = globalRateLimit.get(viewer) ?? 0;
        if (Date.now() - lastPostedAt < 1000) {
            res.status(429).json({ error: rateLimitError });
            return;
        }
        globalRateLimit.set(viewer, Date.now());
    }
    const id = body.id && isValidMessageId(body.id) ? body.id : randomUUID();
    const message = {
        id,
        chatId: body.chatId,
        sender: viewer,
        recipient: body.chatId === globalThreadId ? null : body.chatId,
        text: body.text.trim(),
        time: new Date().toISOString(),
    };
    try {
        const inserted = await insertMessage(message);
        if (!inserted) {
            const existing = messages.find((item) => item.id === id);
            console.info('[message] duplicate acknowledged', { id });
            res.status(200).json(existing ?? message);
            return;
        }
        messages.push(message);
        broadcastMessage(message);
        console.info('[message] persisted', { id, chatId: message.chatId });
        res.status(201).json(message);
    }
    catch (error) {
        console.error('[message] persistence failed', error instanceof Error ? error.message : 'unknown');
        res.status(503).json({ error: errorCopy });
    }
});
app.delete('/api/messages/:id', async (req, res) => {
    const viewer = tokenUser(req);
    if (!viewer) {
        res.status(401).json({ error: errorCopy });
        return;
    }
    const existing = messages.find((message) => message.id === req.params.id);
    if (!existing) {
        res.status(404).json({ error: errorCopy });
        return;
    }
    if (existing.sender !== viewer) {
        res.status(403).json({ error: errorCopy });
        return;
    }
    try {
        const deleted = await deletePersistedMessage(existing.id, viewer);
        if (!deleted) {
            res.status(404).json({ error: errorCopy });
            return;
        }
        messages = messages.filter((message) => message.id !== existing.id);
        broadcastDelete(existing);
        console.info('[message] deleted', { id: existing.id });
        res.status(204).end();
    }
    catch (error) {
        console.error('[message] delete failed', error instanceof Error ? error.message : 'unknown');
        res.status(503).json({ error: errorCopy });
    }
});
function isValidMomentPayload(value) {
    if (!value || typeof value !== 'object')
        return false;
    const body = value;
    return isValidChatId(body.chatId, globalThreadId) && isValidMomentText(body.text);
}
function insertMoment(moment) {
    const activePool = pool;
    if (!activePool)
        throw new Error('Postgres storage is not available');
    return queuePostgresWrite(async () => {
        const result = await activePool.query(`INSERT INTO moments (id, chat_id, sender, text, time)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`, [moment.id, moment.chatId, moment.sender, moment.text, moment.time]);
        return (result.rowCount ?? 0) > 0;
    });
}
function deletePersistedMoment(id, sender) {
    const activePool = pool;
    if (!activePool)
        throw new Error('Postgres storage is not available');
    return queuePostgresWrite(async () => {
        const result = await activePool.query('DELETE FROM moments WHERE id = $1 AND sender = $2', [id, sender]);
        return (result.rowCount ?? 0) > 0;
    });
}
app.get('/api/moments', (req, res) => {
    const viewer = tokenUser(req);
    if (!viewer) {
        res.status(401).json({ error: errorCopy });
        return;
    }
    const requestedChatId = req.query.chatId;
    if (typeof requestedChatId !== 'string' || !isValidChatId(requestedChatId, globalThreadId)) {
        res.status(400).json({ error: errorCopy });
        return;
    }
    const visible = moments
        .filter((moment) => moment.chatId === requestedChatId)
        .filter((moment) => {
        if (moment.chatId === globalThreadId)
            return true;
        return canAccessConversation(moment.sender, moment.chatId, viewer);
    })
        .sort((a, b) => b.time.localeCompare(a.time) || b.id.localeCompare(a.id));
    res.json(visible.slice(0, 100));
});
app.post('/api/moments', async (req, res) => {
    const viewer = tokenUser(req);
    if (!viewer) {
        res.status(401).json({ error: errorCopy });
        return;
    }
    const body = req.body;
    if (!isValidMomentPayload(body)) {
        res.status(400).json({ error: errorCopy });
        return;
    }
    if (body.chatId !== globalThreadId && body.chatId !== viewer && !users.some((u) => u.username === body.chatId)) {
        res.status(403).json({ error: errorCopy });
        return;
    }
    const id = typeof body.id === 'string' && isValidMessageId(body.id) ? body.id : randomUUID();
    const moment = {
        id,
        chatId: body.chatId,
        sender: viewer,
        text: body.text.trim(),
        time: new Date().toISOString(),
    };
    try {
        const inserted = await insertMoment(moment);
        if (!inserted) {
            const existing = moments.find((item) => item.id === id);
            res.status(200).json(existing ?? moment);
            return;
        }
        moments.push(moment);
        broadcastMoment(moment);
        res.status(201).json(moment);
    }
    catch (error) {
        console.error('[moment] persistence failed', error instanceof Error ? error.message : 'unknown');
        res.status(503).json({ error: errorCopy });
    }
});
app.delete('/api/moments/:id', async (req, res) => {
    const viewer = tokenUser(req);
    if (!viewer) {
        res.status(401).json({ error: errorCopy });
        return;
    }
    const existing = moments.find((moment) => moment.id === req.params.id);
    if (!existing) {
        res.status(404).json({ error: errorCopy });
        return;
    }
    if (existing.sender !== viewer) {
        res.status(403).json({ error: errorCopy });
        return;
    }
    try {
        const deleted = await deletePersistedMoment(existing.id, viewer);
        if (!deleted) {
            res.status(404).json({ error: errorCopy });
            return;
        }
        moments = moments.filter((moment) => moment.id !== existing.id);
        broadcastMomentDelete(existing);
        res.status(204).end();
    }
    catch (error) {
        console.error('[moment] delete failed', error instanceof Error ? error.message : 'unknown');
        res.status(503).json({ error: errorCopy });
    }
});
const server = createServer(app);
const allowedOrigins = [
    ...new Set([
        'http://localhost:5173',
        'http://localhost:3000',
        'https://honden.onrender.com',
        'tauri://localhost',
        'http://tauri.localhost',
        ...(process.env.CLIENT_ORIGIN ?? '')
            .split(',')
            .map((origin) => origin.trim())
            .filter(Boolean),
    ]),
];
const clients = new Set();
const wss = new WebSocketServer({
    server,
    maxPayload: 64 * 1024,
    verifyClient: (info) => isOriginAllowed(info.origin, allowedOrigins),
});
function sendIfOpen(socket, payload) {
    if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify(payload));
}
function canReceive(client, message) {
    if (message.chatId === globalThreadId)
        return true;
    return canAccessConversation(message.sender, message.recipient, client.user);
}
function canReceiveMoment(client, moment) {
    if (moment.chatId === globalThreadId)
        return true;
    return client.user === moment.sender || client.user === moment.chatId;
}
function broadcastMessage(message) {
    const payload = { type: 'message', message };
    for (const client of clients) {
        if (canReceive(client, message))
            sendIfOpen(client.socket, payload);
    }
    void sendMessagePush(message).catch(() => undefined);
}
function broadcastDelete(message) {
    const payload = { type: 'delete', id: message.id };
    for (const client of clients) {
        if (canReceive(client, message))
            sendIfOpen(client.socket, payload);
    }
}
function broadcastMoment(moment) {
    const payload = { type: 'moment', moment };
    for (const client of clients) {
        if (canReceiveMoment(client, moment))
            sendIfOpen(client.socket, payload);
    }
}
function broadcastMomentDelete(moment) {
    const payload = { type: 'moment-delete', id: moment.id };
    for (const client of clients) {
        if (canReceiveMoment(client, moment))
            sendIfOpen(client.socket, payload);
    }
}
function sendMessagePush(message) {
    const payload = {
        type: 'message',
        chatId: message.chatId,
        sender: message.sender,
        senderName: message.sender,
    };
    if (message.chatId === globalThreadId)
        return sendPushToSubscribers(payload, message.sender);
    return message.recipient
        ? sendPushToRecipient(message.recipient, payload, 'message')
        : Promise.resolve();
}
async function sendPushToSubscribers(payload, exclude) {
    if (!pool)
        return;
    const result = await pool.query(`SELECT DISTINCT username
     FROM push_subscriptions
     WHERE message_notifications = TRUE AND username <> $1`, [normalizeCallUsername(exclude)]);
    await Promise.all(result.rows.map((row) => sendPushToRecipient(String(row.username), payload, 'message')));
}
async function sendPushToRecipient(recipient, payload, kind) {
    if (!pool || !vapidConfigured || !vapidPublicKey)
        return;
    const to = normalizeCallUsername(recipient);
    const sender = normalizeCallUsername(payload.sender);
    if (!to || !sender || to === sender)
        return;
    const flagColumn = kind === 'call' ? 'call_notifications' : 'message_notifications';
    const result = await pool.query(`SELECT id, device_id, subscription
     FROM push_subscriptions
     WHERE username = $1 AND ${flagColumn} = TRUE`, [to]);
    const outgoing = {
        ...payload,
        sender,
        senderName: payload.senderName || sender,
    };
    const body = JSON.stringify(outgoing);
    await Promise.all(result.rows.map(async (row) => {
        const subscription = row.subscription;
        if (!subscription || typeof subscription !== 'object')
            return;
        try {
            await webPush.sendNotification(subscription, body);
        }
        catch (error) {
            const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
                ? Number(error.statusCode)
                : 0;
            if (statusCode === 410 || statusCode === 404) {
                await pool?.query('DELETE FROM push_subscriptions WHERE id = $1', [row.id]);
            }
        }
    }));
}
function sendIncomingCallPush(recipient, caller, callId, kind) {
    return sendPushToRecipient(recipient, {
        type: 'incoming-call',
        callId,
        sender: caller,
        senderName: caller,
        kind,
    }, 'call');
}
async function sendFcmCallPush(recipient, caller, callId, kind, type) {
    if (!pool || !fcmConfigured())
        return;
    const to = normalizeCallUsername(recipient);
    const sender = normalizeCallUsername(caller);
    if (!to || !sender || !callId)
        return;
    // Self-cancel is valid when the callee declines natively and the caller is
    // also the FCM recipient; self-invites are never valid.
    if (to === sender && type !== 'call:cancel')
        return;
    const result = await pool.query(`SELECT token FROM fcm_tokens WHERE username = $1 AND call_notifications = TRUE`, [to]);
    await Promise.all(result.rows.map((row) => typeof row.token === 'string'
        ? sendFcmCallMessage(row.token, { type, callId, sender, kind })
        : Promise.resolve(false)));
}
wss.on('connection', (socket, request) => {
    let token;
    let deviceId = '';
    try {
        const url = new URL(request.url ?? '/', 'http://localhost').searchParams;
        token = url.get('token') ?? undefined;
        deviceId = url.get('deviceId') ?? '';
    }
    catch {
        token = undefined;
        deviceId = '';
    }
    const user = verifyToken(token, sessionSecret);
    if (!user) {
        socket.close(1008, 'Unauthorized');
        return;
    }
    const client = { socket, user, deviceId, lastPong: Date.now() };
    clients.add(client);
    sendIfOpen(socket, { type: 'ready', userId: user });
    console.info('[ws] authenticated', { user });
    socket.on('pong', () => {
        client.lastPong = Date.now();
    });
    socket.on('message', (raw) => {
        let frame;
        try {
            frame = JSON.parse(raw.toString());
        }
        catch {
            return;
        }
        if (frame.type === 'ping') {
            sendIfOpen(socket, { type: 'pong' });
            return;
        }
        if (frame.type === 'typing') {
            // Only IDs and the flag cross the wire — never message content.
            if (!isValidChatId(frame.chatId, globalThreadId) || typeof frame.isTyping !== 'boolean') {
                return;
            }
            const chatId = frame.chatId;
            if (chatId !== globalThreadId &&
                chatId !== user &&
                !users.some((entry) => entry.username === chatId)) {
                return;
            }
            const payload = { type: 'typing', chatId, userId: user, isTyping: frame.isTyping };
            for (const peer of clients) {
                if (peer.user === user || peer.socket.readyState !== WebSocket.OPEN)
                    continue;
                if (chatId === globalThreadId || peer.user === chatId)
                    sendIfOpen(peer.socket, payload);
            }
            return;
        }
        if (typeof frame.type === 'string' &&
            frame.type.startsWith('call:') &&
            typeof frame.to === 'string' &&
            typeof frame.callId === 'string') {
            const to = frame.to.trim().replace(/^@/, '').toLowerCase();
            if (!to)
                return;
            const payload = JSON.stringify({
                ...frame,
                to,
                from: user,
                peerName: typeof frame.peerName === 'string' ? frame.peerName : user,
            });
            for (const peer of clients) {
                if (peer.user.trim().toLowerCase() === to &&
                    peer.socket.readyState === WebSocket.OPEN) {
                    peer.socket.send(payload);
                }
            }
            const callKind = frame.kind === 'video' ? 'video' : 'voice';
            if (frame.type === 'call:invite') {
                void sendIncomingCallPush(to, user, frame.callId, callKind).catch(() => undefined);
                void sendFcmCallPush(to, user, frame.callId, callKind, 'incoming-call').catch(() => undefined);
            }
            if (frame.type === 'call:hangup' ||
                frame.type === 'call:reject' ||
                frame.type === 'call:accept') {
                void sendFcmCallPush(to, user, frame.callId, callKind, 'call:cancel').catch(() => undefined);
            }
        }
    });
    const remove = () => clients.delete(client);
    socket.on('close', remove);
    socket.on('error', remove);
});
const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const client of clients) {
        if (now - client.lastPong > 90_000) {
            client.socket.terminate();
            continue;
        }
        if (client.socket.readyState === WebSocket.OPEN)
            client.socket.ping();
    }
}, 30_000);
heartbeat.unref();
app.post('/api/call-decline', (req, res) => {
    const body = req.body;
    const callId = typeof body?.callId === 'string' ? body.callId : '';
    const caller = typeof body?.to === 'string' ? normalizeCallUsername(body.to) : '';
    if (!callId || !caller) {
        res.status(400).json({ ok: false });
        return;
    }
    for (const client of clients) {
        if (normalizeCallUsername(client.user) === caller && client.socket.readyState === WebSocket.OPEN) {
            sendIfOpen(client.socket, { type: 'call:reject', to: caller, from: caller, callId });
        }
    }
    // The native decline path may run while the caller's app is killed, so also
    // send the minimal cancel push. No message contents or audio are included.
    void sendFcmCallPush(caller, caller, callId, 'voice', 'call:cancel').catch(() => undefined);
    res.json({ ok: true });
});
// Vite env vars are baked in at build time. Serve the TURN settings at runtime
// from the service environment so dashboard changes do not require a rebuild.
app.get('/api/turn-config', (req, res) => {
    if (!tokenUser(req)) {
        res.status(401).json({ ok: false });
        return;
    }
    res.set('Cache-Control', 'no-store');
    res.json({
        urls: process.env.VITE_TURN_URLS ?? process.env.VITE_TURN_URL ?? '',
        username: process.env.VITE_TURN_USERNAME ?? '',
        credential: process.env.VITE_TURN_CREDENTIAL ?? '',
    });
});
const distDir = join(here, '..', 'dist');
app.use(express.static(distDir));
app.use((req, res, next) => {
    if (req.path === '/api' || req.path.startsWith('/api/')) {
        next();
        return;
    }
    res.sendFile(join(distDir, 'index.html'));
});
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
server.listen(port, host, () => {
    console.log(`HonDen server listening on http://${host}:${port}`);
});
