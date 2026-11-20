import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

export const MAX_MESSAGE_BYTES = 16 * 1024

export type Cursor = { time: string; id: string }

export function createSecret(provided?: string): string {
  if (provided && provided.length >= 32) return provided
  return randomBytes(32).toString('hex')
}

export function issueToken(username: string, secret: string, now = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ sub: username, exp: now + TOKEN_TTL_MS }),
  ).toString('base64url')
  const signature = createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

export function verifyToken(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): string | null {
  if (!token || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [payload, signature] = parts
  const expected = createHmac('sha256', secret).update(payload).digest('base64url')
  const receivedBytes = Buffer.from(signature)
  const expectedBytes = Buffer.from(expected)
  if (
    receivedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(receivedBytes, expectedBytes)
  ) {
    return null
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      sub?: unknown
      exp?: unknown
    }
    if (typeof parsed.sub !== 'string' || typeof parsed.exp !== 'number') return null
    if (parsed.exp <= now) return null
    return parsed.sub
  } catch {
    return null
  }
}

export function isOriginAllowed(origin: string | undefined, allowed: string[]): boolean {
  if (!origin) return true
  return allowed.includes(origin)
}

export function canAccessConversation(
  sender: string,
  recipient: string | null,
  viewer: string,
): boolean {
  return viewer === sender || viewer === recipient
}

export function isAfterCursor(time: string, id: string, cursor: Cursor | null): boolean {
  if (!cursor) return true
  if (time > cursor.time) return true
  if (time < cursor.time) return false
  return id > cursor.id
}

export function isValidMessageId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(id)
}

export function isValidChatId(id: unknown, globalThreadId: string): id is string {
  return typeof id === 'string' && (id === globalThreadId || /^[a-z0-9_]{2,24}$/.test(id))
}

export function isValidMessageText(text: unknown): text is string {
  return (
    typeof text === 'string' &&
    text.trim().length > 0 &&
    Buffer.byteLength(text, 'utf8') <= MAX_MESSAGE_BYTES
  )
}
