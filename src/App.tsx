import { useEffect, useRef, useState } from 'react'
import { Lock, Phone } from 'lucide-react'
import CallScreens from './components/CallScreens'
import ConnectionPill from './components/ConnectionPill'
import MediaPicker from './components/MediaPicker'
import { ProfileModal, SecurityModal } from './components/Modals'
import Onboarding from './screens/Onboarding'
import EmptyChat from './screens/EmptyChat'
import AddUser from './screens/AddUser'
import Settings from './screens/Settings'
import { useSettings } from './hooks/useSettings'
import { parseDeepLink } from './deepLink'
import { useTouchBounce } from './hooks/useTouchBounce'
import { useInstallPrompt } from './hooks/useInstallPrompt'
import {
  createIdentity,
  decryptText,
  deriveSharedKey,
  encryptText,
  importPublicKey,
  randomId,
  type EncryptedPayload,
  type Identity,
} from './crypto/e2ee'
import { currentInvite, inviteUrl, relayUrl, rotateInvite } from './net/invite'
import type { Invite } from './net/invite'
import {
  connectRelay,
  disconnectRelay,
  getChannelStatus,
  startChannel,
  subscribeChannel,
} from './transport/channel'
import type { ChannelStatus } from './transport/channel'
import { startMessageSocket } from './transport/messageSocket'
import { advanceCursor, type Cursor } from './transport/reliability'
import {
  clearChatStorage,
  formatTime,
  isRealThreadName,
  loadChatBackup,
  loadOutbox,
  loadThreads,
  mergeChatMessages,
  normalizeUsername,
  removeOutbox,
  saveChatBackup,
  saveThreads,
  setChatStorageUser,
  subscribeStore,
  updateOutboxStatus,
  upsertOutbox,
} from './store/messages'
import type { OutboxMessage, Thread } from './store/messages'
import {
  apiUrl,
  authHeaders,
  authenticatedWs,
  connectSignals,
  getSignalToken,
  type CallKind,
  type SignalEvent,
} from './api/client'
import { callManager, type CallSnapshot } from './webrtc/callManager'
import type {
  AccountUser,
  ChatMessage,
  ConnectionStatus,
  DeviceSession,
  GifResult,
  ProfilePatch,
} from './types'

type WireMessage = {
  id: string
  chatId: string
  sender: string
  text: string
  time: string
}

const fallbackUsername = 'sukar3tto'
let ownUsername = localStorage.getItem('honden.username') ?? fallbackUsername
setChatStorageUser(
  localStorage.getItem('honden.username') && getSignalToken() ? ownUsername : null,
)
const localPeople = [
  { name: 'You', username: ownUsername },
  { name: 'Someone', username: 'someone' },
]

const ecdh = { name: 'ECDH', namedCurve: 'P-256' } as const
const unreadableMessage = "This message couldn't be read on this device."
const globalThreadId = '#honey-den'
const globalThread: Thread = {
  id: globalThreadId,
  name: globalThreadId,
  username: 'everyone',
  createdAt: 0,
}
const globalNotice = 'Global chat — everyone in HonDen can see this, not private.'
const blockedGlobalKey = 'honden.global.blocked'

function loadBlockedGlobalSenders(): string[] {
  try {
    const raw = localStorage.getItem(blockedGlobalKey)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function saveBlockedGlobalSenders(senders: string[]): void {
  localStorage.setItem(blockedGlobalKey, JSON.stringify(senders))
}

function parseEncrypted(text: string): EncryptedPayload | null {
  try {
    const value = JSON.parse(text) as Partial<EncryptedPayload>
    if (typeof value.iv === 'string' && typeof value.ciphertext === 'string') {
      return value as EncryptedPayload
    }
  } catch {
    return null
  }
  return null
}

function looksEncrypted(text: string): boolean {
  return parseEncrypted(text) !== null || /^\s*\{[\s\S]*"iv"\s*:[\s\S]*"ciphertext"\s*:/.test(text)
}

async function sharedKey(identity: Identity, username: string): Promise<CryptoKey | null> {
  try {
    const response = await fetch(apiUrl(`/api/users/${encodeURIComponent(username)}`))
    if (!response.ok) return null
    const data = (await response.json()) as { publicKey?: JsonWebKey; publicJwk?: JsonWebKey }
    const publicJwk = data.publicKey ?? data.publicJwk
    if (!publicJwk) return null
    const publicKey = await importPublicKey(publicJwk)
    return await deriveSharedKey(identity.privateKey, publicKey)
  } catch {
    return null
  }
}

async function decryptWireText(
  text: string,
  identity: Identity | null,
  sender: string,
  chatId: string,
): Promise<string> {
  if (!looksEncrypted(text)) return text
  const payload = parseEncrypted(text)
  if (!payload || !identity) return unreadableMessage
  const key = await sharedKey(identity, sender === ownUsername ? chatId : sender)
  if (!key) return unreadableMessage
  console.log('Decrypting with local private key', ownUsername)
  try {
    return await decryptText(payload, key)
  } catch {
    return unreadableMessage
  }
}

async function toChatMessage(message: WireMessage, identity: Identity | null): Promise<ChatMessage> {
  const timestamp = new Date(message.time).getTime()
  const sender = normalizeUsername(message.sender)
  const text = await decryptWireText(message.text, identity, sender, message.chatId)
  const threadId =
    message.chatId === globalThreadId ? globalThreadId : sender === ownUsername ? message.chatId : sender
  return {
    id: message.id,
    threadId,
    senderId: `@${sender}`,
    from: sender === ownUsername ? 'me' : 'them',
    time: formatTime(timestamp),
    timestamp,
    text,
  }
}

async function loadChatsFromServer(): Promise<Thread[]> {
  const response = await fetch(apiUrl('/api/chats'), { headers: authHeaders() })
  if (!response.ok) throw new Error('chat load failed')
  const data = (await response.json()) as { username?: unknown; createdAt?: unknown }[]
  if (!Array.isArray(data)) return []
  return data
    .filter(
      (item): item is { username: string; createdAt: number } =>
        typeof item?.username === 'string' && isRealThreadName(item.username),
    )
    .map((item) => ({
      id: item.username,
      name: item.username,
      username: item.username,
      createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
    }))
}

async function lookupAccount(username: string): Promise<string | null> {
  try {
    const response = await fetch(apiUrl(`/api/users/${encodeURIComponent(username)}`))
    if (!response.ok) return null
    const data = (await response.json()) as { username?: unknown }
    return typeof data.username === 'string' ? normalizeUsername(data.username) || null : null
  } catch {
    return null
  }
}

function outboxToChatMessage(item: OutboxMessage): ChatMessage {
  const timestamp = new Date(item.time).getTime()
  return {
    id: item.id,
    threadId: item.threadId,
    senderId: `@${item.sender}`,
    from: 'me',
    time: formatTime(timestamp),
    timestamp,
    text: item.plain,
    kind: item.kind ?? 'text',
    gifUrl: item.gifUrl,
    status: item.status,
  }
}

async function loadIdentity(username: string): Promise<Identity> {
  const key = `honden.identity.${username}`
  const raw = localStorage.getItem(key)
  if (raw) {
    try {
      const saved = JSON.parse(raw) as { privateJwk: JsonWebKey; publicJwk: JsonWebKey }
      const privateKey = await crypto.subtle.importKey(
        'jwk',
        saved.privateJwk,
        ecdh,
        true,
        ['deriveBits'],
      )
      const publicKey = await importPublicKey(saved.publicJwk)
      console.log('Key loaded', username)
      return { privateKey, publicKey, publicJwk: saved.publicJwk }
    } catch {}
  }
  const identity = await createIdentity()
  const privateJwk = await crypto.subtle.exportKey('jwk', identity.privateKey)
  localStorage.setItem(key, JSON.stringify({ privateJwk, publicJwk: identity.publicJwk }))
  console.log('Key created', username)
  return identity
}

async function publishKey(username: string, identity: Identity) {
  try {
    const response = await fetch(apiUrl('/api/public-key'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ username, publicJwk: identity.publicJwk }),
    })
    if (!response.ok) {
      console.error('Public key upload failed', username, response.status)
      return
    }
    console.log('Public key uploaded', username)
  } catch (error) {
    console.error('Public key upload failed', username, error)
  }
}

const defaultUser: AccountUser = {
  id: 'local-user',
  username: ownUsername,
  email: '',
  displayName: 'You',
  bio: '',
  status: 'online',
  avatarColor: '#FF6B9D',
  avatarUrl: null,
  createdAt: new Date(0).toISOString(),
}

function loadAccount(): AccountUser {
  try {
    const raw = localStorage.getItem('honden.user')
    if (raw) return { ...defaultUser, ...(JSON.parse(raw) as Partial<AccountUser>) }
  } catch {
    return defaultUser
  }
  return defaultUser
}

function loadDevices(): DeviceSession[] {
  try {
    const raw = localStorage.getItem('honden.devices')
    if (raw) return JSON.parse(raw) as DeviceSession[]
  } catch {
    return []
  }
  const now = new Date().toISOString()
  return [
    {
      id: '11111111-1111-4111-8111-111111111111',
      deviceId: 'web-local-session',
      platform: 'This browser',
      lastSeen: now,
      createdAt: now,
    },
  ]
}

function UserChip({
  user,
  onProfile,
  onSecurity,
}: {
  user: AccountUser
  onProfile: () => void
  onSecurity: () => void
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onProfile}
        aria-label="Edit profile"
        className="relative h-9 w-9 rounded-xl border border-border text-xs font-bold text-warm-charcoal"
        style={{ backgroundColor: user.avatarColor }}
      >
        {user.displayName.slice(0, 2).toUpperCase()}
        <span
          className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-white ${
            user.status === 'online'
              ? 'bg-leaf-green'
              : user.status === 'dnd'
                ? 'bg-warm-amber'
                : 'bg-soft-grey'
          }`}
        />
      </button>
      <button
        type="button"
        onClick={onSecurity}
        aria-label="Security and sessions"
        className="h-9 w-9 rounded-xl border border-border bg-white text-warm-charcoal transition hover:bg-warm-cream"
      >
        ⚙
      </button>
    </div>
  )
}

type Screen = 'onboarding' | 'chats' | 'chat' | 'settings' | 'addUser' | 'invite'

const inviteToken =
  typeof window !== 'undefined'
    ? /^\/join\/([^/]+)\/?$/.exec(window.location.pathname)?.[1]
    : undefined
const deepLink = parseDeepLink(typeof window === 'undefined' ? '' : window.location.search)

export default function App() {
  const [screen, setScreen] = useState<Screen>(() => {
    if (inviteToken) return 'invite'
    return localStorage.getItem('honden.username') && getSignalToken() ? 'chats' : 'onboarding'
  })
  const { settings, update } = useSettings()
  const [threads, setThreads] = useState<Thread[]>(loadThreads)
  const [messages, setMessages] = useState<ChatMessage[]>(loadChatBackup)
  const [blockedGlobalSenders, setBlockedGlobalSenders] = useState<string[]>(loadBlockedGlobalSenders)
  const [invite, setInvite] = useState<Invite>(currentInvite)
  const [activeThreadId, setActiveThreadId] = useState('')
  const [status, setStatus] = useState<ChannelStatus>(getChannelStatus)
  const [connection, setConnection] = useState<ConnectionStatus>('connecting')
  const [call, setCall] = useState<CallSnapshot>(() => callManager.snapshot())
  const [draft, setDraft] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const composerRef = useRef<HTMLInputElement>(null)
  const flushingOutbox = useRef(false)
  const syncCursorRef = useRef<Cursor | null>(null)
  const syncAllRef = useRef<() => Promise<void>>(async () => undefined)
  const deepLinkHandled = useRef(false)
  const [user, setUser] = useState<AccountUser>(loadAccount)
  const [username, setUsername] = useState(ownUsername)
  const [identity, setIdentity] = useState<Identity | null>(null)
  const identityRef = useRef<Identity | null>(null)
  const [devices, setDevices] = useState<DeviceSession[]>(loadDevices)
  const [modal, setModal] = useState<'profile' | 'security' | null>(null)
  const [offline, setOffline] = useState(false)
  const [notice, setNotice] = useState('')
  const offlineTimer = useRef<number | undefined>(undefined)
  const authToken = getSignalToken()
  const [longPressedId, setLongPressedId] = useState('')
  const longPressTimer = useRef<number | undefined>(undefined)
  const longPressClearTimer = useRef<number | undefined>(undefined)
  const messageBounce = useTouchBounce()
  const installPrompt = useInstallPrompt()

  function scheduleOffline() {
    if (offlineTimer.current !== undefined) return
    offlineTimer.current = window.setTimeout(() => {
      offlineTimer.current = undefined
      setOffline(true)
    }, 3000)
  }

  function clearOffline() {
    if (offlineTimer.current !== undefined) {
      window.clearTimeout(offlineTimer.current)
      offlineTimer.current = undefined
    }
    setOffline(false)
  }

  useEffect(() => {
    const node = messageBounce.ref.current
    if (node) node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' })
  }, [messages.length, activeThreadId, messageBounce.ref])

  useEffect(() => {
    void startChannel().then(() => setStatus(getChannelStatus()))
  }, [])

  useEffect(() => {
    if (!authToken) return
    let active = true
    void loadIdentity(username)
      .then(async (loaded) => {
        if (!active) return
        setIdentity(loaded)
        await publishKey(username, loaded)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [authToken, username])

  useEffect(() => {
    localStorage.setItem('honden.user', JSON.stringify(user))
  }, [user])

  useEffect(() => {
    localStorage.setItem('honden.devices', JSON.stringify(devices))
  }, [devices])

  useEffect(() => {
    identityRef.current = identity
  }, [identity])

  useEffect(() => {
    saveChatBackup(messages)
  }, [messages])

  useEffect(() => {
    const queued = loadOutbox().map(outboxToChatMessage)
    if (queued.length > 0) setMessages((current) => mergeChatMessages(current, queued))
    void flushOutbox()
  }, [])

  useEffect(() => {
    const goOnline = () => {
      clearOffline()
      setConnection('connecting')
      void flushOutbox()
    }
    const goOffline = () => {
      scheduleOffline()
      setConnection('disconnected')
    }
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
    window.removeEventListener('online', goOnline)
    window.removeEventListener('offline', goOffline)
      if (offlineTimer.current !== undefined) window.clearTimeout(offlineTimer.current)
    }
  }, [])

  useEffect(() => {
    void fetch(apiUrl('/health'))
      .then((response) => {
        if (response.ok) clearOffline()
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => subscribeChannel(() => setStatus(getChannelStatus())), [])

  useEffect(() => subscribeStore(() => setThreads(loadThreads())), [])

  useEffect(() => {
    if (!authToken) return
    let active = true
    setChatStorageUser(username)
    syncCursorRef.current = null
    setThreads([])
    setMessages([])
    setActiveThreadId('')
    setBlockedGlobalSenders([])
    void loadChatsFromServer()
      .then((chats) => {
        if (!active) return
        saveThreads(chats)
        setThreads(chats)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [authToken, username])

  useEffect(() => {
    if (!authToken || deepLinkHandled.current) return
    const target = deepLink.chatId || deepLink.callFrom
    if (!target) return
    deepLinkHandled.current = true
    if (threads.some((thread) => thread.id === target)) {
      openThread(target)
    } else {
      void addByUsername(target).then((added) => {
        if (added) openThread(target)
      })
    }
    if (deepLink.callFrom && deepLink.callId) {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'honden:call-action',
            action: 'accept',
            callId: deepLink.callId,
            sender: deepLink.callFrom,
            senderName: deepLink.callFrom,
            kind: deepLink.callKind ?? 'voice',
          },
        }),
      )
    }
  }, [authToken, threads])

  useEffect(() => {
    syncAllRef.current = syncAll
  }, [authToken, identity])

  useEffect(() => {
    if (!authToken) return
    const controller = startMessageSocket(authenticatedWs('/ws'), {
      onStatus: (next) => {
        setConnection(next)
        if (next === 'live') void flushOutbox()
      },
      onSync: () => syncAllRef.current(),
      onFrame: (frame) => {
        if (frame.type === 'message' && frame.message) {
          const wire = frame.message as WireMessage
          if (wire.id && wire.time) {
            syncCursorRef.current = advanceCursor(syncCursorRef.current, {
              time: wire.time,
              id: wire.id,
            })
          }
          void toChatMessage(wire, identityRef.current).then((chat) => {
            setMessages((current) => mergeChatMessages(current, [chat]))
          })
        }
        if (frame.type === 'delete' && frame.id) {
          setMessages((current) => current.filter((item) => item.id !== frame.id))
        }
      },
    })
    return () => controller.close()
  }, [authToken, identity])

  useEffect(() => {
    const unsubscribe = callManager.subscribe(setCall)
    const signal = connectSignals((event: SignalEvent) => {
      switch (event.type) {
        case 'call:invite':
          callManager.handleInvite(event)
          break
        case 'call:accept':
          void callManager.handleAccept(event)
          break
        case 'call:reject':
          callManager.handleHangup(event)
          break
        case 'call:offer':
          void callManager.handleOffer(event)
          break
        case 'call:answer':
          void callManager.handleAnswer(event)
          break
        case 'call:ice':
          void callManager.handleIce(event)
          break
        case 'call:hangup':
          callManager.handleHangup(event)
          break
        default:
          break
      }
    })
    callManager.setSignalingSender((event) =>
      signal.send({ ...event, peerName: `@${ownUsername}` }),
    )

    return () => {
      unsubscribe()
      signal.close()
      callManager.dispose()
    }
  }, [])

  const activeRelayUrl = relayUrl(invite, settings.relayUrl)

  useEffect(() => {
    connectRelay(activeRelayUrl)
    return () => disconnectRelay()
  }, [activeRelayUrl])

  async function encryptedWireText(item: OutboxMessage): Promise<string> {
    if (item.threadId === globalThreadId) return item.text
    if (item.text !== item.plain) return item.text
    const current = identityRef.current ?? (await loadIdentity(item.sender).catch(() => null))
    if (!current) return item.text
    identityRef.current = current
    const key = await sharedKey(current, item.threadId)
    if (!key) return item.text
    console.log('Encrypting for receiver', item.threadId)
    return JSON.stringify(await encryptText(item.plain, key))
  }

  async function syncAll() {
    const collected: WireMessage[] = []
    let cursor = syncCursorRef.current ?? undefined
    for (;;) {
      const params = new URLSearchParams({ chatId: '*', limit: '200' })
      if (cursor) {
        params.set('afterTime', cursor.time)
        params.set('afterId', cursor.id)
      }
      const response = await fetch(apiUrl(`/api/messages?${params.toString()}`), {
        headers: authHeaders(),
      })
      if (!response.ok) throw new Error(`sync failed: ${response.status}`)
      const items = (await response.json()) as WireMessage[]
      if (!Array.isArray(items)) throw new Error('sync returned invalid data')
      collected.push(...items)
      const last = items[items.length - 1]
      if (last) cursor = { time: last.time, id: last.id }
      if (items.length < 200) break
    }
    const decrypted = await Promise.all(
      collected.map((item) => toChatMessage(item, identityRef.current)),
    )
    setMessages((current) => mergeChatMessages(current, decrypted))
    if (cursor) syncCursorRef.current = cursor
    clearOffline()
  }

  async function deliverMessage(queued: OutboxMessage): Promise<boolean> {
    let item = queued
    const text = await encryptedWireText(item)
    if (text !== item.text) {
      item = { ...item, text }
      upsertOutbox(item)
    }
    try {
      const response = await fetch(apiUrl('/api/messages'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          id: item.id,
          chatId: item.threadId,
          sender: item.sender,
          text: item.text,
          time: item.time,
        }),
      })
      if (!response.ok) {
        console.error('POST /api/messages failed', response.status)
        updateOutboxStatus(item.id, 'failed')
        setMessages((current) =>
          current.map((message) =>
            message.id === item.id ? { ...message, status: 'failed' } : message,
          ),
        )
        scheduleOffline()
        return false
      }
      removeOutbox(item.id)
      setMessages((current) =>
        current.map((message) =>
          message.id === item.id ? { ...message, status: 'sent' } : message,
        ),
      )
      clearOffline()
      return true
    } catch (error) {
      console.error('POST /api/messages error', error)
      updateOutboxStatus(item.id, 'failed')
      setMessages((current) =>
        current.map((message) =>
          message.id === item.id ? { ...message, status: 'failed' } : message,
        ),
      )
      scheduleOffline()
      return false
    }
  }

  async function flushOutbox() {
    if (flushingOutbox.current) return
    flushingOutbox.current = true
    try {
      const items = loadOutbox().filter((item) => item.status === 'sending')
      for (const item of items) await deliverMessage(item)
    } finally {
      flushingOutbox.current = false
    }
  }

  async function retryMessage(id: string) {
    const item = loadOutbox().find((entry) => entry.id === id)
    if (!item) return
    updateOutboxStatus(id, 'sending')
    setMessages((current) =>
      current.map((message) => (message.id === id ? { ...message, status: 'sending' } : message)),
    )
    await deliverMessage({ ...item, status: 'sending' })
  }

  async function sendMessage(threadId: string, text: string, gifUrl?: string) {
    const plain = (gifUrl ?? text).trim()
    if (!plain) return
    const id = randomId()
    const time = new Date().toISOString()
    const item: OutboxMessage = {
      id,
      threadId,
      sender: ownUsername,
      text: plain,
      plain,
      time,
      status: 'sending',
      kind: gifUrl ? 'gif' : 'text',
      gifUrl,
    }
    upsertOutbox(item)
    setMessages((current) => mergeChatMessages(current, [outboxToChatMessage(item)]))
    await deliverMessage(item)
  }

  async function deleteMessage(id: string) {
    removeOutbox(id)
    setMessages((current) => current.filter((item) => item.id !== id))
    try {
      await fetch(apiUrl(`/api/messages/${encodeURIComponent(id)}`), {
        method: 'DELETE',
        headers: authHeaders(),
      })
    } catch {
      return
    }
  }

  async function finishLogin(name: string, loginNotice?: string, token?: string) {
    clearChatStorage()
    setChatStorageUser(name)
    setThreads([])
    setMessages([])
    setActiveThreadId('')
    setBlockedGlobalSenders([])
    const loaded = await loadIdentity(name).catch(() => null)
    if (loaded) {
      setIdentity(loaded)
      await publishKey(name, loaded)
    }
    if (token) localStorage.setItem('honden.token', token)
    syncCursorRef.current = null
    ownUsername = name
    setUsername(name)
    setNotice(loginNotice ?? '')
    localStorage.setItem('honden.username', name)
    setUser((current) => ({ ...current, id: name, username: name, displayName: 'You' }))
    setScreen('chats')
  }

  function beginLongPress(id: string) {
    if (longPressTimer.current !== undefined) window.clearTimeout(longPressTimer.current)
    longPressTimer.current = window.setTimeout(() => {
      setLongPressedId(id)
      if (longPressClearTimer.current !== undefined) window.clearTimeout(longPressClearTimer.current)
      longPressClearTimer.current = window.setTimeout(() => setLongPressedId(''), 2200)
    }, 500)
  }

  function cancelLongPress() {
    if (longPressTimer.current !== undefined) window.clearTimeout(longPressTimer.current)
  }

  function copyMessage(text: string) {
    if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(text)
    setLongPressedId('')
  }

  function openThread(id: string) {
    setActiveThreadId(id)
    setScreen('chat')
  }

  async function addByUsername(raw: string, allowSelf = false): Promise<boolean> {
    const username = normalizeUsername(raw)
    if (!username || (!allowSelf && username === ownUsername)) return false
    const local = localPeople.find((item) => item.username === username)
    const account = local || allowSelf ? null : await lookupAccount(username)
    if (!local && !account && !allowSelf) return false
    const person = local ?? { name: account ?? username, username }
    const existing = loadThreads()
    if (!existing.some((thread) => thread.id === username)) {
      saveThreads([
        ...existing,
        { id: username, name: person.name, username, createdAt: Date.now() },
      ])
      setThreads(loadThreads())
    }
    return true
  }

  async function newThread(name: string) {
    const username = normalizeUsername(name)
    if (await addByUsername(username)) {
      setActiveThreadId(username)
      setScreen('chat')
    }
  }

  function acceptInvite() {
    void addByUsername(ownUsername, true)
    setScreen('chats')
  }

  function newInvite() {
    const next = rotateInvite()
    setInvite(next)
  }

  function callPeerName(threadId: string) {
    return `@${threads.find((item) => item.id === threadId)?.username ?? threadId}`
  }

  function startCall(kind: CallKind) {
    void callManager.startOutgoing(activeThreadId, kind, callPeerName(activeThreadId))
  }

  function insertEmoji(emoji: string) {
    const node = composerRef.current
    const start = node?.selectionStart ?? draft.length
    const end = node?.selectionEnd ?? draft.length
    const next = `${draft.slice(0, start)}${emoji}${draft.slice(end)}`
    setDraft(next)
    window.setTimeout(() => {
      node?.focus()
      node?.setSelectionRange(start + emoji.length, start + emoji.length)
    }, 0)
  }

  function mentionUser(username: string) {
    setDraft((current) => current.replace(/(^|\s)@([a-z0-9_]*)$/, `$1@${username} `))
    composerRef.current?.focus()
  }

  function sendGif(gif: GifResult, chatId = activeThreadId) {
    void sendMessage(chatId, '', gif.url)
    setPickerOpen(false)
  }

  function submitDraft(chatId = activeThreadId) {
    const value = draft.trim()
    if (!value) return
    void sendMessage(chatId, value)
    setDraft('')
  }

  async function saveProfile(patch: ProfilePatch) {
    setUser((current) => ({ ...current, ...patch }))
    const token = getSignalToken()
    if (!token) return
    try {
      await fetch(apiUrl(`/api/auth/profile`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(patch),
      })
    } catch {
      return
    }
  }

  async function revokeDevice(id: string) {
    setDevices((current) => current.filter((device) => device.id !== id))
    const token = getSignalToken()
    if (!token) return
    try {
      await fetch(apiUrl(`/api/auth/devices/${id}`), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
    } catch {
      return
    }
  }

  function signOut() {
    clearChatStorage()
    setChatStorageUser(null)
    setThreads([])
    setMessages([])
    setActiveThreadId('')
    setBlockedGlobalSenders([])
    localStorage.removeItem('honden.token')
    localStorage.removeItem('honden.auth')
    localStorage.removeItem('honden.auth_token')
    localStorage.removeItem('token')
    localStorage.removeItem('honden.username')
    localStorage.removeItem('honden.user')
    syncCursorRef.current = null
    ownUsername = fallbackUsername
    setUsername(fallbackUsername)
    setUser({ ...defaultUser, id: fallbackUsername, username: fallbackUsername, displayName: 'You' })
    setIdentity(null)
    setNotice('')
    setModal(null)
    setScreen('onboarding')
  }

  async function blockContact(contactId: string) {
    const token = getSignalToken()
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      contactId,
    )
    if (token && isUuid) {
      try {
        await fetch(apiUrl(`/api/contacts/${contactId}`), {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ status: 'blocked' }),
        })
      } catch {
        return
      }
    }
    setThreads((current) => current.filter((thread) => thread.id !== contactId))
    if (activeThreadId === contactId) setScreen('chats')
  }

  function blockGlobalSender(senderId: string) {
    const sender = normalizeUsername(senderId)
    if (!sender || blockedGlobalSenders.includes(sender)) return
    const next = [...blockedGlobalSenders, sender]
    setBlockedGlobalSenders(next)
    saveBlockedGlobalSenders(next)
    setNotice(`Messages from @${sender} are hidden in #honey-den.`)
  }

  async function reportGlobalMessage(message: ChatMessage) {
    try {
      const response = await fetch(apiUrl('/api/global/report'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageId: message.id,
          reporter: ownUsername,
          sender: normalizeUsername(message.senderId),
        }),
      })
      setNotice(response.ok ? 'Thanks — we’ll take a look.' : 'Thanks — we’ll take a look.')
    } catch {
      setNotice('Thanks — we’ll take a look.')
    }
  }

  let screenView = (
    <Onboarding onDone={(name, loginNotice, token) => void finishLogin(name, loginNotice, token)} />
  )

  if (screen === 'invite') {
    screenView = (
      <Onboarding
        invite
        onDone={(name, loginNotice, token) => {
          void (async () => {
            await finishLogin(name, loginNotice, token)
            acceptInvite()
          })()
        }}
      />
    )
  } else if (screen === 'addUser') {
    screenView = <AddUser onAdd={addByUsername} onBack={() => setScreen('chats')} />
  } else if (screen === 'settings') {
    screenView = (
      <Settings
        settings={settings}
        update={update}
        onBack={() => setScreen('chats')}
        relayState={status.relayState}
        peerCount={status.peerCount}
        inviteLink={inviteUrl(invite)}
        onNewInvite={newInvite}
        installPrompt={installPrompt}
        onLogout={signOut}
      />
    )
  } else if (screen === 'chat') {
    const thread =
      activeThreadId === globalThreadId
        ? globalThread
        : threads.find((item) => item.id === activeThreadId) ?? threads[0]
    const threadId = thread?.id ?? activeThreadId
    const isGlobal = threadId === globalThreadId
    const visible = messages
      .filter((message) => message.threadId === threadId)
      .filter(
        (message) =>
          !isGlobal || !blockedGlobalSenders.includes(normalizeUsername(message.senderId)),
      )
    const mentionMatch = /(^|\s)@([a-z0-9_]*)$/.exec(draft)
    const mentionCandidates = mentionMatch
      ? localPeople.filter((person) => person.username.startsWith(mentionMatch[2]))
      : []

    screenView = (
      <div className="flex h-[100dvh] w-full overflow-hidden bg-warm-cream text-warm-charcoal">
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex shrink-0 items-center gap-3 border-b border-border bg-white px-4 py-3">
            <button
              type="button"
              onClick={() => setScreen('chats')}
              aria-label="Back to chats"
              className="flex h-12 w-12 items-center justify-center rounded-xl text-warm-charcoal transition hover:bg-warm-cream md:h-11 md:w-11"
            >
              ←
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-warm-charcoal">
                {thread?.name ?? 'Someone'}
              </p>
              {isGlobal ? (
                <p className="text-[13px] text-soft-grey">A shared channel for everyone in HonDen.</p>
              ) : (
                <>
                  <p className="text-[13px] text-soft-grey">@{thread?.username ?? 'someone'}</p>
                  <p className="flex items-center gap-1 text-[12px] text-soft-grey">
                    <Lock size={10} className="text-heart-pink" aria-hidden="true" />
                    Only you and @{thread?.username ?? 'someone'} can read this.
                  </p>
                </>
              )}
            </div>
            <ConnectionPill status={connection} />
            <UserChip
              user={user}
              onProfile={() => setModal('profile')}
              onSecurity={() => setModal('security')}
            />
            {!isGlobal && (
              <button
                type="button"
                onClick={() => startCall('video')}
                aria-label={`Call @${thread?.username ?? 'someone'}`}
                className="flex min-h-12 items-center gap-2 rounded-xl border border-heart-pink bg-white px-3 py-2 text-sm font-bold text-heart-pink transition hover:bg-soft-blush md:min-h-11"
              >
                <Phone size={16} className="text-heart-pink" />
                Call
              </button>
            )}
          </header>

          <div
            ref={messageBounce.ref}
            style={messageBounce.style}
            onTouchStart={messageBounce.onTouchStart}
            onTouchMove={messageBounce.onTouchMove}
            onTouchEnd={messageBounce.onTouchEnd}
            onTouchCancel={messageBounce.onTouchCancel}
            className="touch-scroll min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden bg-warm-cream p-4"
          >
            {isGlobal && (
              <p className="rounded-xl bg-warm-amber/20 px-3 py-2 text-center text-[13px] font-semibold text-warm-charcoal">
                {globalNotice}
              </p>
            )}
            {visible.length === 0 && (
              <div className="flex h-full items-center justify-center px-4">
                <p className="max-w-sm text-center text-[13px] text-soft-grey">
                  No messages yet. Say hello — they'll be glad to hear from you.
                </p>
              </div>
            )}
            {visible.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.from === 'me' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  onTouchStart={() => beginLongPress(message.id)}
                  onTouchEnd={cancelLongPress}
                  onTouchMove={cancelLongPress}
                  onTouchCancel={cancelLongPress}
                  className={`max-w-[78%] rounded-2xl border px-4 py-3 shadow-soft ${
                    longPressedId === message.id ? 'bubble-pressed' : ''
                  } ${
                    message.from === 'me'
                      ? 'border-border bg-soft-blush'
                      : 'border-border bg-white'
                  }`}
                >
                  <p className="mb-1 text-[13px] font-semibold text-soft-grey">
                    {message.senderId}
                  </p>
                  {message.deleted ? (
                    <p className="text-sm italic text-soft-grey">Message deleted</p>
                  ) : message.kind === 'gif' && message.gifUrl ? (
                    <img
                      src={message.gifUrl}
                      alt="GIF"
                      className="max-h-64 rounded-xl border border-border object-cover"
                    />
                  ) : (
                    <p className="whitespace-pre-wrap text-base text-warm-charcoal">
                      {message.text}
                    </p>
                  )}
                  <div className="mt-1 flex items-center justify-between gap-4 text-[13px] text-soft-grey">
                    <span>{message.time}</span>
                    {(!isGlobal || message.from === 'me') && (
                      <button
                        type="button"
                        onClick={() => deleteMessage(message.id)}
                        className="flex min-h-11 items-center px-2 text-soft-red transition hover:text-deep-rose md:min-h-11"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                  {message.status === 'sending' && (
                    <p className="mt-1 text-[13px] text-soft-grey">Sending...</p>
                  )}
                  {message.status === 'failed' && (
                    <button
                      type="button"
                      onClick={() => void retryMessage(message.id)}
                      className="mt-1 min-h-11 text-left text-[13px] text-soft-red underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heart-pink"
                    >
                      This message didn't send. Tap to try again.
                    </button>
                  )}
                  {longPressedId === message.id && (
                    <div className="mt-2 flex gap-2 border-t border-border pt-2">
                      <button
                        type="button"
                        onClick={() => copyMessage(message.text)}
                        className="min-h-11 flex-1 rounded-xl border border-border px-3 text-[13px] font-semibold text-warm-charcoal"
                      >
                        Copy
                      </button>
                      {(!isGlobal || message.from === 'me') && (
                        <button
                          type="button"
                          onClick={() => {
                            setLongPressedId('')
                            void deleteMessage(message.id)
                          }}
                          className="min-h-11 flex-1 rounded-xl border border-soft-red px-3 text-[13px] font-semibold text-soft-red"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  )}
                  {isGlobal && message.from === 'them' && (
                    <div className="mt-2 flex gap-2 border-t border-border pt-2">
                      <button
                        type="button"
                        onClick={() => void reportGlobalMessage(message)}
                        className="min-h-11 flex-1 rounded-xl border border-border px-3 text-[13px] font-semibold text-warm-charcoal"
                      >
                        Report
                      </button>
                      <button
                        type="button"
                        onClick={() => blockGlobalSender(message.senderId)}
                        className="min-h-11 flex-1 rounded-xl border border-soft-red px-3 text-[13px] font-semibold text-soft-red"
                      >
                        Block
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="relative z-20 shrink-0 border-t border-border bg-white p-4">
            {pickerOpen && (
              <MediaPicker
                onEmoji={insertEmoji}
                onGif={(gif) => sendGif(gif, threadId)}
                onClose={() => setPickerOpen(false)}
              />
            )}
            {mentionCandidates.length > 0 && (
              <div className="absolute bottom-full left-4 z-10 mb-2 w-56 rounded-2xl border border-border bg-white p-2 shadow-soft">
                {mentionCandidates.map((person) => (
                  <button
                    key={person.username}
                    type="button"
                    onClick={() => mentionUser(person.username)}
                    className="flex w-full flex-col rounded-xl px-3 py-2 text-left hover:bg-warm-cream"
                  >
                    <span className="text-sm font-semibold text-warm-charcoal">
                      {person.name}
                    </span>
                    <span className="text-[13px] text-soft-grey">@{person.username}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <input
                ref={composerRef}
                type="text"
                inputMode="text"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="sentences"
                enterKeyHint="send"
                aria-label="Message"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    submitDraft(threadId)
                  }
                }}
                placeholder="Message…"
                className="touch-auto min-h-12 flex-1 rounded-2xl border border-border bg-white px-3 py-2 text-base text-warm-charcoal outline-none placeholder:text-soft-grey focus:border-heart-pink"
              />
              <button
                type="button"
                onClick={() => setPickerOpen((open) => !open)}
                aria-label="Open emoji and GIF picker"
                className="h-12 w-12 rounded-2xl border border-border bg-white text-lg transition hover:bg-warm-cream"
              >
                ☺
              </button>
              <button
                type="button"
                onClick={() => submitDraft(threadId)}
                className="h-12 rounded-2xl bg-heart-pink px-5 text-base font-semibold text-white transition hover:bg-deep-rose"
              >
                Send
              </button>
            </div>
          </div>
        </div>
        <aside className="hidden w-[280px] shrink-0 border-l border-border bg-white p-4 lg:block">
          <div className="flex items-center gap-3">
            <div
              className="flex h-11 w-11 items-center justify-center rounded-xl text-sm font-bold text-warm-charcoal"
              style={{ backgroundColor: user.avatarColor }}
            >
              {user.displayName.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-warm-charcoal">
                {user.displayName}
              </p>
              <p className="truncate text-[13px] text-soft-grey">@{user.username}</p>
            </div>
          </div>
          <p className="mt-4 text-[13px] text-soft-grey">{user.status}</p>
          <p className="mt-1 text-sm leading-relaxed text-soft-grey">
            {user.bio || 'No bio set yet.'}
          </p>
          <div className="mt-6 space-y-2">
            <button
              type="button"
              onClick={() => setModal('profile')}
              className="w-full rounded-xl border border-border bg-white px-3 py-2 text-left text-sm text-warm-charcoal transition hover:bg-warm-cream"
            >
              Edit profile
            </button>
            <button
              type="button"
              onClick={() => setModal('security')}
              className="w-full rounded-xl border border-border bg-white px-3 py-2 text-left text-sm text-warm-charcoal transition hover:bg-warm-cream"
            >
              Sessions & security
            </button>
            <button
              type="button"
              onClick={() => void blockContact(threadId)}
              className="w-full rounded-xl border border-soft-red bg-white px-3 py-2 text-left text-sm text-soft-red transition hover:bg-soft-blush"
            >
              Block contact
            </button>
          </div>
        </aside>
      </div>
    )
  } else if (screen === 'chats') {
    const visibleThreads = settings.showGlobalChat ? [globalThread, ...threads] : threads
    screenView = (
      <div className="h-[100dvh] w-full overflow-hidden bg-warm-cream md:flex">
        <aside className="hidden w-[280px] shrink-0 flex-col items-center gap-3 border-r border-border bg-white py-4 md:flex lg:w-[300px]">
          <UserChip
            user={user}
            onProfile={() => setModal('profile')}
            onSecurity={() => setModal('security')}
          />
        </aside>
        <div className="min-w-0 w-full flex-1">
          <EmptyChat
            threads={visibleThreads}
            messages={messages}
            connection={connection}
            onOpenSettings={() => setScreen('settings')}
            onOpenThread={openThread}
            onNewThread={newThread}
            onAddUser={() => setScreen('addUser')}
          />
        </div>
      </div>
    )
  }

  return (
    <>
      {notice && !offline && (
        <div
          aria-live="polite"
          className="fixed inset-x-0 top-0 z-[59] bg-soft-blush px-4 py-2 text-center text-[13px] text-warm-charcoal shadow-soft"
        >
          {notice}{' '}
          <button
            type="button"
            onClick={() => setNotice('')}
            className="font-bold text-deep-rose underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heart-pink"
          >
            OK
          </button>
        </div>
      )}
      {offline && (
        <div className="fixed inset-x-0 top-0 z-[60] bg-soft-blush px-4 py-2 text-center text-[13px] text-warm-charcoal shadow-soft">
          You're offline right now. Your message will send when you're back.
        </div>
      )}
      {screenView}
      {modal === 'profile' && (
        <ProfileModal
          user={user}
          onClose={() => setModal(null)}
          onSave={saveProfile}
        />
      )}
      {modal === 'security' && (
        <SecurityModal
          devices={devices}
          onClose={() => setModal(null)}
          onRevoke={revokeDevice}
          onSignOut={signOut}
        />
      )}
      <CallScreens
        snapshot={call}
        onAccept={() => void callManager.accept()}
        onReject={() => callManager.reject()}
        onHangup={() => callManager.hangup()}
        onToggleMic={() => callManager.toggleMic()}
        onToggleCamera={() => callManager.toggleCamera()}
        onSwitchCamera={() => void callManager.switchCamera()}
      />
    </>
  )
}
