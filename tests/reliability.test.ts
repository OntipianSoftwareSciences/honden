import assert from 'node:assert/strict'
import test from 'node:test'
import { authenticatedWs } from '../src/api/client'
import { connectionLabels, wakePillView } from '../src/components/ConnectionPill'
import { startMessageSocket } from '../src/transport/messageSocket'
import {
  advanceCursor,
  CONNECT_TIMEOUT_MS,
  HEALTH_POLL_MS,
  isAfterCursor,
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
  assert.ok(WAKE_INTERVAL_MS > 0 && WAKE_INTERVAL_MS < 15 * 60 * 1000)
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
  assert.equal(retry.label, 'Cannot reach server, tap Retry')
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

  close() {
    if (this.readyState >= FakeWebSocket.CLOSING) return
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
    { connectTimeoutMs: 20, healthPollMs: 1000, probeServer: async () => false },
  )
  await delay(60)
  assert.ok(statuses.includes('unreachable'), `expected unreachable, got ${statuses.join(',')}`)
  assert.equal(connectionLabels.unreachable, 'Cannot reach server, tap Retry')
  assert.equal(CONNECT_TIMEOUT_MS, 30000)
  controller.close()
  restoreBrowserEnv()
})

test('pill retries and goes Connected after the server wakes', async () => {
  installBrowserEnv()
  const statuses: string[] = []
  let probes = 0
  const controller = startMessageSocket(
    'wss://honden.onrender.com/ws?token=test',
    {
      onStatus: (status) => statuses.push(status),
      onFrame: () => undefined,
      onSync: async () => undefined,
    },
    {
      connectTimeoutMs: 20,
      healthPollMs: 10,
      probeServer: async () => {
        probes += 1
        return probes >= 2
      },
    },
  )
  await delay(60)
  assert.ok(statuses.includes('unreachable'))
  let retried: FakeWebSocket | undefined
  for (let i = 0; i < 20 && !createdSockets[1]; i += 1) await delay(10)
  retried = createdSockets[1]
  assert.ok(retried, 'health probe should trigger a retry socket')
  retried.open()
  retried.sendReady()
  for (let i = 0; i < 20 && statuses.at(-1) !== 'live'; i += 1) await delay(10)
  assert.equal(statuses.at(-1), 'live')
  assert.ok(probes >= 2)
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

test('Android build WebSocket URL is wss://honden.onrender.com, not localhost', () => {
  installBrowserEnv('tauri.localhost', 'http://tauri.localhost')
  localStorage.setItem('honden.token', 'test.token.value')
  const url = authenticatedWs('/ws')
  assert.ok(url.startsWith('wss://honden.onrender.com/ws?'), url)
  assert.ok(!url.includes('localhost'), url)
  assert.ok(url.includes('token=test.token.value'), url)
  restoreBrowserEnv()
})
