import {
  createIdentity,
  deriveSharedKey,
  importPublicKey,
  randomId,
} from '../crypto/e2ee'
import type { Identity } from '../crypto/e2ee'

export type CipherFrame = {
  iv: string
  ciphertext: string
  senderId: string
  threadId: string
  timestamp: number
}

type HelloFrame = {
  type: 'hello'
  senderId: string
  publicKey: JsonWebKey
}

type DeleteFrame = {
  type: 'delete'
  senderId: string
  threadId: string
  messageId: string
}

export type SyncFrame = CipherFrame | HelloFrame | DeleteFrame

export type RelayState = 'off' | 'connecting' | 'open' | 'error'

export type ChannelStatus = {
  senderId: string
  peerCount: number
  relayState: RelayState
  simulateReplies: boolean
}

export const SIMULATED_SENDER = 'honden-sim'

const SYNC_NAME = 'honden-sync'

let identity: Identity | null = null
let selfKey: CryptoKey | null = null
let senderId = ''
let peers = new Map<string, CryptoKey>()
let sync: BroadcastChannel | null = null
let socket: WebSocket | null = null
let relayUrl = ''
let relayGeneration = 0
let relayState: RelayState = 'off'
let simulateReplies = false
let started = false

const statusListeners = new Set<() => void>()
const messageListeners = new Set<(frame: CipherFrame) => void>()
const deleteListeners = new Set<(id: string) => void>()
const seen = new Set<string>()

function notify(): void {
  statusListeners.forEach((listener) => listener())
}

function setRelayState(next: RelayState): void {
  relayState = next
}

function remember(key: string): boolean {
  if (seen.has(key)) return false
  seen.add(key)
  if (seen.size > 512) {
    const oldest = seen.values().next().value
    if (oldest !== undefined) seen.delete(oldest)
  }
  return true
}

function emit(frame: SyncFrame): void {
  sync?.postMessage(frame)
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(frame))
  }
}

async function announce(): Promise<void> {
  if (!identity) return
  const frame: HelloFrame = {
    type: 'hello',
    senderId,
    publicKey: identity.publicJwk,
  }
  emit(frame)
}

async function handleHello(frame: HelloFrame): Promise<void> {
  if (!identity || frame.senderId === senderId) return
  if (peers.has(frame.senderId)) return
  try {
    const publicKey = await importPublicKey(frame.publicKey)
    const sharedKey = await deriveSharedKey(identity.privateKey, publicKey)
    peers.set(frame.senderId, sharedKey)
    notify()
    await announce()
  } catch {
    return
  }
}

function handleFrame(frame: SyncFrame): void {
  if (!frame || typeof frame !== 'object') return

  if ('type' in frame) {
    if (frame.type === 'hello') {
      if (frame.senderId !== senderId) void handleHello(frame)
      return
    }
    if (
      frame.type === 'delete' &&
      frame.senderId !== senderId &&
      remember(`delete:${frame.messageId}`)
    ) {
      deleteListeners.forEach((listener) => listener(frame.messageId))
    }
    return
  }

  if (frame.senderId === senderId) return
  const key = `${frame.senderId}:${frame.timestamp}:${frame.iv}`
  if (!remember(key)) return
  messageListeners.forEach((listener) => listener(frame))
}

export async function startChannel(): Promise<void> {
  if (started) return
  started = true
  senderId = randomId()
  identity = await createIdentity()
  selfKey = await deriveSharedKey(identity.privateKey, identity.publicKey)
  sync = new BroadcastChannel(SYNC_NAME)
  sync.onmessage = (event: MessageEvent<SyncFrame>) => handleFrame(event.data)
  window.addEventListener('beforeunload', stopChannel)
  await announce()
  notify()
}

export function stopChannel(): void {
  if (!started) return
  started = false
  window.removeEventListener('beforeunload', stopChannel)
  sync?.close()
  sync = null
  socket?.close()
  socket = null
  peers = new Map()
  identity = null
  selfKey = null
  relayUrl = ''
  relayGeneration += 1
  relayState = 'off'
  notify()
}

export function subscribeChannel(listener: () => void): () => void {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

export function subscribeMessages(
  listener: (frame: CipherFrame) => void,
): () => void {
  messageListeners.add(listener)
  return () => messageListeners.delete(listener)
}

export function subscribeDeletes(listener: (id: string) => void): () => void {
  deleteListeners.add(listener)
  return () => deleteListeners.delete(listener)
}

export function getChannelStatus(): ChannelStatus {
  return {
    senderId,
    peerCount: peers.size,
    relayState,
    simulateReplies,
  }
}

export function getSessionKey(): CryptoKey | null {
  const first = peers.values().next().value
  return first ?? selfKey
}

export function getDecryptKeys(): CryptoKey[] {
  const keys = [...peers.values()]
  if (selfKey) keys.push(selfKey)
  return keys
}

export function hasPeers(): boolean {
  return peers.size > 0
}

export function shouldSimulateReplies(): boolean {
  return simulateReplies && peers.size === 0
}

export function setSimulateReplies(next: boolean): void {
  simulateReplies = next
  notify()
}

export function isCipherFrame(frame: SyncFrame): frame is CipherFrame {
  return !('type' in frame)
}

export function sendFrame(frame: SyncFrame): void {
  if (isCipherFrame(frame) && frame.senderId !== senderId) {
    remember(`${frame.senderId}:${frame.timestamp}:${frame.iv}`)
  }
  emit(frame)
}

export function sendDelete(messageId: string, threadId: string): void {
  const frame: DeleteFrame = {
    type: 'delete',
    senderId,
    threadId,
    messageId,
  }
  emit(frame)
}

export function connectRelay(url: string): void {
  const target = url.trim()
  disconnectRelay()
  if (!target) return

  const generation = relayGeneration
  relayUrl = target
  setRelayState('connecting')
  notify()

  try {
    const next = new WebSocket(target)
    socket = next
    next.onopen = () => {
      if (generation !== relayGeneration) return
      setRelayState('open')
      void announce()
      notify()
    }
    next.onmessage = (event: MessageEvent<string>) => {
      if (generation !== relayGeneration) return
      try {
        handleFrame(JSON.parse(event.data) as SyncFrame)
      } catch {
        return
      }
    }
    next.onerror = () => {
      if (generation !== relayGeneration) return
      setRelayState('error')
      notify()
    }
    next.onclose = () => {
      if (generation !== relayGeneration) return
      socket = null
      setRelayState('error')
      notify()
    }
  } catch {
    setRelayState('error')
    notify()
  }
}

export function disconnectRelay(): void {
  relayGeneration += 1
  relayUrl = ''
  const current = socket
  socket = null
  if (current && current.readyState < WebSocket.CLOSING) current.close()
  setRelayState('off')
  notify()
}

export function getRelayUrl(): string {
  return relayUrl
}
