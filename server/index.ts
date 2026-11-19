import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { WebSocket, WebSocketServer } from 'ws'

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
// free tier, local JSON only
const dataDir = join(here, 'data')
const dataFile = join(dataDir, 'messages.json')
const usersFile = join(dataDir, 'users.json')
const downloadsDir = join(here, 'downloads')
const apkFile = join(downloadsDir, 'honden.apk')
mkdirSync(dataDir, { recursive: true })
mkdirSync(downloadsDir, { recursive: true })
const errorCopy = 'Something went wrong on our side. Nothing was sent. Try again in a moment.'
const accountError = "We couldn't find @thatname. Check the spelling and try again."
const takenError = 'That @username is already taken. Try another one.'
const mismatchError = "Those passwords don't match. Try again."
const recoveryError = "That recovery code doesn't match. Check it and try again."
const rateLimitError = 'Too many tries. Wait a minute and try again.'
const recoveryNotice = 'Your recovery code is still the same. Keep it safe.'

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

function cleanUsername(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim().replace(/^@/, '').trim().toLowerCase()
  return /^[a-z0-9_]{2,24}$/.test(name) ? name : null
}

let messages: StoredMessage[] = []
if (existsSync(dataFile)) {
  try {
    const parsed: unknown = JSON.parse(readFileSync(dataFile, 'utf8'))
    if (Array.isArray(parsed)) messages = parsed.filter(isMessage)
  } catch {
    messages = []
  }
}
console.log(`Loaded ${messages.length} messages from messages.json`)

let users: StoredUser[] = []
if (existsSync(usersFile)) {
  try {
    const parsed: unknown = JSON.parse(readFileSync(usersFile, 'utf8'))
    if (Array.isArray(parsed)) {
      users = parsed
        .filter((item): item is StoredUser => {
          const user = item as Partial<StoredUser>
          return (
            typeof user.username === 'string' &&
            typeof user.salt === 'string' &&
            typeof user.passwordHash === 'string'
          )
        })
        .map((user) => ({ ...user, username: cleanUsername(user.username) ?? user.username }))
    }
  } catch {
    users = []
  }
}
console.log(`Loaded ${users.length} users from users.json`)

function writeJson(file: string, value: unknown): void {
  const temp = `${file}.tmp`
  writeFileSync(temp, JSON.stringify(value, null, 2))
  renameSync(temp, file)
}

function persist() {
  writeJson(dataFile, messages)
}

function persistUsers() {
  writeJson(usersFile, users)
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

app.post('/api/accounts', (req, res) => {
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
  persistUsers()
  res.status(201).json({ username, recoveryCode })
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
  res.json({ username: user.username })
})

app.post('/api/reset', (req, res) => {
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
    persistUsers()
    return
  }

  user.recoveryAttempts = 0
  user.recoveryLockedUntil = 0
  const salt = randomBytes(16).toString('hex')
  user.salt = salt
  user.passwordHash = hashPassword(body.newPassword, salt)
  persistUsers()
  res.json({ username: user.username, notice: recoveryNotice })
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
  res.json({ username: user.username })
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

app.post('/api/public-key', (req, res) => {
  const username = cleanUsername((req.body as { username?: unknown } | undefined)?.username)
  const publicJwk = (req.body as { publicJwk?: unknown } | undefined)?.publicJwk
  const user = users.find((item) => item.username === username)
  if (!user || !publicJwk || typeof publicJwk !== 'object' || Array.isArray(publicJwk)) {
    res.status(400).json({ error: accountError })
    return
  }
  user.publicJwk = publicJwk as Record<string, unknown>
  persistUsers()
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
  res.json({ ok: true })
})

app.get('/api/messages', (req, res) => {
  const chatId = typeof req.query.chatId === 'string' ? req.query.chatId : 'alex'
  res.json(
    messages
      .filter((message) => message.chatId === chatId)
      .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()),
  )
})

app.post('/api/messages', (req, res) => {
  const body = req.body as Partial<StoredMessage> | undefined
  console.log(
    `POST /api/messages, chatId=${typeof body?.chatId === 'string' ? body.chatId : ''}, text=${
      typeof body?.text === 'string' ? body.text : ''
    }`,
  )
  if (
    !body ||
    typeof body.chatId !== 'string' ||
    typeof body.sender !== 'string' ||
    typeof body.text !== 'string' ||
    !body.text.trim()
  ) {
    res.status(400).json({ error: errorCopy })
    return
  }

  const message: StoredMessage = {
    id: typeof body.id === 'string' && body.id ? body.id : randomUUID(),
    chatId: body.chatId,
    sender: body.sender,
    text: body.text.trim(),
    time: new Date().toISOString(),
  }
  messages.push(message)
  persist()
  console.log(`Saved ${messages.length} messages`)
  broadcast({ type: 'message', message })
  res.status(201).json(message)
})

app.delete('/api/messages/:id', (req, res) => {
  const next = messages.filter((message) => message.id !== req.params.id)
  if (next.length === messages.length) {
    res.status(404).json({ error: errorCopy })
    return
  }
  messages = next
  persist()
  broadcast({ type: 'delete', id: req.params.id })
  res.status(204).end()
})

const server = createServer(app)
const wss = new WebSocketServer({ server })

wss.on('connection', (socket) => {
  socket.on('message', (raw) => {
    try {
      const frame = JSON.parse(raw.toString()) as { type?: unknown }
      if (typeof frame.type === 'string' && frame.type.startsWith('call:')) {
        broadcast(frame)
      }
    } catch {
      return
    }
  })
})

function broadcast(frame: unknown) {
  const payload = JSON.stringify(frame)
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload)
  }
}

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
