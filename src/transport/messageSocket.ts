import type { ConnectionStatus } from '../types'
import { reconnectDelay } from './reliability'

export type MessageFrame = {
  type?: string
  message?: unknown
  id?: string
  userId?: string
}

export type MessageSocketHandlers = {
  onFrame: (frame: MessageFrame) => void
  onStatus: (status: ConnectionStatus) => void
  onSync: () => Promise<void>
}

export type MessageSocketController = {
  close: () => void
  restart: (url?: string) => void
}

const HEARTBEAT_MS = 25_000
const PONG_TIMEOUT_MS = 12_000
const STALE_TIMEOUT_MS = 60_000
const STABLE_MS = 30_000

export function startMessageSocket(
  url: string,
  handlers: MessageSocketHandlers,
): MessageSocketController {
  let currentUrl = url
  let socket: WebSocket | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined
  let pongTimer: ReturnType<typeof setTimeout> | undefined
  let stableTimer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  let attempt = 0
  let authReady = false
  let syncing = false
  let awaitingPong = false
  let lastFrameAt = Date.now()

  function setStatus(status: ConnectionStatus): void {
    handlers.onStatus(status)
  }

  function clearReconnect(): void {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = undefined
    }
  }

  function clearHeartbeat(): void {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = undefined
    }
    if (pongTimer) {
      clearTimeout(pongTimer)
      pongTimer = undefined
    }
  }

  function scheduleReconnect(): void {
    clearHeartbeat()
    if (stopped || reconnectTimer) return
    attempt += 1
    setStatus(attempt >= 3 ? 'waking' : 'reconnecting')
    const delay = reconnectDelay(attempt - 1)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      connect()
    }, delay)
    console.info('[ws] reconnect scheduled', { attempt, delay })
  }

  function startHeartbeat(): void {
    clearHeartbeat()
    heartbeatTimer = setInterval(() => {
      if (stopped || socket?.readyState !== WebSocket.OPEN) return
      if (Date.now() - lastFrameAt > STALE_TIMEOUT_MS) {
        console.warn('[ws] stale connection detected')
        socket.close()
        return
      }
      awaitingPong = true
      socket.send(JSON.stringify({ type: 'ping' }))
      pongTimer = setTimeout(() => {
        if (!awaitingPong || stopped) return
        console.warn('[ws] heartbeat timed out')
        socket?.close()
      }, PONG_TIMEOUT_MS)
    }, HEARTBEAT_MS)
  }

  async function runSync(): Promise<void> {
    if (syncing || stopped || !authReady) return
    syncing = true
    setStatus('syncing')
    console.info('[ws] auth confirmed; sync start')
    try {
      await handlers.onSync()
    } catch {
      console.warn('[ws] sync failed; retrying connection')
      authReady = false
      const current = socket
      socket = undefined
      if (current) {
        current.onclose = null
        if (current.readyState < WebSocket.CLOSING) current.close()
      }
      scheduleReconnect()
      return
    } finally {
      syncing = false
    }
    if (stopped || !authReady || socket?.readyState !== WebSocket.OPEN) return
    attempt = 0
    console.info('[ws] sync complete; connection ready')
    setStatus('live')
    if (stableTimer) clearTimeout(stableTimer)
    stableTimer = setTimeout(() => {
      if (authReady && !stopped) attempt = 0
    }, STABLE_MS)
  }

  function connect(): void {
    if (stopped) return
    authReady = false
    syncing = false
    awaitingPong = false
    lastFrameAt = Date.now()
    setStatus(attempt === 0 ? 'connecting' : 'reconnecting')

    let next: WebSocket
    try {
      next = new WebSocket(currentUrl)
    } catch {
      scheduleReconnect()
      return
    }
    socket = next

    next.onopen = () => {
      if (stopped || socket !== next) return
      lastFrameAt = Date.now()
      startHeartbeat()
    }

    next.onmessage = (event) => {
      if (stopped || socket !== next) return
      lastFrameAt = Date.now()
      let frame: MessageFrame
      try {
        frame = JSON.parse(String(event.data)) as MessageFrame
      } catch {
        return
      }
      if (frame.type === 'pong') {
        awaitingPong = false
        return
      }
      if (frame.type === 'ready' && typeof frame.userId === 'string') {
        if (!authReady) {
          authReady = true
          void runSync()
        }
        return
      }
      handlers.onFrame(frame)
    }

    next.onerror = () => {
      if (stopped || socket !== next) return
      console.warn('[ws] connection error')
    }

    next.onclose = () => {
      if (socket !== next) return
      socket = undefined
      clearHeartbeat()
      if (stopped) return
      scheduleReconnect()
    }
  }

  const onOnline = () => {
    if (stopped) return
    clearReconnect()
    attempt = 0
    if (!socket || socket.readyState >= WebSocket.CLOSING) connect()
  }

  const onOffline = () => {
    if (!stopped) setStatus('disconnected')
  }

  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  connect()

  return {
    close() {
      stopped = true
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      clearReconnect()
      clearHeartbeat()
      if (stableTimer) clearTimeout(stableTimer)
      const current = socket
      socket = undefined
      if (current && current.readyState < WebSocket.CLOSING) current.close()
    },
    restart(nextUrl = currentUrl) {
      if (stopped) return
      currentUrl = nextUrl
      clearReconnect()
      attempt = 0
      const current = socket
      socket = undefined
      if (current) {
        current.onopen = null
        current.onmessage = null
        current.onerror = null
        current.onclose = null
        if (current.readyState < WebSocket.CLOSING) current.close()
      }
      connect()
    },
  }
}
