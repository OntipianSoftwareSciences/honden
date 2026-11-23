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
    | 'call:hangup'
  callId?: string
  to?: string
  from?: string
  peerName?: string
  kind?: CallKind
  sdp?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit
  reason?: string
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

export function authenticatedWs(path = '/ws'): string {
  const url = new URL(sameOriginWs(path))
  const token = getToken()
  if (token) url.searchParams.set('token', token)
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

export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false
  // The hosted web app must always keep talking to its own origin.
  if (window.location.hostname === 'honden.onrender.com') return false
  // isTauri() depends on an injected init script; older Android WebViews can
  // miss it, so also accept the IPC globals Tauri always installs.
  return isTauri() || '__TAURI_INTERNALS__' in window || '__TAURI__' in window
}

export function remoteOrigin(): string {
  return isTauriRuntime() ? RELEASE_ORIGIN : window.location.origin
}

/** Wake Render Free before its 15-minute idle suspend. */
export async function wakeServer(): Promise<boolean> {
  try {
    const response = await fetch(`${remoteOrigin()}/health?t=${Date.now()}`, {
      cache: 'no-store',
    })
    return response.ok
  } catch {
    return false
  }
}

export function apiUrl(path: string): string {
  if (!path.startsWith('/')) return path
  return `${remoteOrigin()}${path}`
}

export function sameOriginWs(path = '/ws'): string {
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
