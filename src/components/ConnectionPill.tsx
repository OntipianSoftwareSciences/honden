import { useEffect, useRef, useState } from 'react'
import CuteLoader from './CuteLoader'
import type { ConnectionDetail, ConnectionStatus } from '../types'
import {
  startWakeCountdown,
  stopWakeCountdown,
  tickWakeCountdown,
  type WakeCountdown,
} from '../transport/reliability'

export const connectionErrorLabel =
  "Couldn't connect to the honey den. Check your connection and tap Retry."

export const connectionLabels: Record<ConnectionStatus, string> = {
  live: 'Connected 🍯',
  connecting: 'Connecting to the honey den…',
  reconnecting: 'Reconnecting…',
  syncing: 'Syncing missed messages…',
  waking: 'Server is waking up…',
  unreachable: connectionErrorLabel,
  disconnected: 'Disconnected',
}

function isWakeStatus(status: ConnectionStatus): boolean {
  return status === 'connecting' || status === 'reconnecting' || status === 'waking'
}

/** Pure view logic so the countdown can be tested without a browser. */
export function wakePillView(
  status: ConnectionStatus,
  countdown: WakeCountdown,
  detail?: ConnectionDetail,
): { label: string; showCountdown: boolean; showRetry: boolean } {
  const expired =
    countdown.stopped &&
    countdown.secondsLeft === 0 &&
    status !== 'live' &&
    status !== 'syncing' &&
    status !== 'disconnected'
  // An early socket failure waits for the countdown to reach 0; no endless loop.
  const showRetry = status === 'unreachable' || expired
  // The transport only sends a fresh detail when the status changes. Keep the
  // visible seconds ticking locally so a stalled Android handshake cannot pin
  // the pill at "30s" forever; never count past a newer detail from the server.
  const secondsLeft = detail
    ? Math.min(countdown.secondsLeft, detail.secondsLeft)
    : countdown.secondsLeft
  const counting = secondsLeft > 0
  const showCountdown = isWakeStatus(status) && !showRetry && counting
  let label = connectionLabels[showRetry ? 'unreachable' : status]
  if (showCountdown) {
    label = detail
      ? `Connecting... ${secondsLeft}s · retry ${detail.attempt}/${detail.maxAttempts}`
      : `${label} ${secondsLeft}s`
  }
  return { label, showCountdown, showRetry }
}

const config: Record<
  ConnectionStatus,
  { label: string; dot: string; className: string }
> = {
  live: {
    label: connectionLabels.live,
    dot: 'bg-leaf-green',
    className: 'border-leaf-green/30 bg-leaf-green/10 text-leaf-green',
  },
  connecting: {
    label: connectionLabels.connecting,
    dot: 'bg-warm-amber',
    className: 'border-warm-amber/40 bg-warm-amber/20 text-warm-charcoal',
  },
  reconnecting: {
    label: connectionLabels.reconnecting,
    dot: 'bg-warm-amber',
    className: 'border-warm-amber/40 bg-warm-amber/20 text-warm-charcoal',
  },
  syncing: {
    label: connectionLabels.syncing,
    dot: 'bg-warm-amber',
    className: 'border-warm-amber/40 bg-warm-amber/20 text-warm-charcoal',
  },
  waking: {
    label: connectionLabels.waking,
    dot: 'bg-warm-amber',
    className: 'border-warm-amber/40 bg-warm-amber/20 text-warm-charcoal',
  },
  unreachable: {
    label: connectionLabels.unreachable,
    dot: 'bg-soft-red',
    className: 'border-soft-red/30 bg-soft-red/10 text-soft-red',
  },
  disconnected: {
    label: connectionLabels.disconnected,
    dot: 'bg-soft-red',
    className: 'border-soft-red/30 bg-soft-red/10 text-soft-red',
  },
}

type Props = {
  status: ConnectionStatus
  detail?: ConnectionDetail
  onRetry?: () => void
}

export default function ConnectionPill({ status, detail, onRetry }: Props) {
  const [countdown, setCountdown] = useState(startWakeCountdown)
  const inWakeRef = useRef(false)
  const expiredRef = useRef(false)
  const { label, showCountdown, showRetry } = wakePillView(status, countdown, detail)
  const { dot, className } = config[showRetry ? 'unreachable' : status]
  const pill = `inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${className}`
  const busy = showCountdown || status === 'syncing'
  const marker = busy ? (
    <CuteLoader size="sm" label={label} />
  ) : (
    <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
  )

  useEffect(() => {
    if (status === 'live' || status === 'syncing') {
      expiredRef.current = false
      inWakeRef.current = false
      setCountdown((current) => stopWakeCountdown(current))
      return
    }
    // Restart only on a fresh wake episode, never from background retries.
    if (isWakeStatus(status)) {
      if (!inWakeRef.current && !expiredRef.current) setCountdown(startWakeCountdown())
      inWakeRef.current = true
    } else {
      inWakeRef.current = false
    }
  }, [status])

  useEffect(() => {
    if (countdown.stopped && countdown.secondsLeft === 0) expiredRef.current = true
  }, [countdown])

  useEffect(() => {
    if (!showCountdown) return
    const timer = window.setInterval(() => setCountdown(tickWakeCountdown), 1000)
    return () => window.clearInterval(timer)
  }, [showCountdown])

  function handleRetry() {
    expiredRef.current = false
    inWakeRef.current = false
    setCountdown(startWakeCountdown())
    onRetry?.()
  }

  if (showRetry) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <span role="alert" aria-live="assertive" className={pill}>
          {marker}
          <span>{label}</span>
        </span>
        <button
          type="button"
          onClick={handleRetry}
          className="min-h-11 shrink-0 rounded-full border border-soft-red/40 bg-white px-4 py-2 text-sm font-bold text-soft-red hover:bg-soft-blush focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heart-pink"
        >
          Retry
        </button>
      </span>
    )
  }

  return (
    <span role="status" aria-live="polite" className={`${pill} whitespace-nowrap`}>
      {marker}
      {label}
    </span>
  )
}
