import { useEffect, useState } from 'react'
import type { BeforeInstallPromptEvent } from '../hooks/useInstallPrompt'
import type { Settings, ThemeName, UpdateSetting } from '../hooks/useSettings'
import type { LayoutInfo } from '../hooks/useLayoutInfo'
import type { RelayState } from '../transport/channel'
import Toggle from '../components/Toggle'
import HeartMark from '../components/HeartMark'
import { pushSupported, setPushKind, type PushKind } from '../net/push'
import { isAndroidPushRuntime } from '../net/androidNotifications'

type Props = {
  settings: Settings
  update: UpdateSetting
  layout: LayoutInfo
  onBack: () => void
  relayState: RelayState
  peerCount: number
  inviteLink: string
  onNewInvite: () => void
  installPrompt: BeforeInstallPromptEvent | null
  onLogout: () => void
}

const noteText = 'text-[0.8125rem] text-soft-grey'

// Scarlet's Ko-fi page for HonDen support.
const SUPPORT_URL = 'https://ko-fi.com/L7O32B7IIH'

const themeOptions: ReadonlyArray<{ value: ThemeName; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'ultra-dark', label: 'Ultra Dark' },
  { value: 'queen-bee', label: 'Queen Bee' },
]

export default function Settings({
  settings,
  update,
  layout,
  onBack,
  relayState,
  peerCount,
  inviteLink,
  onNewInvite,
  installPrompt,
  onLogout,
}: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [notificationsBlocked, setNotificationsBlocked] = useState(false)
  const [pushSetupError, setPushSetupError] = useState(false)
  const [relayDraft, setRelayDraft] = useState(settings.relayUrl)
  const [copied, setCopied] = useState(false)
  const [showInstallHelp, setShowInstallHelp] = useState(false)
  const [installHandled, setInstallHandled] = useState(false)

  async function changePush(kind: PushKind, enabled: boolean) {
    if (
      !isAndroidPushRuntime() &&
      enabled &&
      typeof Notification !== 'undefined' &&
      Notification.permission !== 'granted'
    ) {
      const permission = await Notification.requestPermission()
      if (permission === 'denied') {
        setNotificationsBlocked(true)
        setPushSetupError(false)
        return
      }
      if (permission !== 'granted') {
        setPushSetupError(true)
        return
      }
    }
    const result = await setPushKind(kind, enabled, {
      callNotifications: settings.callNotifications,
      messageNotifications: settings.gentleNotifications,
    })
    if (result === 'blocked') {
      setNotificationsBlocked(true)
      setPushSetupError(false)
      return
    }
    if (result !== 'ok') {
      setPushSetupError(true)
      return
    }
    setNotificationsBlocked(false)
    setPushSetupError(false)
    update(kind === 'call' ? 'callNotifications' : 'gentleNotifications', enabled)
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteLink)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  useEffect(() => {
    setRelayDraft(settings.relayUrl)
  }, [settings.relayUrl])

  async function installHonDen() {
    if (!installPrompt) {
      setShowInstallHelp(true)
      return
    }

    await installPrompt.prompt()
    const choice = await installPrompt.userChoice
    if (choice.outcome === 'accepted') {
      setInstallHandled(true)
    } else {
      setShowInstallHelp(true)
    }
  }

  return (
    <main className="screen-fade h-[100dvh] w-full bg-warm-cream p-4">
      <div className="mx-auto grid h-full w-full max-w-2xl grid-rows-[auto_minmax(0,1fr)] rounded-3xl border border-border bg-white shadow-soft">
        <header className="flex shrink-0 items-center gap-3 border-b border-border px-6 py-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-2xl bg-soft-blush text-heart-pink">
            <HeartMark size={16} />
          </span>
          <h2 className="text-base font-bold">Settings</h2>
          <button
            type="button"
            onClick={onBack}
            className="ml-auto rounded-xl border border-border px-4 py-2 text-sm font-bold text-deep-rose hover:bg-soft-blush focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heart-pink"
          >
            Back
          </button>
        </header>

        <div data-testid="settings-content" className="touch-scroll min-h-0 space-y-6 overflow-y-auto px-6 py-8">
          <section className="rounded-2xl border border-border bg-warm-cream p-6">
            <h2 className="mb-3 text-sm font-bold text-pink-ink">Theme</h2>
            <div className="flex flex-wrap gap-2">
              {themeOptions.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={settings.theme === value}
                  onClick={() => update('theme', value)}
                  className={`min-h-11 rounded-xl border px-4 py-2 text-sm font-bold transition ${
                    settings.theme === value
                      ? 'border-heart-pink bg-heart-pink text-white'
                      : 'border-border text-warm-charcoal hover:bg-soft-blush'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className={`mt-3 ${noteText}`}>
              Choose the look that feels best. The change applies right away and is remembered.
            </p>
          </section>

          <section className="rounded-2xl border border-border bg-warm-cream p-6">
            <h2 className="mb-2 text-sm font-bold text-pink-ink">
              Support us for more themes
            </h2>
            <p className="readable-text text-warm-charcoal">
              Support us for more themes — HonDen is free, no ads, no tracking, no selling your
              data. Supporting us helps us make more themes, stickers, and sounds.
            </p>
            <p className={`mt-2 ${noteText}`}>
              Queen Bee is free for everyone. Future themes are a supporter perk; core messaging
              and calls always stay free.
            </p>
            <a
              href={SUPPORT_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl border border-heart-pink px-4 py-2 text-sm font-bold text-pink-ink transition hover:bg-soft-blush focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heart-pink"
            >
              Support HonDen on Ko-fi
            </a>
          </section>

          <section className="rounded-2xl border border-border bg-warm-cream p-6">
            <h2 className="mb-2 text-sm font-bold text-pink-ink">Layout</h2>
            <p className="readable-text break-words text-warm-charcoal" data-testid="layout-info">
              {layout.label}
            </p>
          </section>

          <section className="rounded-2xl border border-border bg-warm-cream p-6">
            <h2 className="mb-2 text-sm font-bold text-pink-ink">Install on Android</h2>
            <p className="mb-4 text-base">
              Install HonDen on your phone, so it's always there when you need it.
            </p>
            {!installHandled &&
              (!installPrompt || showInstallHelp ? (
                <p className="rounded-xl bg-soft-blush px-4 py-3 text-sm text-warm-charcoal">
                  To install: open HonDen in Chrome on your phone, tap the three dots,
                  then Add to Home Screen.
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => void installHonDen()}
                  className="w-full rounded-xl bg-heart-pink px-6 py-3 text-base font-bold text-white hover:bg-deep-rose focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heart-pink"
                >
                  Install HonDen
                </button>
              ))}
            <p className={`mt-3 ${noteText}`}>
              Installs from Chrome, no download needed.
            </p>
          </section>

          <section className="rounded-2xl border border-border bg-warm-cream p-6">
            <h2 className="mb-2 text-sm font-bold text-deep-rose">Privacy</h2>
            <p className="mb-4 text-base">Messages are encrypted end-to-end.</p>

            <div className="flex items-center justify-between gap-4 border-t border-border py-4">
              <div>
                <p className="font-bold">Read receipts</p>
                <p className={noteText}>
                  They'll see when you've read a message. You can turn this on.
                </p>
              </div>
              <Toggle
                label="Read receipts"
                checked={settings.readReceipts}
                onChange={(next) => update('readReceipts', next)}
              />
            </div>

            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="flex w-full items-center justify-between gap-4 border-t border-border py-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heart-pink"
            >
              <span>
                <span className="block font-bold">Delete for everyone</span>
                <span className={`block ${noteText}`}>
                  You can delete a message for everyone, anytime.
                </span>
              </span>
            </button>

            <div className="flex items-center justify-between gap-4 border-t border-border py-4">
              <div>
                <p className="font-bold">Export your chats</p>
                <p className={noteText}>Download a copy of your chats anytime.</p>
              </div>
            </div>

            <p className="mt-4 rounded-xl bg-soft-blush px-4 py-3 text-sm text-warm-charcoal">
              No ads. No tracking. No selling your data.
            </p>
          </section>

          <section className="rounded-2xl border border-border bg-warm-cream p-6">
            <h2 className="mb-2 text-sm font-bold text-deep-rose">Connection</h2>
            <p className="mb-4 text-base">
              Open HonDen in another tab to sync instantly.
            </p>
            <p className={`mb-4 ${noteText}`}>
              {peerCount > 0
                ? 'A peer is listening.'
                : 'No other HonDen window is listening yet.'}
            </p>

            <div className="flex items-center justify-between gap-4 border-t border-border py-4">
              <div>
                <p className="font-bold">Simulated replies</p>
                <p className={noteText}>A gentle reply when no peer is here.</p>
              </div>
              <Toggle
                label="Simulated replies"
                checked={settings.simulateReplies}
                onChange={(next) => update('simulateReplies', next)}
              />
            </div>

            <div className="border-t border-border py-4">
              <p className="font-bold">WebSocket relay</p>
              <p className={`mb-3 ${noteText}`}>
                Optional. Only encrypted messages are sent.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  value={relayDraft}
                  onChange={(event) => setRelayDraft(event.target.value)}
                  aria-label="WebSocket relay URL"
                  placeholder="ws://..."
                  className="min-w-0 flex-1 rounded-xl border border-border bg-white px-4 py-2 text-base text-warm-charcoal placeholder:text-soft-grey focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heart-pink"
                />
                <button
                  type="button"
                  onClick={() => update('relayUrl', relayDraft.trim())}
                  className="rounded-xl bg-heart-pink px-4 py-2 text-sm font-bold text-white hover:bg-deep-rose focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heart-pink"
                >
                  Connect
                </button>
                {settings.relayUrl.trim() && (
                  <button
                    type="button"
                    onClick={() => update('relayUrl', '')}
                    className="rounded-xl border border-border px-4 py-2 text-sm font-bold text-deep-rose hover:bg-soft-blush focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heart-pink"
                  >
                    Disconnect
                  </button>
                )}
              </div>
              <p className={`mt-2 ${noteText}`}>Relay: {relayState}</p>
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-warm-cream p-6">
            <h2 className="mb-2 text-sm font-bold text-deep-rose">
              Invite a friend
            </h2>
            <p className={`mb-4 ${noteText}`}>
              Send this link to someone you trust. Only people with the link can
              read your messages — we can't.
            </p>
            <input
              type="text"
              readOnly
              value={inviteLink}
              aria-label="Invite link"
              onFocus={(event) => event.currentTarget.select()}
              className="mb-3 w-full rounded-xl border border-border bg-white px-4 py-2 text-sm text-warm-charcoal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heart-pink"
            />
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => void copyInvite()}
                className="rounded-xl bg-heart-pink px-4 py-2 text-sm font-bold text-white hover:bg-deep-rose focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heart-pink"
              >
                {copied ? 'Copied' : 'Copy invite link'}
              </button>
              <button
                type="button"
                onClick={onNewInvite}
                className="rounded-xl border border-border px-4 py-2 text-sm font-bold text-deep-rose hover:bg-soft-blush focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heart-pink"
              >
                Make a new link
              </button>
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-warm-cream p-6">
            <h2 className="mb-2 text-sm font-bold text-deep-rose">
              Notifications
            </h2>
            <div className="flex items-center justify-between gap-4 py-2">
              <div>
                <p className="font-bold">Gentle notifications</p>
                <p className={noteText}>You have a new message.</p>
              </div>
              <Toggle
                label="Gentle notifications"
                checked={settings.gentleNotifications}
                onChange={(next) => void changePush('message', next)}
              />
            </div>
            {pushSupported() && (
              <div className="flex items-center justify-between gap-4 py-2">
                <div>
                  <p className="font-bold">Call notifications</p>
                  <p className={noteText}>Incoming calls, even when HonDen is not in focus.</p>
                  {notificationsBlocked && (
                    <p className={noteText}>
                      {isAndroidPushRuntime()
                        ? 'Notifications are blocked on this device. Allow them in Android Settings > Notifications > HonDen, then try again.'
                        : 'Notifications are blocked in Firefox. Allow them in Firefox Settings > Privacy > Notifications for honden.onrender.com, then try again.'}
                    </p>
                  )}
                  {pushSetupError && (
                    <p className={noteText}>
                      {isAndroidPushRuntime()
                        ? 'Alerts are unavailable on this device right now. Try again.'
                        : 'Push notifications are unavailable right now. The site needs its VAPID keys configured on the server, then try again.'}
                    </p>
                  )}
                </div>
                <Toggle
                  label="Call notifications"
                  checked={settings.callNotifications}
                  onChange={(next) => void changePush('call', next)}
                />
              </div>
            )}
            <p className={`mt-3 ${noteText}`}>
              On iPhone, push only works after Add to Home Screen, open from the Home Screen icon,
              and Allow notifications there. It will not work in a regular Safari tab.
            </p>
          </section>

          <section className="rounded-2xl border border-border bg-warm-cream p-6">
            <h2 className="mb-2 text-sm font-bold text-deep-rose">Sounds</h2>
            <div className="flex items-center justify-between gap-4 py-2">
              <div>
                <p className="font-bold">Sounds</p>
                <p className={noteText}>Short, quiet chiptune cues.</p>
              </div>
              <Toggle
                label="Sounds"
                checked={settings.sounds}
                onChange={(next) => update('sounds', next)}
              />
            </div>
            <label className="mt-3 block">
              <span className="font-bold">Volume</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={settings.soundVolume}
                disabled={!settings.sounds}
                onChange={(event) => update('soundVolume', Number(event.target.value))}
                aria-label="Sound volume"
                className="mt-2 w-full accent-heart-pink disabled:opacity-50"
              />
            </label>
          </section>

          <section className="rounded-2xl border border-border bg-warm-cream p-6">
            <h2 className="mb-2 text-sm font-bold text-deep-rose">
              Accessibility
            </h2>
            <div className="flex items-center justify-between gap-4 py-2">
              <p className="font-bold">Large text</p>
              <Toggle
                label="Large text"
                checked={settings.largeText}
                onChange={(next) => update('largeText', next)}
              />
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-warm-cream p-6">
            <h2 className="mb-2 text-sm font-bold text-deep-rose">Account</h2>
            <p className={`mb-4 ${noteText}`}>
              You can come back with your username and password.
            </p>
            <button
              type="button"
              onClick={onLogout}
              className="w-full rounded-xl border border-border px-6 py-3 text-base font-bold text-deep-rose hover:bg-soft-blush focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heart-pink"
            >
              Log out
            </button>
          </section>

          <footer className="border-t border-border px-6 py-6 text-center">
            <p className="font-bold">Made with care by HonDen</p>
            <p className={`mt-1 ${noteText}`}>
              Questions? We actually read our messages.{' '}
              <button
                type="button"
                className="text-deep-rose underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heart-pink"
              >
                Contact us
              </button>
            </p>
          </footer>
        </div>
      </div>

      {confirmDelete && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-warm-charcoal/30 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-title"
            className="w-full max-w-sm rounded-2xl border border-border bg-white p-6 shadow-soft"
          >
            <h2 id="delete-title" className="mb-3 text-xl font-bold">
              Delete this message?
            </h2>
            <p className="mb-6 text-base text-soft-grey">
              This will delete it for everyone in this chat. This can't be
              undone.
            </p>
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="w-full rounded-xl bg-soft-red px-6 py-3 text-base font-bold text-white hover:bg-deep-rose focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heart-pink"
              >
                Delete for everyone
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="w-full rounded-xl bg-heart-pink px-6 py-3 text-base font-bold text-white hover:bg-deep-rose focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heart-pink"
              >
                Keep it
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
