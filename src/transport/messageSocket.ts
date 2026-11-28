import type { ConnectionDetail, ConnectionStatus } from '../types'
import {
  CONNECT_TIMEOUT_MS,
  HEALTH_POLL_MS,
  MAX_CONNECT_RETRIES,
  RETRY_INTERVAL_MS,
} from './reliability'

export type MessageFrame = {
  type?: string
  message?: unknown
  id?: string
  userId?: string
  [key: string]: unknown
}

export type MessageSocketHandlers = {
  onFrame: (frame: MessageFrame) => void
  onStatus: (status: ConnectionStatus, detail?: ConnectionDetail) => void
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
  retryIntervalMs?: number
  maxRetries?: number
  probeServer?: () => Promise<boolean>
  /** Native logger hook; the app forwards this to Tauri/Android logcat. */
  onLog?: (message: string) => void
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

/**
 * Keep the full scheme/host/path for diagnostics, but drop the auth token:
 * the WebSocket URL carries `?token=...` and tokens must never be logged.
 */
function loggableWsUrl(value: string): string {
  try {
    const url = new URL(value)
    url.searchParams.delete('token')
    return url.toString()
  } catch {
    return value.replace(/([?&]token=)[^&#\s]*/gi, '$1<omitted>')
  }
}

function safeErrorText(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value)
  return text.replace(/([?&]token=)[^&#\s]*/gi, '$1<omitted>')
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
  const retryIntervalMs = options.retryIntervalMs ?? RETRY_INTERVAL_MS
  const maxRetries = options.maxRetries ?? MAX_CONNECT_RETRIES
  const probeServer = options.probeServer
  const emitLog = options.onLog ?? (() => undefined)
  let currentUrl = url
  let socket: WebSocket | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined
  let pongTimer: ReturnType<typeof setTimeout> | undefined
  let stableTimer: ReturnType<typeof setTimeout> | undefined
  let connectTimer: ReturnType<typeof setTimeout> | undefined
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined
  let healthTimer: ReturnType<typeof setInterval> | undefined
  let probing = false
  let stopped = false
  let retryCount = 0
  let wakeStartedAt = Date.now()
  let authReady = false
  let syncing = false
  let awaitingPong = false
  let lastFrameAt = Date.now()
  // Once we report failure, keep the honest state visible while background
  // health probes continue. A manual Retry clears this.
  let reportedUnreachable = false

  function connectionDetail(): ConnectionDetail {
    const remaining = wakeStartedAt + connectTimeoutMs - Date.now()
    return {
      attempt: attemptNumber(),
      maxAttempts: maxRetries,
      secondsLeft: Math.max(0, Math.ceil(remaining / 1000)),
    }
  }

  function setStatus(status: ConnectionStatus, withDetail = false): void {
    handlers.onStatus(status, withDetail ? connectionDetail() : undefined)
  }

  function attemptNumber(): number {
    return Math.min(retryCount + 1, maxRetries)
  }

  function logAttempt(): void {
    emitLog(
      `HonDen connect retry ${attemptNumber()}/${maxRetries} to ${loggableWsUrl(currentUrl)}`,
    )
  }

  function logFailure(message: string): void {
    emitLog(`HonDen connect failed ${attemptNumber()}/${maxRetries}: ${safeErrorText(message)}`)
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

  function clearDeadline(): void {
    if (deadlineTimer) {
      clearTimeout(deadlineTimer)
      deadlineTimer = undefined
    }
  }

  function startDeadline(): void {
    clearDeadline()
    deadlineTimer = setTimeout(() => {
      deadlineTimer = undefined
      if (stopped || authReady) return
      console.warn('[ws:diag] wake window expired', {
        wakeMs: connectTimeoutMs,
        finalAttemptMs: connectTimeoutMs + retryIntervalMs,
      })
      clearReconnect()
      markUnreachable()
    }, connectTimeoutMs + retryIntervalMs)
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

  /**
   * Detach first, then close with an explicit valid code. Some Android WebViews
   * throw when close() is called without a code on a pending handshake; letting
   * that exception escape would abort the retry chain and pin the pill at
   * retry 0/6. The socket reference is cleared before close either way.
   */
  function detachAndClose(current: WebSocket | undefined): void {
    if (!current) return
    current.onopen = null
    current.onmessage = null
    current.onerror = null
    current.onclose = null
    if (current.readyState >= WebSocket.CLOSING) return
    try {
      current.close(1000)
    } catch (error) {
      console.warn('[ws:diag] socket close failed', error)
    }
  }

  function markUnreachable(): void {
    if (stopped) return
    clearConnectTimer()
    clearReconnect()
    clearDeadline()
    reportedUnreachable = true
    detachAndClose(socket)
    socket = undefined
    setStatus('unreachable')
    startHealthPolling()
  }

  function closeCurrentSocket(): void {
    const current = socket
    socket = undefined
    detachAndClose(current)
  }

  function scheduleRetry(immediate = false): void {
    clearHeartbeat()
    clearConnectTimer()
    if (stopped || reconnectTimer || reportedUnreachable) return
    if (retryCount >= maxRetries) {
      markUnreachable()
      return
    }
    retryCount += 1
    const status: ConnectionStatus = retryCount >= 3 ? 'waking' : 'reconnecting'
    setStatus(status, true)
    if (retryCount >= 3) startHealthPolling()
    console.info('[ws] retry scheduled', {
      attempt: retryCount,
      maxAttempts: maxRetries,
      delay: immediate ? 0 : retryIntervalMs,
    })
    if (immediate) {
      // A 5s handshake window already elapsed; reconnect now so retries land
      // every 5s instead of every 10s.
      connect()
      return
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      connect()
    }, retryIntervalMs)
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
      try {
        closeCurrentSocket()
      } finally {
        scheduleRetry()
      }
      return
    } finally {
      syncing = false
    }
    if (stopped || !authReady || socket?.readyState !== WebSocket.OPEN) return
    retryCount = 0
    reportedUnreachable = false
    clearConnectTimer()
    clearDeadline()
    clearReconnect()
    clearHealthPolling()
    console.info('[ws:diag] sync complete; connection ready')
    setStatus('live')
    if (stableTimer) clearTimeout(stableTimer)
    stableTimer = setTimeout(() => {
      if (authReady && !stopped) retryCount = 0
    }, STABLE_MS)
  }

  function connect(): void {
    if (stopped) return
    clearConnectTimer()
    console.info('[ws:diag] connecting', {
      url: redactUrl(currentUrl),
      attempt: retryCount,
      readyState: readyStateName(socket?.readyState),
    })
    logAttempt()
    authReady = false
    syncing = false
    awaitingPong = false
    lastFrameAt = Date.now()
    if (!reportedUnreachable) setStatus(retryCount === 0 ? 'connecting' : 'reconnecting', true)

    let next: WebSocket
    try {
      next = new WebSocket(currentUrl)
    } catch (error) {
      logFailure(safeErrorText(error))
      scheduleRetry()
      return
    }
    socket = next
    // Android WebViews can leave a handshake stuck in CONNECTING forever.
    // Force a fresh socket every 5s instead of waiting for an event that may
    // never arrive. The 30s deadline below still owns the overall wake window.
    connectTimer = setTimeout(() => {
      if (stopped || socket !== next || authReady) return
      logFailure(`handshake timed out after ${retryIntervalMs}ms`)
      console.warn('[ws:diag] handshake still pending, retrying', {
        readyState: readyStateName(next.readyState),
      })
      try {
        closeCurrentSocket()
      } finally {
        scheduleRetry(true)
      }
    }, retryIntervalMs)

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
      logFailure(event instanceof Event ? event.type : String(event))
      console.warn('[ws:diag] socket error', {
        readyState: readyStateName(next.readyState),
        message: event instanceof Event ? event.type : String(event),
      })
      try {
        closeCurrentSocket()
      } finally {
        scheduleRetry()
      }
    }

    next.onclose = (event) => {
      console.warn('[ws:diag] socket closed', {
        code: event.code,
        reason: event.reason,
        readyState: readyStateName(next.readyState),
      })
      if (socket !== next) return
      logFailure(
        `socket closed code ${event.code}${event.reason ? `: ${event.reason}` : ''}`,
      )
      socket = undefined
      clearHeartbeat()
      if (stopped) return
      scheduleRetry()
    }
  }

  function forceFreshSocket(): void {
    clearReconnect()
    clearConnectTimer()
    closeCurrentSocket()
    connect()
  }

  function restart(nextUrl = currentUrl): void {
    if (stopped) return
    currentUrl = nextUrl
    wakeStartedAt = Date.now()
    retryCount = 0
    reportedUnreachable = false
    clearDeadline()
    clearHealthPolling()
    forceFreshSocket()
    startDeadline()
  }

  function resume(): void {
    if (stopped) return
    // A live socket is already working. Anything else -- including a handshake
    // left stuck in CONNECTING while Android suspends the WebView -- needs a
    // fresh connection instead of waiting for a paused timer to fire. Keep the
    // existing retry count and 30s deadline so visibility changes cannot reset
    // the wake window indefinitely.
    if (authReady && socket?.readyState === WebSocket.OPEN) return
    // Do not tear down an in-progress handshake: on Android, visibilitychange
    // can fire while the 5s connect timer is still pending. Forcing a fresh
    // socket here resets that timer and pins retry at 1/6 forever. Let the
    // connect timer own stalled CONNECTING sockets; it will close and advance.
    if (socket?.readyState === WebSocket.CONNECTING) return
    forceFreshSocket()
  }

  const onOnline = () => {
    // Network restored is a new wake window: clear the old failure/retry count
    // so the app can reconnect without waiting for a health probe.
    restart()
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
  startDeadline()
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
      clearDeadline()
      clearHealthPolling()
      if (stableTimer) clearTimeout(stableTimer)
      detachAndClose(socket)
      socket = undefined
    },
    restart,
    send(frame) {
      if (stopped || socket?.readyState !== WebSocket.OPEN) return
      socket.send(JSON.stringify(frame))
    },
  }
}
