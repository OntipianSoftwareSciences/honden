import { useState } from 'react'
import CuteLoader from './CuteLoader'
import { normalizeKoFiUrl } from '../net/artistShare'
import type {
  AccountUser,
  DeviceSession,
  PresenceStatus,
  ProfilePatch,
} from '../types'

type ProfileModalProps = {
  user: AccountUser
  onClose: () => void
  onSave: (patch: ProfilePatch) => Promise<void> | void
}

type SecurityModalProps = {
  devices: DeviceSession[]
  onClose: () => void
  onRevoke: (deviceId: string) => Promise<void> | void
  onSignOut: () => void
}

const avatarColors = [
  '#8B5CF6',
  '#22D3EE',
  '#F472B6',
  '#34D399',
  '#FBBF24',
  '#60A5FA',
  '#FB7185',
  '#A3E635',
]

const statuses: Array<{ value: PresenceStatus; label: string }> = [
  { value: 'online', label: 'Online' },
  { value: 'dnd', label: 'Do not disturb' },
  { value: 'offline', label: 'Offline' },
]

function initials(name: string) {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

export function ProfileModal({ user, onClose, onSave }: ProfileModalProps) {
  const [displayName, setDisplayName] = useState(user.displayName)
  const [bio, setBio] = useState(user.bio)
  const [status, setStatus] = useState<PresenceStatus>(user.status)
  const [avatarColor, setAvatarColor] = useState(user.avatarColor)
  const [koFiUrl, setKoFiUrl] = useState(user.koFiUrl ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    if (!displayName.trim()) return
    const normalizedKoFi = koFiUrl.trim() ? normalizeKoFiUrl(koFiUrl) : null
    if (koFiUrl.trim() && !normalizedKoFi) {
      setError('Use a Ko-fi link like https://ko-fi.com/yourname')
      return
    }
    setError('')
    setSaving(true)
    try {
      await onSave({
        displayName: displayName.trim(),
        bio: bio.trim(),
        status,
        avatarColor,
        koFiUrl: normalizedKoFi,
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#03050d]/80 p-4 backdrop-blur-xl">
      <div className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-cyan-300/20 bg-[#0a0f20]/95 p-6 shadow-[0_0_70px_rgba(34,211,238,0.18)]">
        <div className="pointer-events-none absolute -top-20 -right-16 h-48 w-48 rounded-full bg-fuchsia-500/25 blur-3xl" />
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-cyan-300/80">
              HonDen · Account
            </p>
            <h2 className="mt-1 text-2xl font-semibold text-white">Edit profile</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close profile"
            className="rounded-lg px-2 py-1 text-slate-400 transition hover:bg-white/5 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="relative mt-6 flex items-center gap-4">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/20 text-xl font-bold text-slate-950 shadow-lg"
            style={{ backgroundColor: avatarColor }}
          >
            {initials(displayName || user.username)}
          </div>
          <div>
            <p className="text-lg font-semibold text-white">{displayName || 'Your name'}</p>
            <p className="font-mono text-xs text-cyan-300/80">@{user.username}</p>
          </div>
        </div>

        <div className="relative mt-6 space-y-4">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Display name
            </span>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={80}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-300/40"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Bio
            </span>
            <textarea
              value={bio}
              onChange={(event) => setBio(event.target.value)}
              rows={2}
              maxLength={240}
              className="w-full resize-none rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-300/40"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Ko-fi link for tips
            </span>
            <input
              type="url"
              value={koFiUrl}
              onChange={(event) => setKoFiUrl(event.target.value)}
              maxLength={200}
              placeholder="https://ko-fi.com/yourname"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-300/40"
            />
            <span className="mt-1 block text-[11px] text-slate-500">
              Leave blank if you don't want a Tip button. No in-app payments.
            </span>
          </label>

          {error && <p className="text-xs text-rose-300">{error}</p>}

          <div>
            <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Presence
            </span>
            <div className="flex flex-wrap gap-2">
              {statuses.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setStatus(item.value)}
                  className={`rounded-xl border px-3 py-2 text-xs font-medium transition ${
                    status === item.value
                      ? 'border-cyan-300/40 bg-cyan-400/15 text-cyan-100'
                      : 'border-white/10 bg-white/5 text-slate-400 hover:text-slate-100'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Avatar color
            </span>
            <div className="flex flex-wrap gap-2">
              {avatarColors.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`Use ${color}`}
                  onClick={() => setAvatarColor(color)}
                  className={`h-9 w-9 rounded-xl border-2 transition ${
                    avatarColor === color
                      ? 'scale-110 border-white'
                      : 'border-white/10 hover:border-white/40'
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="relative mt-7 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="rounded-xl bg-cyan-400 px-5 py-2 text-sm font-semibold text-slate-950 shadow-[0_0_25px_rgba(34,211,238,0.3)] transition hover:bg-cyan-300 disabled:opacity-50"
          >
            {saving ? (
              <span className="inline-flex items-center justify-center gap-2">
                <CuteLoader size="sm" label="Saving profile" />
                Saving…
              </span>
            ) : (
              'Save profile'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export function SecurityModal({
  devices,
  onClose,
  onRevoke,
  onSignOut,
}: SecurityModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#03050d]/80 p-4 backdrop-blur-xl">
      <div className="relative w-full max-w-xl overflow-hidden rounded-3xl border border-fuchsia-300/20 bg-[#0a0f20]/95 p-6 shadow-[0_0_70px_rgba(217,70,239,0.16)]">
        <div className="pointer-events-none absolute -top-20 -left-16 h-48 w-48 rounded-full bg-fuchsia-500/20 blur-3xl" />
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-fuchsia-300/80">
              HonDen · Security
            </p>
            <h2 className="mt-1 text-2xl font-semibold text-white">Sessions</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sessions"
            className="rounded-lg px-2 py-1 text-slate-400 transition hover:bg-white/5 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="relative mt-6 max-h-72 space-y-2 overflow-y-auto">
          {devices.length === 0 ? (
            <p className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-slate-400">
              No active device sessions.
            </p>
          ) : (
            devices.map((device) => (
              <div
                key={device.id}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-fuchsia-400/15 text-fuchsia-200">
                  ◈
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-100">
                    {device.platform || 'Unknown device'}
                  </p>
                  <p className="truncate font-mono text-[10px] text-slate-500">
                    {device.deviceId.slice(0, 12)} · {device.lastSeen}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void onRevoke(device.id)}
                  className="rounded-lg border border-rose-300/30 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-200 transition hover:bg-rose-500/20"
                >
                  Revoke
                </button>
              </div>
            ))
          )}
        </div>

        <div className="relative mt-7 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/10"
          >
            Close
          </button>
          <button
            type="button"
            onClick={onSignOut}
            className="rounded-xl bg-rose-500 px-5 py-2 text-sm font-semibold text-white shadow-[0_0_25px_rgba(244,63,94,0.3)] transition hover:bg-rose-400"
          >
            Sign out everywhere
          </button>
        </div>
      </div>
    </div>
  )
}
