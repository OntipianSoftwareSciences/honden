import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
  createIdentity,
  decryptText,
  deriveSharedKey,
  encryptText,
  importPublicKey,
  type EncryptedPayload,
} from '../src/crypto/e2ee'
import { startMessageSocket } from '../src/transport/messageSocket'
import { mergeById } from '../src/transport/reliability'
import type { ChatMessage } from '../src/types'

type FakeEvent = { data?: string; type?: string; code?: number; reason?: string }
type WireMessage = {
  id: string
  chatId: string
  sender: string
  text: string
  time: string
}

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

  constructor(readonly url: string) {
    createdSockets.push(this)
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.({ type: 'open' })
  }

  deliver(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) })
  }

  send(_data: string): void {
    // Test socket only needs to receive frames.
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
      location: { hostname: 'honden.onrender.com', origin: 'https://honden.onrender.com' },
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

function receiveLiveFrame(frame: unknown): WireMessage {
  installBrowserEnv()
  const received: WireMessage[] = []
  const controller = startMessageSocket('ws://test/ws?token=test', {
    onFrame: (event) => {
      if (event.type === 'message' && event.message) received.push(event.message as WireMessage)
    },
    onStatus: () => undefined,
    onSync: async () => undefined,
  })
  const socket = createdSockets.at(-1)
  assert.ok(socket)
  socket.open()
  socket.deliver({ type: 'ready', userId: 'recipient' })
  socket.deliver(frame)
  controller.close()
  assert.equal(received.length, 1, 'client must receive the live message frame')
  return received[0] as WireMessage
}

function toChatMessage(wire: WireMessage, threadId: string, text: string): ChatMessage {
  return {
    id: wire.id,
    threadId,
    senderId: `@${wire.sender}`,
    from: wire.sender === 'heather' ? 'me' : 'them',
    time: new Date(wire.time).toISOString(),
    timestamp: new Date(wire.time).getTime(),
    text,
  }
}

async function encryptedDm(): Promise<{
  wire: WireMessage
  decrypt: () => Promise<string>
}> {
  const sender = await createIdentity()
  const recipient = await createIdentity()
  const senderKey = await deriveSharedKey(sender.privateKey, await importPublicKey(recipient.publicJwk))
  const recipientKey = await deriveSharedKey(
    recipient.privateKey,
    await importPublicKey(sender.publicJwk),
  )
  const payload = await encryptText('hey heather, live!', senderKey)
  const wire: WireMessage = {
    id: 'dm-live-1',
    chatId: 'heather',
    sender: 'sukar3tto',
    text: JSON.stringify(payload),
    time: '2026-11-23T20:00:00.000Z',
  }
  return {
    wire,
    decrypt: () => decryptText(payload as EncryptedPayload, recipientKey),
  }
}

test('DM sent -> recipient sees it live, no reload', async () => {
  const { wire, decrypt } = await encryptedDm()
  const received = receiveLiveFrame({ type: 'message', message: wire })
  const text = await decrypt()
  const liveMessages = mergeById([], [toChatMessage(received, 'sukar3tto', text)])
  const visible = liveMessages.filter((message) => message.threadId === 'sukar3tto')
  assert.equal(visible.length, 1)
  assert.equal(visible[0]?.text, 'hey heather, live!')
})

test('#honey-den message sent -> other user sees it live, no reload', () => {
  const wire: WireMessage = {
    id: 'global-live-1',
    chatId: '#honey-den',
    sender: 'sukar3tto',
    text: 'hello honey den',
    time: '2026-11-23T20:01:00.000Z',
  }
  const received = receiveLiveFrame({ type: 'message', message: wire })
  const liveMessages = mergeById([], [toChatMessage(received, '#honey-den', received.text)])
  const visible = liveMessages.filter((message) => message.threadId === '#honey-den')
  assert.equal(visible.length, 1)
  assert.equal(visible[0]?.text, 'hello honey den')
})

test('no duplicate after reload when sync replays a live message', async () => {
  const { wire, decrypt } = await encryptedDm()
  const received = receiveLiveFrame({ type: 'message', message: wire })
  const live = toChatMessage(received, 'sukar3tto', await decrypt())
  const afterReload = mergeById([live], [toChatMessage(received, 'sukar3tto', await decrypt())])
  assert.equal(afterReload.length, 1)
  assert.equal(afterReload[0]?.id, wire.id)
})

test('message still decrypts and reads after reload', async () => {
  const { wire, decrypt } = await encryptedDm()
  // A reload re-fetches the same ciphertext from the server and decrypts it
  // again with the local private key; E2EE must survive the round trip.
  const reloadedWire = receiveLiveFrame({ type: 'message', message: wire })
  const parsed = JSON.parse(reloadedWire.text) as EncryptedPayload
  assert.ok(parsed.iv && parsed.ciphertext, 'stored wire text must stay encrypted')
  const reloaded = mergeById([], [toChatMessage(reloadedWire, 'sukar3tto', await decrypt())])
  assert.equal(reloaded[0]?.text, 'hey heather, live!')
})
