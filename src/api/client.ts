import { isTauri } from '@tauri-apps/api/core'

export type CallKind = 'voice' | 'video'

export type SignalEvent = {
  type:
    | 'ready'
    | 'typing'
    | 'call:invite'
    | 'call:accept'
    | 'call:reject'
    | 'call:offer'
    | 'call:answer'
    | 'call:ice'
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

const renderOrigin = 'https://honden.onrender.com'

export function remoteOrigin(): string {
  return isTauri() ? renderOrigin : window.location.origin
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
  const socket = new WebSocket(sameOriginWs('/ws'))

  socket.onmessage = (message) => {
    try {
      const event = JSON.parse(String(message.data)) as SignalEvent
      if (event.from === signalId) return
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
