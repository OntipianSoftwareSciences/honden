import type { ConnectionStatus } from '../types'

const config: Record<
  ConnectionStatus,
  { label: string; dot: string; className: string }
> = {
  live: {
    label: 'Connected 🍯',
    dot: 'bg-leaf-green',
    className: 'border-leaf-green/30 bg-leaf-green/10 text-leaf-green',
  },
  connecting: {
    label: 'Connecting to the honey den…',
    dot: 'bg-warm-amber',
    className: 'border-warm-amber/40 bg-warm-amber/20 text-warm-charcoal',
  },
  reconnecting: {
    label: 'Reconnecting…',
    dot: 'bg-warm-amber',
    className: 'border-warm-amber/40 bg-warm-amber/20 text-warm-charcoal',
  },
  syncing: {
    label: 'Syncing missed messages…',
    dot: 'bg-warm-amber',
    className: 'border-warm-amber/40 bg-warm-amber/20 text-warm-charcoal',
  },
  waking: {
    label: 'Server is waking up…',
    dot: 'bg-warm-amber',
    className: 'border-warm-amber/40 bg-warm-amber/20 text-warm-charcoal',
  },
  disconnected: {
    label: 'Disconnected',
    dot: 'bg-soft-red',
    className: 'border-soft-red/30 bg-soft-red/10 text-soft-red',
  },
}

export default function ConnectionPill({ status }: { status: ConnectionStatus }) {
  const { label, dot, className } = config[status]
  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${className}`}
    >
      <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
      {label}
    </span>
  )
}
