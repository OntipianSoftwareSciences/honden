import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_MESSAGE_BYTES = 16 * 1024;
// A 50 MB encrypted audio moment is ~93 MB after data URL + AES-GCM base64.
export const MAX_MOMENT_BYTES = 110 * 1024 * 1024;
export function createSecret(provided) {
    if (provided && provided.length >= 32)
        return provided;
    return randomBytes(32).toString('hex');
}
export function issueToken(username, secret, now = Date.now()) {
    const payload = Buffer.from(JSON.stringify({ sub: username, exp: now + TOKEN_TTL_MS })).toString('base64url');
    const signature = createHmac('sha256', secret).update(payload).digest('base64url');
    return `${payload}.${signature}`;
}
export function verifyToken(token, secret, now = Date.now()) {
    if (!token || typeof token !== 'string')
        return null;
    const parts = token.split('.');
    if (parts.length !== 2)
        return null;
    const [payload, signature] = parts;
    const expected = createHmac('sha256', secret).update(payload).digest('base64url');
    const receivedBytes = Buffer.from(signature);
    const expectedBytes = Buffer.from(expected);
    if (receivedBytes.length !== expectedBytes.length ||
        !timingSafeEqual(receivedBytes, expectedBytes)) {
        return null;
    }
    try {
        const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (typeof parsed.sub !== 'string' || typeof parsed.exp !== 'number')
            return null;
        if (parsed.exp <= now)
            return null;
        return parsed.sub;
    }
    catch {
        return null;
    }
}
export function isOriginAllowed(origin, allowed) {
    if (!origin)
        return true;
    return allowed.includes(origin);
}
export function canAccessConversation(sender, recipient, viewer) {
    return viewer === sender || viewer === recipient;
}
export function isAfterCursor(time, id, cursor) {
    if (!cursor)
        return true;
    if (time > cursor.time)
        return true;
    if (time < cursor.time)
        return false;
    return id > cursor.id;
}
export function isValidMessageId(id) {
    return typeof id === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(id);
}
export function isValidChatId(id, globalThreadId) {
    return typeof id === 'string' && (id === globalThreadId || /^[a-z0-9_]{2,24}$/.test(id));
}
export function isValidMessageText(text) {
    return (typeof text === 'string' &&
        text.trim().length > 0 &&
        Buffer.byteLength(text, 'utf8') <= MAX_MESSAGE_BYTES);
}
export function isValidMomentText(text) {
    return (typeof text === 'string' &&
        text.trim().length > 0 &&
        Buffer.byteLength(text, 'utf8') <= MAX_MOMENT_BYTES);
}
