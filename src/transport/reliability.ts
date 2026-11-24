export const RECONNECT_BASE_MS = 1000
export const RECONNECT_MAX_MS = 30000
/**
 * Show a failure state instead of hanging on "Connecting" forever.
 * 30s is an estimate for a cold Render Free start, not a promise: the server
 * may wake earlier or later. The pill counts down over this same window.
 */
export const CONNECT_TIMEOUT_MS = 30000
/** While the server is waking, poll /health at this cadence before reconnecting. */
export const HEALTH_POLL_MS = 5000
/** Ping Render Free before its 15-minute idle suspend. */
export const WAKE_INTERVAL_MS = 14 * 60 * 1000
/** Estimated wake time shown on the connection pill (seconds). */
export const WAKE_ESTIMATE_SECONDS = 30

export type WakeCountdown = { secondsLeft: number; stopped: boolean }

export function startWakeCountdown(): WakeCountdown {
  return { secondsLeft: WAKE_ESTIMATE_SECONDS, stopped: false }
}

export function tickWakeCountdown(current: WakeCountdown): WakeCountdown {
  if (current.stopped) return current
  const secondsLeft = Math.max(0, current.secondsLeft - 1)
  return { secondsLeft, stopped: secondsLeft === 0 }
}

export function stopWakeCountdown(current: WakeCountdown): WakeCountdown {
  return current.stopped ? current : { ...current, stopped: true }
}

export type Cursor = { time: string; id: string }

export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const bounded = Math.min(Math.max(Math.trunc(attempt), 0), 10)
  const base = Math.min(RECONNECT_BASE_MS * 2 ** bounded, RECONNECT_MAX_MS)
  const jitter = base * 0.25 * (random() * 2 - 1)
  return Math.max(250, Math.min(RECONNECT_MAX_MS, Math.round(base + jitter)))
}

export function isAfterCursor(time: string, id: string, cursor: Cursor | null): boolean {
  if (!cursor) return true
  if (time > cursor.time) return true
  if (time < cursor.time) return false
  return id > cursor.id
}

export function advanceCursor(cursor: Cursor | null, next: Cursor): Cursor {
  if (!isAfterCursor(next.time, next.id, cursor)) return cursor ?? next
  return next
}

export function mergeById<T extends { id: string; timestamp: number }>(
  current: T[],
  incoming: T[],
): T[] {
  const byId = new Map(current.map((item) => [item.id, item]))
  for (const item of incoming) {
    if (!byId.has(item.id)) byId.set(item.id, item)
  }
  return [...byId.values()].sort(
    (a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id),
  )
}
