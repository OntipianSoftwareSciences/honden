import { useEffect, useRef, useState } from 'react'
import { Lock, Phone } from 'lucide-react'
import CallScreens from './components/CallScreens'
import MediaPicker from './components/MediaPicker'
import { ProfileModal, SecurityModal } from './components/Modals'
import Onboarding from './screens/Onboarding'
import EmptyChat from './screens/EmptyChat'
import AddUser from './screens/AddUser'
import Settings from './screens/Settings'
import { useSettings } from './hooks/useSettings'
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
import {
  formatTime,
  loadChatBackup,
  loadThreads,
  mergeChatMessages,
  normalizeUsername,
  saveChatBackup,
  saveThreads,
  subscribeStore,
} from './store/messages'
import type { Thread } from './store/messages'
import {
  connectSignals,
  getSignalToken,
  sameOriginWs,
  type CallKind,
  type SignalEvent,
} from './api/client'
import { callManager, type CallSnapshot } from './webrtc/callManager'
import type {
  AccountUser,
  ChatMessage,
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
const localPeople = [
  { name: 'You', username: ownUsername },
  { name: 'Alex', username: 'alex' },
  { name: 'Someone', username: 'someone' },
]

const wsBase = sameOriginWs('/ws')
const ecdh = { name: 'ECDH', namedCurve: 'P-256' } as const

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

async function sharedKey(identity: Identity, username: string): Promise<CryptoKey | null> {
  try {
    const response = await fetch(`/api/public-key?username=${encodeURIComponent(username)}`)
    if (!response.ok) return null
    const data = (await response.json()) as { publicJwk?: JsonWebKey }
    if (!data.publicJwk) return null
    const publicKey = await importPublicKey(data.publicJwk)
    return await deriveSharedKey(identity.privateKey, publicKey)
  } catch {
    return null
  }
}

async function decryptWireText(
  text: string,
  identity: Identity,
  sender: string,
  chatId: string,
): Promise<string> {
  const payload = parseEncrypted(text)
  if (!payload) return text
  const key = await sharedKey(identity, sender === ownUsername ? chatId : sender)
  if (!key) return text
  try {
    return await decryptText(payload, key)
  } catch {
    return text
  }
}

async function toChatMessage(message: WireMessage, identity: Identity | null): Promise<ChatMessage> {
  const timestamp = new Date(message.time).getTime()
  const sender = normalizeUsername(message.sender)
  const text = identity
    ? await decryptWireText(message.text, identity, sender, message.chatId)
    : message.text
  return {
    id: message.id,
    threadId: message.chatId,
    senderId: `@${sender}`,
    from: sender === ownUsername ? 'me' : 'them',
    time: formatTime(timestamp),
    timestamp,
    text,
  }
}

async function loadIdentity(username: string): Promise<Identity> {
  const key = `honden.identity.${username}`
  const raw = localStorage.getItem(key)
  if (raw) {
    const saved = JSON.parse(raw) as { privateJwk: JsonWebKey; publicJwk: JsonWebKey }
    const privateKey = await crypto.subtle.importKey(
      'jwk',
      saved.privateJwk,
      ecdh,
      true,
      ['deriveBits'],
    )
    const publicKey = await importPublicKey(saved.publicJwk)
    return { privateKey, publicKey, publicJwk: saved.publicJwk }
  }
  const identity = await createIdentity()
  const privateJwk = await crypto.subtle.exportKey('jwk', identity.privateKey)
  localStorage.setItem(key, JSON.stringify({ privateJwk, publicJwk: identity.publicJwk }))
  return identity
}

async function publishKey(username: string, identity: Identity) {
  await fetch('/api/public-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, publicJwk: identity.publicJwk }),
  }).catch(() => undefined)
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

export default function App() {
  const [screen, setScreen] = useState<Screen>(
    inviteToken ? 'invite' : localStorage.getItem('honden.username') ? 'chats' : 'onboarding',
  )
  const { settings, update } = useSettings()
  const [threads, setThreads] = useState<Thread[]>(loadThreads)
  const [messages, setMessages] = useState<ChatMessage[]>(loadChatBackup)
  const [invite, setInvite] = useState<Invite>(currentInvite)
  const [activeThreadId, setActiveThreadId] = useState('')
  const [status, setStatus] = useState<ChannelStatus>(getChannelStatus)
  const [call, setCall] = useState<CallSnapshot>(() => callManager.snapshot())
  const [draft, setDraft] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const [user, setUser] = useState<AccountUser>(loadAccount)
  const [username, setUsername] = useState(ownUsername)
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [devices, setDevices] = useState<DeviceSession[]>(loadDevices)
  const [modal, setModal] = useState<'profile' | 'security' | null>(null)
  const [offline, setOffline] = useState(false)
  const [notice, setNotice] = useState('')
  const offlineTimer = useRef<number | undefined>(undefined)
  const [retry, setRetry] = useState(0)
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
  }, [username])

  useEffect(() => {
    localStorage.setItem('honden.user', JSON.stringify(user))
  }, [user])

  useEffect(() => {
    localStorage.setItem('honden.devices', JSON.stringify(devices))
  }, [devices])

  useEffect(() => {
    saveChatBackup(messages)
  }, [messages])

  useEffect(() => {
    const goOnline = () => {
      clearOffline()
      setRetry((value) => value + 1)
    }
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', scheduleOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', scheduleOffline)
      if (offlineTimer.current !== undefined) window.clearTimeout(offlineTimer.current)
    }
  }, [])

  useEffect(() => {
    void fetch('/api/messages?chatId=health')
      .then((response) => {
        if (response.ok) clearOffline()
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => subscribeChannel(() => setStatus(getChannelStatus())), [])

  useEffect(() => subscribeStore(() => setThreads(loadThreads())), [])

  useEffect(() => {
    if (screen !== 'chat') return
    const cached = loadChatBackup().filter((message) => message.threadId === activeThreadId)
    setMessages((current) => mergeChatMessages(current, cached))
    void fetch(`/api/messages?chatId=${encodeURIComponent(activeThreadId)}`)
      .then((response) => {
        if (!response.ok) throw new Error('offline')
        clearOffline()
        return response.json()
      })
      .then(async (items: WireMessage[]) => {
        const serverMessages = Array.isArray(items)
          ? await Promise.all(items.map((item) => toChatMessage(item, identity)))
          : []
        setMessages((current) =>
          mergeChatMessages(current, serverMessages.length > 0 ? serverMessages : cached),
        )
      })
      .catch(() => {
        scheduleOffline()
        setMessages((current) => mergeChatMessages(current, cached))
      })
  }, [screen, activeThreadId, retry, identity])

  useEffect(() => {
    let socket: WebSocket | undefined
    let timer: number | undefined
    let stopped = false

    function connect() {
      socket = new WebSocket(wsBase)
      socket.onmessage = (event) => {
        let frame: { type?: string; message?: WireMessage; id?: string }
        try {
          frame = JSON.parse(event.data as string) as {
            type?: string
            message?: WireMessage
            id?: string
          }
        } catch {
          return
        }
        if (frame.type === 'message' && frame.message) {
          void toChatMessage(frame.message!, identity).then((chat) => {
            setMessages((current) => mergeChatMessages(current, [chat]))
          })
        }
        if (frame.type === 'delete' && frame.id) {
          setMessages((current) => current.filter((item) => item.id !== frame.id))
        }
      }
      socket.onclose = () => {
        if (!stopped) timer = window.setTimeout(connect, 1000)
      }
    }

    connect()
    return () => {
      stopped = true
      if (timer) window.clearTimeout(timer)
      socket?.close()
    }
  }, [identity])

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
    callManager.setSignalingSender((event) => signal.send(event))

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

  async function sendMessage(threadId: string, text: string, gifUrl?: string) {
    if (!identity) return
    const plain = gifUrl ?? text
    const key = await sharedKey(identity, threadId)
    if (!key) return
    const payload = await encryptText(plain, key)
    const outgoing: WireMessage = {
      id: randomId(),
      chatId: threadId,
      sender: ownUsername,
      text: JSON.stringify(payload),
      time: new Date().toISOString(),
    }
    try {
      const response = await fetch(`/api/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(outgoing),
      })
      if (!response.ok) {
        scheduleOffline()
        return
      }
      clearOffline()
      const timestamp = Date.now()
      setMessages((current) =>
        mergeChatMessages(current, [
          {
            id: outgoing.id,
            threadId,
            senderId: `@${ownUsername}`,
            from: 'me',
            time: formatTime(timestamp),
            timestamp,
            text: plain,
          },
        ]),
      )
    } catch {
      scheduleOffline()
      return
    }
  }

  async function deleteMessage(id: string, threadId: string) {
    setMessages((current) => current.filter((item) => item.id !== id))
    try {
      await fetch(
        `/api/messages/${encodeURIComponent(id)}?chatId=${encodeURIComponent(threadId)}`,
        { method: 'DELETE' },
      )
    } catch {
      return
    }
  }

  async function finishLogin(name: string, loginNotice?: string) {
    const loaded = await loadIdentity(name).catch(() => null)
    if (loaded) {
      setIdentity(loaded)
      await publishKey(name, loaded)
    }
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

  function addByUsername(raw: string, allowSelf = false): boolean {
    const username = normalizeUsername(raw)
    if (!username || (!allowSelf && username === ownUsername)) return false
    const person = localPeople.find((item) => item.username === username)
    if (!person) return false
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

  function newThread(name: string) {
    const username = normalizeUsername(name)
    if (addByUsername(username)) {
      setActiveThreadId(username)
      setScreen('chat')
    }
  }

  function acceptInvite() {
    addByUsername(ownUsername, true)
    setScreen('chats')
  }

  function newInvite() {
    const next = rotateInvite()
    setInvite(next)
  }

  function startCall(kind: CallKind) {
    void callManager.startOutgoing(activeThreadId, kind)
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

  function sendGif(gif: GifResult) {
    void sendMessage(activeThreadId, '', gif.url)
    setPickerOpen(false)
  }

  function submitDraft() {
    const value = draft.trim()
    if (!value) return
    void sendMessage(activeThreadId, value)
    setDraft('')
  }

  async function saveProfile(patch: ProfilePatch) {
    setUser((current) => ({ ...current, ...patch }))
    const token = getSignalToken()
    if (!token) return
    try {
      await fetch(`/api/auth/profile`, {
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
      await fetch(`/api/auth/devices/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
    } catch {
      return
    }
  }

  function signOut() {
    localStorage.removeItem('honden.token')
    localStorage.removeItem('honden.auth')
    localStorage.removeItem('honden.auth_token')
    localStorage.removeItem('honden.username')
    localStorage.removeItem('honden.user')
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
        await fetch(`/api/contacts/${contactId}`, {
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

  let     screenView = <Onboarding onDone={(name, loginNotice) => void finishLogin(name, loginNotice)} />

  if (screen === 'invite') {
    screenView = <Onboarding onDone={acceptInvite} />
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
    const thread = threads.find((item) => item.id === activeThreadId) ?? threads[0]
    const threadId = thread?.id ?? activeThreadId
    const visible = messages.filter((message) => message.threadId === threadId)
    const mentionMatch = /(^|\s)@([a-z0-9_]*)$/.exec(draft)
    const mentionCandidates = mentionMatch
      ? localPeople.filter((person) => person.username.startsWith(mentionMatch[2]))
      : []

    screenView = (
      <div className="flex h-[100dvh] w-full overflow-hidden bg-warm-cream text-warm-charcoal lg:mx-auto lg:max-w-[1200px]">
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
              <p className="text-[13px] text-soft-grey">@{thread?.username ?? 'someone'}</p>
              <p className="flex items-center gap-1 text-[12px] text-soft-grey">
                <Lock size={10} className="text-heart-pink" aria-hidden="true" />
                Only you and Alex can read this.
              </p>
            </div>
            <UserChip
              user={user}
              onProfile={() => setModal('profile')}
              onSecurity={() => setModal('security')}
            />
            <button
              type="button"
              onClick={() => startCall('video')}
              aria-label="Call Alex"
              className="flex min-h-12 items-center gap-2 rounded-xl border border-heart-pink bg-white px-3 py-2 text-sm font-bold text-heart-pink transition hover:bg-soft-blush md:min-h-11"
            >
              <Phone size={16} className="text-heart-pink" />
              Call
            </button>
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
                    <button
                      type="button"
                      onClick={() => deleteMessage(message.id, message.threadId)}
                      className="flex min-h-11 items-center px-2 text-soft-red transition hover:text-deep-rose md:min-h-11"
                    >
                      Delete
                    </button>
                  </div>
                  {settings.readReceipts && message.from === 'me' && (
                    <span className="text-[13px] text-soft-grey">✓✓</span>
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
                      <button
                        type="button"
                        onClick={() => {
                          setLongPressedId('')
                          void deleteMessage(message.id, message.threadId)
                        }}
                        className="min-h-11 flex-1 rounded-xl border border-soft-red px-3 text-[13px] font-semibold text-soft-red"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="relative shrink-0 border-t border-border bg-white p-4">
            {pickerOpen && (
              <MediaPicker
                onEmoji={insertEmoji}
                onGif={sendGif}
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
              <textarea
                ref={composerRef}
                rows={2}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    submitDraft()
                  }
                }}
                placeholder="Message…"
                className="min-h-12 flex-1 resize-none rounded-2xl border border-border bg-white px-3 py-2 text-base text-warm-charcoal outline-none placeholder:text-soft-grey focus:border-heart-pink"
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
                onClick={submitDraft}
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
    screenView = (
      <div className="h-[100dvh] w-full overflow-hidden bg-warm-cream md:flex lg:mx-auto lg:max-w-[1200px]">
        <aside className="hidden w-[280px] shrink-0 flex-col items-center gap-3 border-r border-border bg-white py-4 md:flex lg:w-[300px]">
          <UserChip
            user={user}
            onProfile={() => setModal('profile')}
            onSecurity={() => setModal('security')}
          />
        </aside>
        <div className="min-w-0 w-full flex-1">
          <EmptyChat
            threads={threads}
            messages={messages}
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
