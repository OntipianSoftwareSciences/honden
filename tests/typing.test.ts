import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
  TYPING_VISIBLE_MS,
  pruneTyping,
  typingLabel,
  typingThreadId,
  updateTyping,
  type TypingMap,
} from '../src/typing/indicator'
import { startMessageSocket } from '../src/transport/messageSocket'

type FakeEvent = { data?: string; type?: string; code?: number; reason?: string }
const createdSockets: FakeWebSocket[] = []
const originalInfo = console.info
const originalWarn = console.warn

class FakeWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState = FakeWebSocket.CONNECTING
  onopen: ((event: FakeEvent) => void) | null = null
  onmessage: ((event: FakeEvent) => void) | null = null
  onerror: ((event: FakeEvent) => void) | null = null
  onclose: ((event: FakeEvent) => void) | null = null
  sent: string[] = []

  constructor() {
    createdSockets.push(this)
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.({ type: 'open' })
  }

  deliver(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) })
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({ code: 1000, reason: 'test close' })
  }
}

function installBrowserEnv(): void {
  createdSockets.length = 0
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    value: FakeWebSocket,
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { hostname: 'localhost', origin: 'http://localhost:5173' },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
  })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      hidden: false,
      visibilityState: 'visible',
    },
  })
  console.info = () => undefined
  console.warn = () => undefined
}

afterEach(() => {
  console.info = originalInfo
  console.warn = originalWarn
  for (const key of ['WebSocket', 'window', 'document']) Reflect.deleteProperty(globalThis, key)
})

test('typing label names the sender and combines two people in a channel', () => {
  const now = 1_000
  const map = updateTyping(
    updateTyping({}, '#honey-den', 'heather', true, now),
    '#honey-den',
    'phoenix',
    true,
    now,
  )
  const names = map['#honey-den'] ?? []
  assert.equal(typingLabel(names.slice(0, 1)), 'Heather is typing...')
  assert.equal(typingLabel(names), 'Heather and Phoenix are typing...')
  assert.equal(typingLabel([]), '')
  assert.equal(typingLabel(names.slice(0, 1)).includes('Someone'), false)
})

test('typing stays in its own chat: channel, incoming DM and outgoing DM', () => {
  assert.equal(typingThreadId('#honey-den', 'heather', 'mom', '#honey-den'), '#honey-den')
  assert.equal(typingThreadId('mom', 'heather', 'mom', '#honey-den'), 'heather')
  assert.equal(typingThreadId('mom', 'heather', 'heather', '#honey-den'), 'mom')
  const map = updateTyping({}, '#honey-den', 'heather', true, 1)
  assert.equal(map.mom, undefined, 'channel typing never shows in a DM')
})

test('typing entries replace, clear, and expire after five seconds', () => {
  const now = 10_000
  let map: TypingMap = updateTyping({}, 'mom', 'heather', true, now)
  map = updateTyping(map, 'mom', 'heather', true, now + 100)
  assert.equal(map.mom?.length, 1, 'one indicator per person per chat')
  assert.equal(map.mom?.[0]?.expiresAt, now + 100 + TYPING_VISIBLE_MS)
  map = updateTyping(map, 'mom', 'heather', false, now + 200)
  assert.equal(map.mom, undefined, 'stopped typing hides immediately')
  map = updateTyping(map, 'mom', 'heather', true, now + 300)
  assert.equal(pruneTyping(map, now + 300 + TYPING_VISIBLE_MS - 1).mom?.length, 1)
  assert.equal(pruneTyping(map, now + 300 + TYPING_VISIBLE_MS).mom, undefined)
})

test('existing socket forwards typing frames and sends no message content', () => {
  installBrowserEnv()
  const frames: Record<string, unknown>[] = []
  const controller = startMessageSocket('ws://test/ws?token=test', {
    onFrame: (frame) => frames.push(frame as Record<string, unknown>),
    onStatus: () => undefined,
    onSync: async () => undefined,
  })
  const socket = createdSockets.at(-1)
  assert.ok(socket)
  socket.open()
  socket.deliver({ type: 'ready', userId: 'mom' })
  socket.deliver({ type: 'typing', chatId: 'mom', userId: 'heather', isTyping: true })
  controller.send({ type: 'typing', chatId: 'heather', userId: 'mom', isTyping: false })
  controller.close()

  assert.equal(frames.length, 1)
  assert.deepEqual(frames[0], { type: 'typing', chatId: 'mom', userId: 'heather', isTyping: true })
  const outgoing = JSON.parse(socket.sent.at(-1) ?? '{}') as Record<string, unknown>
  assert.deepEqual(outgoing, { type: 'typing', chatId: 'heather', userId: 'mom', isTyping: false })
  assert.equal('text' in outgoing, false)
  assert.equal('plain' in outgoing, false)
})
