import { isTauri } from '@tauri-apps/api/core'
import { playNewMessage } from '../sounds'

export type CallKind = 'voice' | 'video'

type SignalMessage = {
  sender?: string
  recipient?: string | null
  chatId?: string
}

export type SignalEvent = {
  type:
    | 'ready'
    | 'message'
    | 'typing'
    | 'call:invite'
    | 'call:accept'
    | 'call:reject'
    | 'call:offer'
    | 'call:answer'
    | 'call:ice'
    | 'call:retry'
    | 'call:feeling'
    | 'call:hangup'
  callId?: string
  to?: string
  from?: string
  peerName?: string
  kind?: CallKind
  sdp?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit
  reason?: string
  feeling?: string
  conversationId?: string
  isTyping?: boolean
  userId?: string
  message?: SignalMessage
}

export type SignalClient = {
  send: (event: SignalEvent) => void
  close: () => void
}

function getToken() {
  const direct =
    localStorage.getItem('honden.token') ??
    localStorage.getItem('honden.auth_token') ??
    localStorage.getItem('token')
  if (direct) return direct

  const stored = localStorage.getItem('honden.auth')
  if (!stored) return undefined
  try {
    const parsed = JSON.parse(stored) as { token?: string; accessToken?: string }
    return parsed.token ?? parsed.accessToken
  } catch {
    return undefined
  }
}

export function getSignalToken() {
  return getToken()
}

export function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function redactWsUrl(value: string): string {
  try {
    const url = new URL(value)
    if (url.searchParams.has('token')) url.searchParams.set('token', '<redacted>')
    return url.toString()
  } catch {
    return value
  }
}

export function authenticatedWs(path = '/ws'): string {
  const url = new URL(sameOriginWs(path))
  const token = getToken()
  if (token) url.searchParams.set('token', token)
  console.info('[honden:diag] websocket url', {
    runtime: isTauriRuntime() ? 'tauri' : 'web',
    origin: remoteOrigin(),
    url: redactWsUrl(url.toString()),
    hasToken: Boolean(token),
  })
  return url.toString()
}

function getSignalId() {
  const saved = localStorage.getItem('honden.signalId')
  if (saved) return saved
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `peer-${Date.now()}-${Math.random().toString(36).slice(2)}`
  localStorage.setItem('honden.signalId', id)
  return id
}

export const RELEASE_ORIGIN = 'https://honden.onrender.com'
export const RELEASE_WS_URL = 'wss://honden.onrender.com/ws'

export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false
  const hostname = window.location.hostname
  // The hosted web app and local dev servers must keep talking to their own
  // origin. Everything else here is the packaged Tauri app.
  if (hostname === 'honden.onrender.com' || hostname === 'localhost' || hostname === '127.0.0.1') {
    return false
  }
  if (isTauri() || '__TAURI_INTERNALS__' in window || '__TAURI__' in window) return true
  // Android WebViews have shipped without the injected Tauri globals. Never
  // let that fall back to `http://tauri.localhost` for API/WebSocket traffic.
  return hostname === 'tauri.localhost' || hostname.endsWith('.localhost')
}

export function remoteOrigin(): string {
  return isTauriRuntime() ? RELEASE_ORIGIN : window.location.origin
}

/** Wake Render Free before its 15-minute idle suspend. */
export async function wakeServer(): Promise<boolean> {
  const url = `${remoteOrigin()}/health?t=${Date.now()}`
  try {
    const response = await fetch(url, { cache: 'no-store' })
    console.info('[honden:diag] health probe', { url, ok: response.ok, status: response.status })
    return response.ok
  } catch (error) {
    console.warn('[honden:diag] health probe failed', {
      url,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

export function apiUrl(path: string): string {
  if (!path.startsWith('/')) return path
  return `${remoteOrigin()}${path}`
}

export function sameOriginWs(path = '/ws'): string {
  if (isTauriRuntime() && path === '/ws') return RELEASE_WS_URL
  const url = new URL(remoteOrigin())
  const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${url.host}${path}`
}

export function connectSignals(onEvent: (event: SignalEvent) => void): SignalClient {
  const signalId = getSignalId()
  const socket = new WebSocket(authenticatedWs('/ws'))

  socket.onmessage = (message) => {
    try {
      const event = JSON.parse(String(message.data)) as SignalEvent
      if (event.from === signalId) return
      const own = localStorage.getItem('honden.username')?.trim().replace(/^@/, '').toLowerCase()
      const sender = event.message?.sender?.trim().replace(/^@/, '').toLowerCase()
      const recipient =
        typeof event.message?.recipient === 'string'
          ? event.message.recipient.trim().replace(/^@/, '').toLowerCase()
          : ''
      if (
        event.type === 'message' &&
        own &&
        sender &&
        recipient === own &&
        sender !== own
      ) {
        playNewMessage()
      }
      onEvent(event)
    } catch {
      return
    }
  }

  return {
    send: (event) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ ...event, from: signalId }))
      }
    },
    close: () => socket.close(),
  }
}
