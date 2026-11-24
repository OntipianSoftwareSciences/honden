import { useEffect, useRef, useState } from 'react'
import CuteLoader from './CuteLoader'
import type { ConnectionStatus } from '../types'
import {
  startWakeCountdown,
  stopWakeCountdown,
  tickWakeCountdown,
  type WakeCountdown,
} from '../transport/reliability'

export const connectionLabels: Record<ConnectionStatus, string> = {
  live: 'Connected 🍯',
  connecting: 'Connecting to the honey den…',
  reconnecting: 'Reconnecting…',
  syncing: 'Syncing missed messages…',
  waking: 'Server is waking up…',
  unreachable: 'Cannot reach server, tap Retry',
  disconnected: 'Disconnected',
}

function isWakeStatus(status: ConnectionStatus): boolean {
  return status === 'connecting' || status === 'reconnecting' || status === 'waking'
}

/** Pure view logic so the countdown can be tested without a browser. */
export function wakePillView(
  status: ConnectionStatus,
  countdown: WakeCountdown,
): { label: string; showCountdown: boolean; showRetry: boolean } {
  const expired =
    countdown.stopped &&
    countdown.secondsLeft === 0 &&
    status !== 'live' &&
    status !== 'syncing' &&
    status !== 'disconnected'
  // An early socket failure waits for the countdown to reach 0; no endless loop.
  const showRetry = (status === 'unreachable' && countdown.stopped) || expired
  const showCountdown = isWakeStatus(status) && !showRetry && !countdown.stopped
  return {
    label: showCountdown
      ? `${connectionLabels[status]} ${countdown.secondsLeft}s`
      : connectionLabels[showRetry ? 'unreachable' : status],
    showCountdown,
    showRetry,
  }
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
  onRetry?: () => void
}

export default function ConnectionPill({ status, onRetry }: Props) {
  const [countdown, setCountdown] = useState(startWakeCountdown)
  const inWakeRef = useRef(false)
  const expiredRef = useRef(false)
  const { label, showCountdown, showRetry } = wakePillView(status, countdown)
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
      <span role="alert" aria-live="assertive" className={`${pill} flex-wrap`}>
        {marker}
        <span>{label}</span>
        {onRetry && (
          <button
            type="button"
            onClick={handleRetry}
            className="ml-0.5 rounded-full border border-soft-red/40 px-2 py-0.5 text-[10px] font-bold hover:bg-soft-blush focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heart-pink"
          >
            Retry
          </button>
        )}
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
