import CuteLoader from './CuteLoader'
import type { ConnectionStatus } from '../types'

export const connectionLabels: Record<ConnectionStatus, string> = {
  live: 'Connected 🍯',
  connecting: 'Connecting to the honey den…',
  reconnecting: 'Reconnecting…',
  syncing: 'Syncing missed messages…',
  waking: 'Server is waking up…',
  unreachable: 'Cannot reach server, tap Retry',
  disconnected: 'Disconnected',
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
  const { label, dot, className } = config[status]
  const pill = `inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${className}`
  const busy =
    status === 'connecting' ||
    status === 'reconnecting' ||
    status === 'syncing' ||
    status === 'waking'
  const marker = busy ? (
    <CuteLoader size="sm" label={label} />
  ) : (
    <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
  )

  if (status === 'unreachable') {
    return (
      <span role="alert" aria-live="assertive" className={`${pill} flex-wrap`}>
        {marker}
        <span>{label}</span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
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
