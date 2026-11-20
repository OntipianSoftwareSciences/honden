import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import express, { type Request } from 'express'
import { Pool } from 'pg'
import { WebSocket, WebSocketServer } from 'ws'
import {
  canAccessConversation,
  createSecret,
  isAfterCursor,
  isOriginAllowed,
  isValidChatId,
  isValidMessageId,
  isValidMessageText,
  issueToken,
  verifyToken,
  type Cursor,
} from './protocol'

type StoredMessage = {
  id: string
  chatId: string
  sender: string
  text: string
  time: string
}

type StoredUser = {
  username: string
  salt: string
  passwordHash: string
  publicJwk: Record<string, unknown> | null
  recoverySalt?: string
  recoveryHash?: string
  recoveryAttempts?: number
  recoveryLockedUntil?: number
}

const here = dirname(fileURLToPath(import.meta.url))
const legacyDataDir = join(here, 'data')
const downloadsDir = join(here, 'downloads')
const apkFile = join(downloadsDir, 'honden.apk')
mkdirSync(downloadsDir, { recursive: true })
const errorCopy = 'Something went wrong on our side. Nothing was sent. Try again in a moment.'
const accountError = "We couldn't find that account. Check the spelling and try again."
const takenError = 'That @username is already taken. Try another one.'
const mismatchError = "Those passwords don't match. Try again."
const recoveryError = "That recovery code doesn't match. Check it and try again."
const rateLimitError = 'Too many tries. Wait a minute and try again.'
const recoveryNotice = 'Your recovery code is still the same. Keep it safe.'
const globalThreadId = '#honey-den'
const globalError = 'Please keep #honey-den kind and link-free.'
const globalRateLimit = new Map<string, number>()

function blockedGlobalText(text: string): boolean {
  return (
    /(https?:\/\/|www\.|t\.me\/|discord\.gg\/|bit\.ly\/|tinyurl\.com\/)/i.test(text) ||
    /\b(f[\*u]ck|sh[i\*]t|b[i\*]tch|n[i\*]gg\w*|f[a\*]g\w*|retard\w*)\b/i.test(text)
  )
}

function isMessage(value: unknown): value is StoredMessage {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<StoredMessage>
  return (
    typeof item.id === 'string' &&
    typeof item.chatId === 'string' &&
    typeof item.sender === 'string' &&
    typeof item.text === 'string' &&
    typeof item.time === 'string'
  )
}

function isStoredUser(value: unknown): value is StoredUser {
  if (!value || typeof value !== 'object') return false
  const user = value as Partial<StoredUser>
  return (
    typeof user.username === 'string' &&
    typeof user.salt === 'string' &&
    typeof user.passwordHash === 'string'
  )
}

function cleanUsername(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim().replace(/^@/, '').trim().toLowerCase()
  return /^[a-z0-9_]{2,24}$/.test(name) ? name : null
}

function readJsonArray<T>(file: string, guard: (value: unknown) => value is T): T[] {
  if (!existsSync(file)) return []
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(parsed) ? parsed.filter(guard) : []
  } catch {
    return []
  }
}

function jsonPaths(name: string): string[] {
  return [join(legacyDataDir, name)]
}

function readMessagesFromJson(): StoredMessage[] {
  const seen = new Set<string>()
  const found: StoredMessage[] = []
  for (const file of jsonPaths('messages.json')) {
    for (const message of readJsonArray(file, isMessage)) {
      if (seen.has(message.id)) continue
      seen.add(message.id)
      found.push(message)
    }
  }
  return found
}

function readUsersFromJson(): StoredUser[] {
  const seen = new Set<string>()
  const found: StoredUser[] = []
  for (const file of jsonPaths('users.json')) {
    for (const user of readJsonArray(file, isStoredUser)) {
      const username = cleanUsername(user.username) ?? user.username
      if (seen.has(username)) continue
      seen.add(username)
      found.push({ ...user, username })
    }
  }
  return found
}

function parseJwk(value: unknown): Record<string, unknown> | null {
  if (!value) return null
  if (typeof value === 'object') return value as Record<string, unknown>
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, unknown>
    } catch {
      return null
    }
  }
  return null
}

let messages: StoredMessage[] = []
let users: StoredUser[] = []
let pool: Pool | null = null
let sessionSecret = ''
const storageSource = 'Postgres'
let writeQueue: Promise<unknown> = Promise.resolve()

async function migrateJsonToPostgres(activePool: Pool): Promise<void> {
  const marker = await activePool.query("SELECT value FROM storage_meta WHERE key = 'json_migrated'")
  if ((marker.rowCount ?? 0) > 0) return

  const jsonUsers = readUsersFromJson()
  const jsonMessages = readMessagesFromJson()
  const client = await activePool.connect()
  try {
    await client.query('BEGIN')
    for (const user of jsonUsers) {
      await client.query(
        `INSERT INTO users
          (username, salt, password_hash, public_jwk, recovery_salt, recovery_hash, recovery_attempts, recovery_locked_until)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (username) DO NOTHING`,
        [
          user.username,
          user.salt,
          user.passwordHash,
          user.publicJwk ? JSON.stringify(user.publicJwk) : null,
          user.recoverySalt ?? null,
          user.recoveryHash ?? null,
          user.recoveryAttempts ?? 0,
          user.recoveryLockedUntil ?? 0,
        ],
      )
    }
    for (const message of jsonMessages) {
      await client.query(
        `INSERT INTO messages (id, chat_id, sender, text, time)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [message.id, message.chatId, message.sender, message.text, message.time],
      )
    }
    await client.query(
      `INSERT INTO storage_meta (key, value) VALUES ('json_migrated', '1')
       ON CONFLICT (key) DO NOTHING`,
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function loadFromPostgres(activePool: Pool): Promise<void> {
  const userRows = await activePool.query('SELECT * FROM users ORDER BY username')
  users = userRows.rows.map((row) => ({
    username: String(row.username),
    salt: String(row.salt),
    passwordHash: String(row.password_hash),
    publicJwk: parseJwk(row.public_jwk),
    recoverySalt: row.recovery_salt == null ? undefined : String(row.recovery_salt),
    recoveryHash: row.recovery_hash == null ? undefined : String(row.recovery_hash),
    recoveryAttempts: Number(row.recovery_attempts ?? 0),
    recoveryLockedUntil: Number(row.recovery_locked_until ?? 0),
  }))

  const messageRows = await activePool.query(
    'SELECT id, chat_id, sender, text, time FROM messages ORDER BY time ASC, id ASC',
  )
  messages = messageRows.rows.map((row) => ({
    id: String(row.id),
    chatId: String(row.chat_id),
    sender: String(row.sender),
    text: String(row.text),
    time: String(row.time),
  }))
}

function queuePostgresWrite<T>(write: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(write, write)
  writeQueue = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

async function initStorage(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl)
    throw new Error('DATABASE_URL is required. HonDen stores accounts and messages in Postgres.')
  const activePool = new Pool({
    connectionString: databaseUrl,
    max: 3,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
  })
  try {
    await activePool.query(`
        CREATE TABLE IF NOT EXISTS users (
          username text PRIMARY KEY,
          salt text NOT NULL,
          password_hash text NOT NULL,
          public_jwk jsonb,
          recovery_salt text,
          recovery_hash text,
          recovery_attempts integer NOT NULL DEFAULT 0,
          recovery_locked_until bigint NOT NULL DEFAULT 0
        )
      `)
    await activePool.query(`
        CREATE TABLE IF NOT EXISTS messages (
          id text PRIMARY KEY,
          chat_id text NOT NULL,
          sender text NOT NULL,
          text text NOT NULL,
          time text NOT NULL
        )
      `)
    await activePool.query(`
        CREATE TABLE IF NOT EXISTS storage_meta (
          key text PRIMARY KEY,
          value text NOT NULL
        )
      `)
    await activePool.query(
      'CREATE INDEX IF NOT EXISTS idx_messages_chat_time ON messages (chat_id, time, id)',
    )
    const secretRow = await activePool.query(
      "SELECT value FROM storage_meta WHERE key = 'session_secret'",
    )
    const storedSecret = secretRow.rows[0] as { value?: unknown } | undefined
    if (storedSecret && typeof storedSecret.value === 'string') {
      sessionSecret = storedSecret.value
    } else {
      sessionSecret = createSecret(process.env.JWT_SECRET)
      await activePool.query(
        `INSERT INTO storage_meta (key, value) VALUES ('session_secret', $1)
         ON CONFLICT (key) DO NOTHING`,
        [sessionSecret],
      )
    }
    await migrateJsonToPostgres(activePool)
    pool = activePool
    await loadFromPostgres(activePool)
    console.log(`Loaded ${users.length} users, ${messages.length} messages from ${storageSource}`)
  } catch (error) {
    void activePool.end().catch(() => undefined)
    pool = null
    throw error
  }
}

try {
  await initStorage()
} catch (error) {
  console.error('Postgres storage unavailable', error)
  process.exit(1)
}

function insertMessage(message: StoredMessage): Promise<boolean> {
  const activePool = pool
  if (!activePool) throw new Error('Postgres storage is not available')
  return queuePostgresWrite(async () => {
    const result = await activePool.query(
      `INSERT INTO messages (id, chat_id, sender, text, time)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [message.id, message.chatId, message.sender, message.text, message.time],
    )
    return (result.rowCount ?? 0) > 0
  })
}

function deletePersistedMessage(id: string, sender: string): Promise<boolean> {
  const activePool = pool
  if (!activePool) throw new Error('Postgres storage is not available')
  return queuePostgresWrite(async () => {
    const result = await activePool.query(
      'DELETE FROM messages WHERE id = $1 AND sender = $2',
      [id, sender],
    )
    return (result.rowCount ?? 0) > 0
  })
}

function tokenUser(req: Request): string | null {
  const header = req.headers.authorization
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    return verifyToken(header.slice(7), sessionSecret)
  }
  const queryToken = (req.query as { token?: unknown }).token
  return verifyToken(typeof queryToken === 'string' ? queryToken : undefined, sessionSecret)
}

function tokenFor(username: string): string {
  return issueToken(username, sessionSecret)
}

function persistUsers(): Promise<void> {
  const activePool = pool
  if (!activePool) throw new Error('Postgres storage is not available')
  return queuePostgresWrite(async () => {
    const client = await activePool.connect()
    try {
      await client.query('BEGIN')
      await client.query('DELETE FROM users')
      for (const user of users) {
        await client.query(
          `INSERT INTO users
            (username, salt, password_hash, public_jwk, recovery_salt, recovery_hash, recovery_attempts, recovery_locked_until)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            user.username,
            user.salt,
            user.passwordHash,
            user.publicJwk ? JSON.stringify(user.publicJwk) : null,
            user.recoverySalt ?? null,
            user.recoveryHash ?? null,
            user.recoveryAttempts ?? 0,
            user.recoveryLockedUntil ?? 0,
          ],
        )
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  })
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString('hex')
}

function verifyHash(value: string, salt: string, hash: string): boolean {
  const expected = Buffer.from(hash, 'hex')
  const actual = Buffer.from(hashPassword(value, salt), 'hex')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function recoveryGroup(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  return Array.from(randomBytes(4), (byte) => alphabet[byte % alphabet.length]).join('')
}

function newRecoveryCode(): string {
  let code = ''
  do {
    code = `honey-${recoveryGroup()}-${recoveryGroup()}`
  } while (
    users.some((user) =>
      user.recoveryHash && user.recoverySalt
        ? verifyHash(code, user.recoverySalt, user.recoveryHash)
        : false,
    )
  )
  return code
}

const app = express()

app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  next()
})

app.use(express.json())

app.post('/api/accounts', async (req, res) => {
  const username = cleanUsername((req.body as { username?: unknown } | undefined)?.username)
  const password = (req.body as { password?: unknown } | undefined)?.password
  if (!username || typeof password !== 'string' || !password) {
    res.status(400).json({ error: accountError })
    return
  }
  if (users.some((user) => user.username === username)) {
    res.status(409).json({ error: takenError })
    return
  }
  const salt = randomBytes(16).toString('hex')
  const recoveryCode = newRecoveryCode()
  const recoverySalt = randomBytes(16).toString('hex')
  users.push({
    username,
    salt,
    passwordHash: hashPassword(password, salt),
    publicJwk: null,
    recoverySalt,
    recoveryHash: hashPassword(recoveryCode, recoverySalt),
    recoveryAttempts: 0,
    recoveryLockedUntil: 0,
  })
  await persistUsers()
  res.status(201).json({ username, recoveryCode, token: tokenFor(username) })
})

app.post('/api/login', (req, res) => {
  const username = cleanUsername((req.body as { username?: unknown } | undefined)?.username)
  const password = (req.body as { password?: unknown } | undefined)?.password
  const user = users.find((item) => item.username === username)
  const expected = user ? Buffer.from(user.passwordHash, 'hex') : Buffer.alloc(0)
  const actual =
    user && typeof password === 'string'
      ? Buffer.from(hashPassword(password, user.salt), 'hex')
      : Buffer.alloc(0)
  if (!user || expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    res.status(401).json({ error: accountError })
    return
  }
  res.json({ username: user.username, token: tokenFor(user.username) })
})

app.post('/api/reset', async (req, res) => {
  const body = req.body as {
    username?: unknown
    recoveryCode?: unknown
    newPassword?: unknown
    confirmPassword?: unknown
  }
  const username = cleanUsername(body.username)
  const user = users.find((item) => item.username === username)
  if (!user) {
    res.status(401).json({ error: accountError })
    return
  }
  if (typeof body.newPassword !== 'string' || !body.newPassword) {
    res.status(400).json({ error: accountError })
    return
  }
  if (body.newPassword !== body.confirmPassword) {
    res.status(400).json({ error: mismatchError })
    return
  }
  if (!user.recoveryHash || !user.recoverySalt) {
    res.status(403).json({ error: recoveryError })
    return
  }
  if (user.recoveryLockedUntil && Date.now() < user.recoveryLockedUntil) {
    res.status(429).json({ error: rateLimitError })
    return
  }

  const code =
    typeof body.recoveryCode === 'string'
      ? body.recoveryCode.trim().toLowerCase().replace(/\s+/g, '')
      : ''
  if (!verifyHash(code, user.recoverySalt, user.recoveryHash)) {
    const attempts = (user.recoveryAttempts ?? 0) + 1
    user.recoveryAttempts = attempts
    if (attempts >= 3) {
      user.recoveryLockedUntil = Date.now() + 60_000
      user.recoveryAttempts = 0
      res.status(429).json({ error: rateLimitError })
    } else {
      res.status(403).json({ error: recoveryError })
    }
    await persistUsers()
    return
  }

  user.recoveryAttempts = 0
  user.recoveryLockedUntil = 0
  const salt = randomBytes(16).toString('hex')
  user.salt = salt
  user.passwordHash = hashPassword(body.newPassword, salt)
  await persistUsers()
  res.json({
    username: user.username,
    notice: recoveryNotice,
    token: tokenFor(user.username),
  })
})

app.get('/api/users/:username', (req, res) => {
  const received = String(req.params.username ?? '')
  console.log('[users lookup] received username:', JSON.stringify(received))
  console.log('[users lookup] stored usernames:', JSON.stringify(users.map((user) => user.username)))
  const username = cleanUsername(received)
  if (!username) {
    res.status(400).json({ error: accountError })
    return
  }
  const user = users.find((item) => item.username === username)
  if (!user) {
    res.status(404).json({ error: accountError })
    return
  }
  res.json({
    username: user.username,
    publicKey: user.publicJwk ?? null,
    publicJwk: user.publicJwk ?? null,
  })
})

app.get('/api/public-key', (req, res) => {
  const username = cleanUsername(req.query.username)
  const user = users.find((item) => item.username === username)
  if (!user?.publicJwk) {
    res.status(404).json({ error: accountError })
    return
  }
  res.json({ username: user.username, publicJwk: user.publicJwk })
})

app.post('/api/public-key', async (req, res) => {
  const username = cleanUsername((req.body as { username?: unknown } | undefined)?.username)
  const viewer = tokenUser(req)
  if (!viewer || viewer !== username) {
    res.status(401).json({ error: accountError })
    return
  }
  const publicJwk = (req.body as { publicJwk?: unknown } | undefined)?.publicJwk
  const user = users.find((item) => item.username === username)
  if (!user || !publicJwk || typeof publicJwk !== 'object' || Array.isArray(publicJwk)) {
    res.status(400).json({ error: accountError })
    return
  }
  user.publicJwk = publicJwk as Record<string, unknown>
  await persistUsers()
  console.log('Public key uploaded', username)
  res.json({ ok: true })
})

app.get('/downloads/honden.apk', (_req, res) => {
  if (!existsSync(apkFile)) {
    console.info('HonDen APK requested but not present:', apkFile)
    res.status(404).json({ error: 'The Android app is being prepared. Check back in a moment.' })
    return
  }
  res.setHeader('Content-Type', 'application/vnd.android.package-archive')
  res.setHeader('Content-Disposition', 'attachment; filename="honden.apk"')
  res.sendFile(apkFile)
})

app.get('/health', (_req, res) => {
  res.json({ ok: true, storage: storageSource })
})

app.get('/api/messages', (req, res) => {
  const viewer = tokenUser(req)
  if (!viewer) {
    res.status(401).json({ error: errorCopy })
    return
  }
  const requestedChatId = req.query.chatId
  if (
    typeof requestedChatId !== 'string' ||
    (requestedChatId !== '*' && !isValidChatId(requestedChatId, globalThreadId))
  ) {
    res.status(400).json({ error: errorCopy })
    return
  }
  const chatId = requestedChatId
  const afterTime = typeof req.query.afterTime === 'string' ? req.query.afterTime : undefined
  const afterId = typeof req.query.afterId === 'string' ? req.query.afterId : undefined
  const cursor: Cursor | null =
    afterTime && afterId ? { time: afterTime, id: afterId } : null
  const requestedLimit = Number(req.query.limit)
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 200)
    : 200

  let visible = messages.filter((message) =>
    chatId === '*'
      ? canAccessConversation(message.sender, message.chatId, viewer, globalThreadId)
      : message.chatId === chatId &&
        canAccessConversation(message.sender, message.chatId, viewer, globalThreadId),
  )
  if (cursor) visible = visible.filter((item) => isAfterCursor(item.time, item.id, cursor))
  visible.sort((a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id))
  res.json(visible.slice(0, limit))
})

app.post('/api/messages', async (req, res) => {
  const viewer = tokenUser(req)
  if (!viewer) {
    res.status(401).json({ error: errorCopy })
    return
  }
  const body = req.body as Partial<StoredMessage> | undefined
  if (!body || !isValidChatId(body.chatId, globalThreadId) || !isValidMessageText(body.text)) {
    res.status(400).json({ error: errorCopy })
    return
  }
  if (
    body.chatId !== globalThreadId &&
    body.chatId !== viewer &&
    !users.some((user) => user.username === body.chatId)
  ) {
    res.status(403).json({ error: errorCopy })
    return
  }

  if (body.chatId === globalThreadId) {
    if (blockedGlobalText(body.text)) {
      res.status(400).json({ error: globalError })
      return
    }
    const lastPostedAt = globalRateLimit.get(viewer) ?? 0
    if (Date.now() - lastPostedAt < 1000) {
      res.status(429).json({ error: rateLimitError })
      return
    }
    globalRateLimit.set(viewer, Date.now())
  }

  const id = body.id && isValidMessageId(body.id) ? body.id : randomUUID()
  const message: StoredMessage = {
    id,
    chatId: body.chatId,
    sender: viewer,
    text: body.text.trim(),
    time: new Date().toISOString(),
  }

  try {
    const inserted = await insertMessage(message)
    if (!inserted) {
      const existing = messages.find((item) => item.id === id)
      console.info('[message] duplicate acknowledged', { id })
      res.status(200).json(existing ?? message)
      return
    }
    messages.push(message)
    broadcastMessage(message)
    console.info('[message] persisted', { id, chatId: message.chatId })
    res.status(201).json(message)
  } catch (error) {
    console.error(
      '[message] persistence failed',
      error instanceof Error ? error.message : 'unknown',
    )
    res.status(503).json({ error: errorCopy })
  }
})

app.delete('/api/messages/:id', async (req, res) => {
  const viewer = tokenUser(req)
  if (!viewer) {
    res.status(401).json({ error: errorCopy })
    return
  }
  const existing = messages.find((message) => message.id === req.params.id)
  if (!existing) {
    res.status(404).json({ error: errorCopy })
    return
  }
  if (existing.sender !== viewer) {
    res.status(403).json({ error: errorCopy })
    return
  }
  try {
    const deleted = await deletePersistedMessage(existing.id, viewer)
    if (!deleted) {
      res.status(404).json({ error: errorCopy })
      return
    }
    messages = messages.filter((message) => message.id !== existing.id)
    broadcastDelete(existing)
    console.info('[message] deleted', { id: existing.id })
    res.status(204).end()
  } catch (error) {
    console.error('[message] delete failed', error instanceof Error ? error.message : 'unknown')
    res.status(503).json({ error: errorCopy })
  }
})

const server = createServer(app)

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
]

type WsClient = { socket: WebSocket; user: string; lastPong: number }
const clients = new Set<WsClient>()

const wss = new WebSocketServer({
  server,
  maxPayload: 64 * 1024,
  verifyClient: (info: { origin: string }) => isOriginAllowed(info.origin, allowedOrigins),
})

function sendIfOpen(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload))
}

function canReceive(client: WsClient, message: StoredMessage): boolean {
  return (
    message.chatId === globalThreadId ||
    client.user === message.sender ||
    client.user === message.chatId
  )
}

function broadcastMessage(message: StoredMessage): void {
  const payload = { type: 'message', message }
  for (const client of clients) {
    if (canReceive(client, message)) sendIfOpen(client.socket, payload)
  }
}

function broadcastDelete(message: StoredMessage): void {
  const payload = { type: 'delete', id: message.id }
  for (const client of clients) {
    if (canReceive(client, message)) sendIfOpen(client.socket, payload)
  }
}

wss.on('connection', (socket, request) => {
  let token: string | undefined
  try {
    token =
      new URL(request.url ?? '/', 'http://localhost').searchParams.get('token') ?? undefined
  } catch {
    token = undefined
  }
  const user = verifyToken(token, sessionSecret)
  if (!user) {
    socket.close(1008, 'Unauthorized')
    return
  }

  const client: WsClient = { socket, user, lastPong: Date.now() }
  clients.add(client)
  sendIfOpen(socket, { type: 'ready', userId: user })
  console.info('[ws] authenticated', { user })

  socket.on('pong', () => {
    client.lastPong = Date.now()
  })

  socket.on('message', (raw) => {
    let frame: { type?: unknown; to?: unknown; callId?: unknown }
    try {
      frame = JSON.parse(raw.toString()) as { type?: unknown; to?: unknown; callId?: unknown }
    } catch {
      return
    }
    if (frame.type === 'ping') {
      sendIfOpen(socket, { type: 'pong' })
      return
    }
    if (
      typeof frame.type === 'string' &&
      frame.type.startsWith('call:') &&
      typeof frame.to === 'string' &&
      typeof frame.callId === 'string'
    ) {
      const payload = JSON.stringify(frame)
      for (const peer of clients) {
        if (peer.socket.readyState === WebSocket.OPEN) peer.socket.send(payload)
      }
    }
  })

  const remove = () => clients.delete(client)
  socket.on('close', remove)
  socket.on('error', remove)
})

const heartbeat = setInterval(() => {
  const now = Date.now()
  for (const client of clients) {
    if (now - client.lastPong > 90_000) {
      client.socket.terminate()
      continue
    }
    if (client.socket.readyState === WebSocket.OPEN) client.socket.ping()
  }
}, 30_000)
heartbeat.unref()

const distDir = join(here, '..', 'dist')
app.use(express.static(distDir))
app.use((req, res, next) => {
  if (req.path === '/api' || req.path.startsWith('/api/')) {
    next()
    return
  }
  res.sendFile(join(distDir, 'index.html'))
})

const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? '0.0.0.0'
server.listen(port, host, () => {
  console.log(`HonDen server listening on http://${host}:${port}`)
})
