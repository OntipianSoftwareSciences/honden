import type { ConnectionStatus } from '../types'
import { CONNECT_TIMEOUT_MS, HEALTH_POLL_MS, reconnectDelay } from './reliability'

export type MessageFrame = {
  type?: string
  message?: unknown
  id?: string
  userId?: string
  [key: string]: unknown
}

export type MessageSocketHandlers = {
  onFrame: (frame: MessageFrame) => void
  onStatus: (status: ConnectionStatus) => void
  onSync: () => Promise<void>
}

export type MessageSocketController = {
  close: () => void
  restart: (url?: string) => void
  send: (frame: Record<string, unknown>) => void
}

export type MessageSocketOptions = {
  connectTimeoutMs?: number
  healthPollMs?: number
  probeServer?: () => Promise<boolean>
}

const HEARTBEAT_MS = 25_000
const PONG_TIMEOUT_MS = 12_000
const STALE_TIMEOUT_MS = 60_000
const STABLE_MS = 30_000

function redactUrl(value: string): string {
  try {
    const url = new URL(value)
    if (url.searchParams.has('token')) url.searchParams.set('token', '<redacted>')
    return url.toString()
  } catch {
    return value
  }
}

function readyStateName(state: number | undefined): string {
  if (state === WebSocket.OPEN) return 'OPEN'
  if (state === WebSocket.CLOSING) return 'CLOSING'
  if (state === WebSocket.CLOSED) return 'CLOSED'
  if (state === WebSocket.CONNECTING) return 'CONNECTING'
  return 'NONE'
}

export function startMessageSocket(
  url: string,
  handlers: MessageSocketHandlers,
  options: MessageSocketOptions = {},
): MessageSocketController {
  const connectTimeoutMs = options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS
  const healthPollMs = options.healthPollMs ?? HEALTH_POLL_MS
  const probeServer = options.probeServer
  let currentUrl = url
  let socket: WebSocket | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined
  let pongTimer: ReturnType<typeof setTimeout> | undefined
  let stableTimer: ReturnType<typeof setTimeout> | undefined
  let connectTimer: ReturnType<typeof setTimeout> | undefined
  let healthTimer: ReturnType<typeof setInterval> | undefined
  let probing = false
  let stopped = false
  let attempt = 0
  let authReady = false
  let syncing = false
  let awaitingPong = false
  let lastFrameAt = Date.now()
  // Once we report failure, keep the honest state visible while background
  // retries continue with backoff. A manual Retry clears this.
  let reportedUnreachable = false

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

  function clearConnectTimer(): void {
    if (connectTimer) {
      clearTimeout(connectTimer)
      connectTimer = undefined
    }
  }

  function clearHealthPolling(): void {
    if (healthTimer) {
      clearInterval(healthTimer)
      healthTimer = undefined
    }
  }

  function startHealthPolling(): void {
    if (!probeServer || stopped || healthTimer) return
    console.info('[ws:diag] health polling started', {
      intervalMs: healthPollMs,
      url: redactUrl(currentUrl),
    })
    healthTimer = setInterval(() => {
      if (stopped || probing) return
      probing = true
      void probeServer()
        .then((awake) => {
          if (stopped) return
          console.info('[ws:diag] health poll result', { awake })
          if (!awake) return
          clearHealthPolling()
          restart()
        })
        .catch((error: unknown) => {
          console.warn('[ws:diag] health poll failed', error)
        })
        .finally(() => {
          probing = false
        })
    }, healthPollMs)
  }

  function markUnreachable(): void {
    if (stopped) return
    clearConnectTimer()
    reportedUnreachable = true
    const current = socket
    socket = undefined
    if (current) {
      current.onopen = null
      current.onmessage = null
      current.onerror = null
      current.onclose = null
      if (current.readyState < WebSocket.CLOSING) current.close()
    }
    setStatus('unreachable')
    startHealthPolling()
  }

  function scheduleReconnect(): void {
    clearHeartbeat()
    clearConnectTimer()
    if (stopped || reconnectTimer) return
    attempt += 1
    if (!reportedUnreachable) setStatus(attempt >= 3 ? 'waking' : 'reconnecting')
    if (reportedUnreachable || attempt >= 3) startHealthPolling()
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
    reportedUnreachable = false
    clearConnectTimer()
    clearHealthPolling()
    console.info('[ws:diag] sync complete; connection ready')
    setStatus('live')
    if (stableTimer) clearTimeout(stableTimer)
    stableTimer = setTimeout(() => {
      if (authReady && !stopped) attempt = 0
    }, STABLE_MS)
  }

  function connect(): void {
    if (stopped) return
    clearConnectTimer()
    console.info('[ws:diag] connecting', {
      url: redactUrl(currentUrl),
      attempt,
      readyState: readyStateName(socket?.readyState),
    })
    authReady = false
    syncing = false
    awaitingPong = false
    lastFrameAt = Date.now()
    if (!reportedUnreachable) setStatus(attempt === 0 ? 'connecting' : 'reconnecting')

    let next: WebSocket
    try {
      next = new WebSocket(currentUrl)
    } catch {
      scheduleReconnect()
      return
    }
    socket = next
    // Android WebViews can leave a handshake stuck in CONNECTING forever.
    // Fail over to an honest error state after the connect timeout.
    connectTimer = setTimeout(() => {
      if (stopped || socket !== next || authReady) return
      console.warn('[ws:diag] connection timed out', {
        timeoutMs: connectTimeoutMs,
        readyState: readyStateName(next.readyState),
      })
      markUnreachable()
      scheduleReconnect()
    }, connectTimeoutMs)

    next.onopen = () => {
      console.info('[ws:diag] socket open', { url: redactUrl(currentUrl) })
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
        console.info('[ws:diag] ready frame received')
        if (!authReady) {
          authReady = true
          void runSync()
        }
        return
      }
      handlers.onFrame(frame)
    }

    next.onerror = (event) => {
      if (stopped || socket !== next) return
      console.warn('[ws:diag] socket error', {
        readyState: readyStateName(next.readyState),
        message: event instanceof Event ? event.type : String(event),
      })
    }

    next.onclose = (event) => {
      console.warn('[ws:diag] socket closed', {
        code: event.code,
        reason: event.reason,
        readyState: readyStateName(next.readyState),
      })
      if (socket !== next) return
      socket = undefined
      clearHeartbeat()
      if (stopped) return
      scheduleReconnect()
    }
  }

  function restart(nextUrl = currentUrl): void {
    if (stopped) return
    currentUrl = nextUrl
    clearReconnect()
    clearConnectTimer()
    clearHealthPolling()
    attempt = 0
    reportedUnreachable = false
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
  }

  function resume(): void {
    if (stopped) return
    // A live socket is already working. Anything else -- including a handshake
    // left stuck in CONNECTING while Android suspends the WebView -- needs a
    // fresh connection instead of waiting for a paused timer to fire.
    if (authReady && socket?.readyState === WebSocket.OPEN) return
    restart()
  }

  const onOnline = () => {
    resume()
  }

  const onOffline = () => {
    if (!stopped) setStatus('disconnected')
  }

  const onVisible = () => {
    if (stopped || document.hidden) return
    resume()
  }

  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', onVisible)
  }
  connect()

  return {
    close() {
      stopped = true
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('visibilitychange', onVisible)
      }
      clearReconnect()
      clearHeartbeat()
      clearConnectTimer()
      clearHealthPolling()
      if (stableTimer) clearTimeout(stableTimer)
      const current = socket
      socket = undefined
      if (current && current.readyState < WebSocket.CLOSING) current.close()
    },
    restart,
    send(frame) {
      if (stopped || socket?.readyState !== WebSocket.OPEN) return
      socket.send(JSON.stringify(frame))
    },
  }
}
