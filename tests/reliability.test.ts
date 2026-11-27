import assert from 'node:assert/strict'
import test from 'node:test'
import { authenticatedWs } from '../src/api/client'
import { connectionLabels, wakePillView } from '../src/components/ConnectionPill'
import type { ConnectionDetail } from '../src/types'
import { startMessageSocket } from '../src/transport/messageSocket'
import {
  advanceCursor,
  CONNECT_TIMEOUT_MS,
  HEALTH_POLL_MS,
  isAfterCursor,
  MAX_CONNECT_RETRIES,
  RETRY_INTERVAL_MS,
  mergeById,
  reconnectDelay,
  startWakeCountdown,
  stopWakeCountdown,
  tickWakeCountdown,
  WAKE_ESTIMATE_SECONDS,
  WAKE_INTERVAL_MS,
} from '../src/transport/reliability'

test('connection failure surfaces after the 30s wake estimate and health polling stays faster than Render wake', () => {
  assert.equal(CONNECT_TIMEOUT_MS, 30000)
  assert.equal(WAKE_ESTIMATE_SECONDS, 30)
  assert.equal(HEALTH_POLL_MS, 5000)
  assert.equal(RETRY_INTERVAL_MS, 5000)
  assert.equal(MAX_CONNECT_RETRIES, 6)
  assert.ok(WAKE_INTERVAL_MS > 0 && WAKE_INTERVAL_MS < 15 * 60 * 1000)
})

test('pill shows live retry count while a stalled handshake keeps retrying', () => {
  const detail: ConnectionDetail = { attempt: 2, maxAttempts: 6, secondsLeft: 19 }
  const view = wakePillView('connecting', { secondsLeft: 30, stopped: false }, detail)
  assert.equal(view.label, 'Connecting... 19s · retry 2/6')
  assert.equal(view.showCountdown, true)
  assert.equal(view.showRetry, false)
})

test('pill keeps ticking when a stalled handshake sends no fresh detail', () => {
  const staleDetail: ConnectionDetail = { attempt: 0, maxAttempts: 6, secondsLeft: 30 }
  const view = wakePillView('connecting', { secondsLeft: 22, stopped: false }, staleDetail)
  assert.equal(view.label, 'Connecting... 22s · retry 0/6')
  assert.equal(view.showCountdown, true)
  assert.equal(view.showRetry, false)
})

test('wake countdown starts at 30 and ticks down once per second', () => {
  let countdown = startWakeCountdown()
  assert.equal(countdown.secondsLeft, 30)
  assert.equal(countdown.stopped, false)
  const first = wakePillView('waking', countdown)
  assert.equal(first.showCountdown, true)
  assert.equal(first.label, 'Server is waking up… 30s')
  countdown = tickWakeCountdown(countdown)
  assert.equal(wakePillView('waking', countdown).label, 'Server is waking up… 29s')
  countdown = tickWakeCountdown(countdown)
  assert.equal(
    wakePillView('connecting', countdown).label,
    'Connecting to the honey den… 28s',
  )
})

test('wake countdown stops immediately when the server connects early', () => {
  const stopped = stopWakeCountdown(tickWakeCountdown(startWakeCountdown()))
  assert.equal(tickWakeCountdown(stopped).secondsLeft, 29, 'no ticks after Connected')
  const connected = wakePillView('live', stopped)
  assert.equal(connected.showCountdown, false)
  assert.equal(connected.showRetry, false)
  assert.equal(connected.label, connectionLabels.live)
})

test('wake pill shows Retry at 0 and never restarts the countdown by itself', () => {
  let countdown = startWakeCountdown()
  for (let i = 0; i < 30; i += 1) countdown = tickWakeCountdown(countdown)
  assert.deepEqual(countdown, { secondsLeft: 0, stopped: true })
  assert.deepEqual(tickWakeCountdown(countdown), countdown)
  const retry = wakePillView('unreachable', countdown)
  assert.equal(retry.showRetry, true)
  assert.equal(retry.showCountdown, false)
  assert.equal(retry.label, "Couldn't connect to the honey den. Check your connection and tap Retry.")
  assert.equal(
    wakePillView('connecting', countdown).showRetry,
    true,
    'background retries must not restart the countdown',
  )
})

test('reconnectDelay backs off and caps at 30s', () => {
  assert.equal(reconnectDelay(0, () => 0.5), 1000)
  assert.equal(reconnectDelay(1, () => 0.5), 2000)
  assert.equal(reconnectDelay(20, () => 0.5), 30000)
  assert.ok(reconnectDelay(0, () => 0) >= 250)
  assert.ok(reconnectDelay(20, () => 1) <= 30000)
})

test('cursor compares time then id', () => {
  assert.equal(isAfterCursor('2026-01-01T00:00:01.000Z', 'b', null), true)
  assert.equal(
    isAfterCursor('2026-01-01T00:00:01.000Z', 'b', {
      time: '2026-01-01T00:00:01.000Z',
      id: 'a',
    }),
    true,
  )
  assert.equal(
    isAfterCursor('2026-01-01T00:00:01.000Z', 'a', {
      time: '2026-01-01T00:00:01.000Z',
      id: 'b',
    }),
    false,
  )
  assert.equal(
    isAfterCursor('2026-01-01T00:00:00.000Z', 'z', {
      time: '2026-01-01T00:00:01.000Z',
      id: 'a',
    }),
    false,
  )
})

test('advanceCursor only moves forward', () => {
  const start = { time: '2026-01-01T00:00:01.000Z', id: 'b' }
  assert.deepEqual(advanceCursor(null, start), start)
  assert.deepEqual(advanceCursor(start, { time: '2026-01-01T00:00:00.000Z', id: 'z' }), start)
  assert.deepEqual(advanceCursor(start, { time: '2026-01-01T00:00:02.000Z', id: 'a' }), {
    time: '2026-01-01T00:00:02.000Z',
    id: 'a',
  })
})

test('mergeById dedupes and sorts by timestamp', () => {
  const merged = mergeById(
    [
      { id: 'b', timestamp: 2, text: 'second' },
      { id: 'a', timestamp: 1, text: 'first' },
    ],
    [
      { id: 'b', timestamp: 2, text: 'duplicate' },
      { id: 'c', timestamp: 3, text: 'third' },
    ],
  )
  assert.deepEqual(
    merged.map((item) => item.id),
    ['a', 'b', 'c'],
  )
  assert.equal(merged[1]?.text, 'second')
})

type FakeSocketEvent = { code?: number; reason?: string; data?: string; type?: string }

class FakeWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static throwOnClose = false
  static closeCodes: number[] = []

  readyState = FakeWebSocket.CONNECTING
  onopen: ((event: FakeSocketEvent) => void) | null = null
  onmessage: ((event: FakeSocketEvent) => void) | null = null
  onerror: ((event: FakeSocketEvent) => void) | null = null
  onclose: ((event: FakeSocketEvent) => void) | null = null

  constructor(readonly url: string) {
    createdSockets.push(this)
  }

  open() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.({ type: 'open' })
  }

  sendReady() {
    this.onmessage?.({ data: JSON.stringify({ type: 'ready', userId: 'tester' }) })
  }

  send(_data: string) {
    // Heartbeat frames are not needed for these state tests.
  }

  close(code = 1000) {
    if (this.readyState >= FakeWebSocket.CLOSING) return
    FakeWebSocket.closeCodes.push(code)
    if (FakeWebSocket.throwOnClose) throw new Error('WebView close failed')
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({ code: 1000, reason: '' })
  }
}

const createdSockets: FakeWebSocket[] = []
const originalInfo = console.info
const originalWarn = console.warn
type TestListener = () => void

let windowListeners = new Map<string, TestListener[]>()
let documentListeners = new Map<string, TestListener[]>()
let documentHidden = false

function addListener(store: Map<string, TestListener[]>, type: string, listener: TestListener) {
  const listeners = store.get(type) ?? []
  listeners.push(listener)
  store.set(type, listeners)
}

function removeListener(store: Map<string, TestListener[]>, type: string, listener: TestListener) {
  store.set(
    type,
    (store.get(type) ?? []).filter((item) => item !== listener),
  )
}

function fire(store: Map<string, TestListener[]>, type: string) {
  for (const listener of store.get(type) ?? []) listener()
}

function installBrowserEnv(hostname = 'honden.onrender.com', origin = 'https://honden.onrender.com') {
  createdSockets.length = 0
  FakeWebSocket.throwOnClose = false
  FakeWebSocket.closeCodes = []
  windowListeners = new Map()
  documentListeners = new Map()
  documentHidden = false
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    },
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { hostname, origin },
      addEventListener: (type: string, listener: TestListener) =>
        addListener(windowListeners, type, listener),
      removeEventListener: (type: string, listener: TestListener) =>
        removeListener(windowListeners, type, listener),
    },
  })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      addEventListener: (type: string, listener: TestListener) =>
        addListener(documentListeners, type, listener),
      removeEventListener: (type: string, listener: TestListener) =>
        removeListener(documentListeners, type, listener),
      get hidden() {
        return documentHidden
      },
      get visibilityState() {
        return documentHidden ? 'hidden' : 'visible'
      },
    },
  })
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    value: FakeWebSocket,
  })
  console.info = () => undefined
  console.warn = () => undefined
}

function restoreBrowserEnv() {
  console.info = originalInfo
  console.warn = originalWarn
  for (const key of ['localStorage', 'window', 'document', 'WebSocket']) {
    Reflect.deleteProperty(globalThis, key)
  }
}

function fireOnline() {
  fire(windowListeners, 'online')
}

function fireVisibilityChange(hidden = false) {
  documentHidden = hidden
  fire(documentListeners, 'visibilitychange')
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

test('pill goes Connecting -> Connected when the WebSocket opens', async () => {
  installBrowserEnv()
  const statuses: string[] = []
  const controller = startMessageSocket(
    'wss://honden.onrender.com/ws?token=test',
    {
      onStatus: (status) => statuses.push(status),
      onFrame: () => undefined,
      onSync: async () => undefined,
    },
    { connectTimeoutMs: 1000 },
  )
  assert.equal(statuses[0], 'connecting')
  createdSockets[0]?.open()
  createdSockets[0]?.sendReady()
  await delay(20)
  assert.ok(statuses.includes('syncing'), `expected syncing, got ${statuses.join(',')}`)
  assert.equal(statuses.at(-1), 'live')
  assert.equal(connectionLabels.live, 'Connected 🍯')
  controller.close()
  restoreBrowserEnv()
})

test('pill goes to Cannot reach server after the connect timeout', async () => {
  installBrowserEnv()
  const statuses: string[] = []
  const controller = startMessageSocket(
    'wss://honden.onrender.com/ws?token=test',
    {
      onStatus: (status) => statuses.push(status),
      onFrame: () => undefined,
      onSync: async () => undefined,
    },
    {
      connectTimeoutMs: 20,
      retryIntervalMs: 5,
      healthPollMs: 1000,
      probeServer: async () => false,
    },
  )
  await delay(60)
  assert.ok(statuses.includes('unreachable'), `expected unreachable, got ${statuses.join(',')}`)
  assert.equal(connectionLabels.unreachable, "Couldn't connect to the honey den. Check your connection and tap Retry.")
  assert.equal(CONNECT_TIMEOUT_MS, 30000)
  controller.close()
  restoreBrowserEnv()
})

test('pill retries and goes Connected after the server wakes', async () => {
  installBrowserEnv()
  const statuses: string[] = []
  const controller = startMessageSocket(
    'wss://honden.onrender.com/ws?token=test',
    {
      onStatus: (status) => statuses.push(status),
      onFrame: () => undefined,
      onSync: async () => undefined,
    },
    { connectTimeoutMs: 100, retryIntervalMs: 20, maxRetries: 6 },
  )
  await delay(50)
  assert.ok(statuses.includes('reconnecting'), `expected a retry, got ${statuses.join(',')}`)
  const retried = createdSockets.at(-1)
  assert.ok(retried && createdSockets.length >= 2, 'stalled handshake should retry')
  retried.open()
  retried.sendReady()
  for (let i = 0; i < 20 && statuses.at(-1) !== 'live'; i += 1) await delay(5)
  assert.equal(statuses.at(-1), 'live')
  controller.close()
  restoreBrowserEnv()
})

test('visibilitychange resume retries a stuck socket and reaches Connected', async () => {
  installBrowserEnv('tauri.localhost', 'http://tauri.localhost')
  const statuses: string[] = []
  const controller = startMessageSocket(
    'wss://honden.onrender.com/ws?token=test',
    {
      onStatus: (status) => statuses.push(status),
      onFrame: () => undefined,
      onSync: async () => undefined,
    },
    { connectTimeoutMs: 1000 },
  )
  assert.equal(statuses[0], 'connecting')
  assert.equal(createdSockets.length, 1)
  // The APK was backgrounded with the handshake still in CONNECTING.
  fireVisibilityChange()
  assert.equal(createdSockets.length, 2, 'resume should open a fresh socket')
  const resumed = createdSockets[1]
  assert.ok(resumed)
  resumed.open()
  resumed.sendReady()
  await delay(20)
  assert.equal(statuses.at(-1), 'live')
  assert.equal(connectionLabels.live, 'Connected 🍯')
  controller.close()
  restoreBrowserEnv()
})

test('online event retries a stuck socket and reports Connected', async () => {
  installBrowserEnv('tauri.localhost', 'http://tauri.localhost')
  const statuses: string[] = []
  const controller = startMessageSocket(
    'wss://honden.onrender.com/ws?token=test',
    {
      onStatus: (status) => statuses.push(status),
      onFrame: () => undefined,
      onSync: async () => undefined,
    },
    { connectTimeoutMs: 1000 },
  )
  assert.equal(createdSockets.length, 1)
  fireOnline()
  assert.equal(createdSockets.length, 2, 'online should retry a stuck socket')
  const retried = createdSockets[1]
  assert.ok(retried)
  retried.open()
  retried.sendReady()
  await delay(20)
  assert.equal(statuses.at(-1), 'live')
  controller.close()
  restoreBrowserEnv()
})

test('stalled handshake retries every 5s, six times, then shows Retry', async () => {
  installBrowserEnv()
  const statuses: string[] = []
  const details: (ConnectionDetail | undefined)[] = []
  const controller = startMessageSocket(
    'wss://honden.onrender.com/ws?token=test',
    {
      onStatus: (status, detail) => {
        statuses.push(status)
        details.push(detail)
      },
      onFrame: () => undefined,
      onSync: async () => undefined,
    },
    { connectTimeoutMs: 200, retryIntervalMs: 5, maxRetries: 6 },
  )
  await delay(80)
  assert.equal(createdSockets.length, 7, 'initial socket plus six automatic retries')
  assert.equal(statuses.at(-1), 'unreachable')
  assert.ok(details.some((detail) => detail?.attempt === 6), 'retry count must reach 6')
  assert.equal(
    connectionLabels.unreachable,
    "Couldn't connect to the honey den. Check your connection and tap Retry.",
  )
  controller.close()
  restoreBrowserEnv()
})

test('stalled handshake still retries when Android WebView close() throws', async () => {
  installBrowserEnv()
  FakeWebSocket.throwOnClose = true
  const details: (ConnectionDetail | undefined)[] = []
  const controller = startMessageSocket(
    'wss://honden.onrender.com/ws?token=test',
    {
      onStatus: (_status, detail) => {
        details.push(detail)
      },
      onFrame: () => undefined,
      onSync: async () => undefined,
    },
    { connectTimeoutMs: 200, retryIntervalMs: 5, maxRetries: 6 },
  )
  await delay(80)
  assert.equal(createdSockets.length, 7, 'a throwing close must not stop the retry chain')
  assert.ok(details.some((detail) => detail?.attempt === 6), 'retry count must reach 6')
  assert.ok(FakeWebSocket.closeCodes.length > 0)
  assert.ok(
    FakeWebSocket.closeCodes.every((code) => code === 1000),
    'close uses an explicit valid code for WebViews',
  )
  controller.close()
  restoreBrowserEnv()
})

test('every stalled attempt logs a native line with the URL and no token', async () => {
  installBrowserEnv()
  const logs: string[] = []
  const controller = startMessageSocket(
    'wss://honden.onrender.com/ws?token=super-secret-token',
    {
      onStatus: () => undefined,
      onFrame: () => undefined,
      onSync: async () => undefined,
    },
    {
      connectTimeoutMs: 200,
      retryIntervalMs: 5,
      maxRetries: 6,
      onLog: (message) => logs.push(message),
    },
  )
  await delay(80)
  const attempts = logs.filter((line) => line.startsWith('HonDen connect retry'))
  const failures = logs.filter((line) => line.startsWith('HonDen connect failed'))
  assert.equal(attempts.length, 7, 'initial attempt plus six retries must all be logged')
  assert.equal(failures.length, 7, 'each failed attempt must log its error')
  assert.equal(
    attempts[0],
    'HonDen connect retry 1/6 to wss://honden.onrender.com/ws',
  )
  assert.ok(attempts.some((line) => line.includes('retry 6/6')))
  assert.ok(failures.every((line) => line.includes('handshake timed out')))
  assert.ok(logs.every((line) => !line.includes('super-secret-token')))
  controller.close()
  restoreBrowserEnv()
})

test('Android build WebSocket URL is wss://honden.onrender.com, not localhost', () => {
  installBrowserEnv('tauri.localhost', 'http://tauri.localhost')
  localStorage.setItem('honden.token', 'test.token.value')
  const url = authenticatedWs('/ws')
  assert.ok(url.startsWith('wss://honden.onrender.com/ws?'), url)
  assert.ok(!url.includes('localhost'), url)
  assert.ok(url.includes('token=test.token.value'), url)
  restoreBrowserEnv()
})
