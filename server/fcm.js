import { SignJWT, importPKCS8 } from 'jose';
let cachedToken = null;
let warnedAboutConfig = false;
function readServiceAccount() {
    const raw = process.env.FCM_SERVICE_ACCOUNT_JSON;
    if (!raw)
        return null;
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed.project_id !== 'string' ||
            !parsed.project_id ||
            typeof parsed.client_email !== 'string' ||
            !parsed.client_email ||
            typeof parsed.private_key !== 'string' ||
            !parsed.private_key) {
            throw new Error('service account fields missing');
        }
        return {
            projectId: parsed.project_id,
            clientEmail: parsed.client_email,
            privateKey: parsed.private_key,
        };
    }
    catch {
        if (!warnedAboutConfig) {
            console.warn('[fcm] service account is invalid; call push is disabled');
            warnedAboutConfig = true;
        }
        return null;
    }
}
export function fcmConfigured() {
    return readServiceAccount() !== null;
}
async function fetchAccessToken(account) {
    const now = Math.floor(Date.now() / 1000);
    if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000)
        return cachedToken.value;
    const key = await importPKCS8(account.privateKey, 'RS256');
    const assertion = await new SignJWT({
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
    })
        .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
        .setIssuer(account.clientEmail)
        .setAudience('https://oauth2.googleapis.com/token')
        .setIssuedAt(now)
        .setExpirationTime(now + 3600)
        .sign(key);
    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion,
        }),
    });
    if (!response.ok)
        throw new Error(`FCM OAuth status ${response.status}`);
    const data = (await response.json());
    if (typeof data.access_token !== 'string' || !data.access_token) {
        throw new Error('FCM OAuth response missing access_token');
    }
    const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;
    cachedToken = { value: data.access_token, expiresAt: Date.now() + expiresIn * 1000 };
    return cachedToken.value;
}
export function buildFcmCallRequest(token, message) {
    return {
        message: {
            token,
            data: {
                type: message.type,
                callId: message.callId,
                sender: message.sender,
                kind: message.kind,
            },
            android: {
                priority: 'high',
                ttl: '30s',
            },
        },
    };
}
export async function sendFcmCallMessage(token, message) {
    const account = readServiceAccount();
    if (!account)
        return false;
    try {
        const accessToken = await fetchAccessToken(account);
        const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.projectId)}/messages:send`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(buildFcmCallRequest(token, message)),
        });
        if (!response.ok) {
            console.warn('[fcm] send failed', response.status);
            return false;
        }
        return true;
    }
    catch (error) {
        console.warn('[fcm] send error', error instanceof Error ? error.message : 'unknown');
        return false;
    }
}
