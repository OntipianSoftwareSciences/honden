import { useState } from 'react'
import ConnectionPill from '../components/ConnectionPill'
import type { ChatMessage, ConnectionStatus } from '../types'
import type { Thread } from '../store/messages'

type Props = {
  threads: Thread[]
  messages: ChatMessage[]
  connection: ConnectionStatus
  onOpenSettings: () => void
  onOpenThread: (id: string) => void
  onNewThread: (name: string) => void
  onAddUser: () => void
  compact?: boolean
}

export default function EmptyChat({
  threads,
  messages,
  connection,
  onOpenSettings,
  onOpenThread,
  onNewThread,
  onAddUser,
  compact = false,
}: Props) {
  const [newMessage, setNewMessage] = useState(false)
  const [name, setName] = useState('')

  function start() {
    const value = name.trim()
    if (!value) return
    onNewThread(value)
    setName('')
    setNewMessage(false)
  }

  return (
    <main className={`screen-fade h-full w-full bg-warm-cream ${compact ? '' : 'min-h-screen'}`}>
      <div className={`flex h-full w-full flex-col border-0 bg-white ${compact ? '' : 'min-h-screen'}`}>
        <header className={`flex shrink-0 items-center gap-3 border-b border-border ${compact ? 'px-4 py-3' : 'px-6 py-4'}`}>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-soft-blush text-lg" aria-hidden="true">
            🍯
          </span>
          <h2 className="readable-text font-bold text-warm-charcoal">HonDen</h2>
          <ConnectionPill status={connection} />
          {!compact && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="ml-auto rounded-xl border border-border px-4 py-2 text-sm font-bold text-pink-ink hover:bg-soft-blush focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heart-pink"
            >
              Settings
            </button>
          )}
        </header>

        <section className={compact ? 'touch-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4' : 'touch-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-6 py-8 sm:px-10'}>
          <div className={`flex flex-col gap-3 ${compact ? 'mb-4' : 'mb-6 sm:flex-row sm:items-center sm:justify-between'}`}>
            <h1 className={`font-bold text-warm-charcoal ${compact ? 'readable-text' : 'text-[20px]'}`}>Your conversations</h1>
            <div className={`flex flex-col gap-2 ${compact ? 'hidden' : 'sm:flex-row'}`}>
              <button
                type="button"
                onClick={() => setNewMessage(true)}
                className="w-full shrink-0 rounded-xl bg-heart-pink px-4 py-2 text-sm font-bold text-white hover:bg-deep-rose focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heart-pink sm:w-auto"
              >
                New message
              </button>
              <button
                type="button"
                onClick={onAddUser}
                className="w-full shrink-0 rounded-xl border border-border px-4 py-2 text-sm font-bold text-warm-charcoal hover:bg-soft-blush focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heart-pink sm:w-auto"
              >
                Add a user
              </button>
            </div>
          </div>
          <div className="space-y-4">
            {threads.map((thread) => {
              const last = messages
                .filter((message) => message.threadId === thread.id)
                .sort((a, b) => b.timestamp - a.timestamp)[0]
              const savedName = thread.name.trim()
              const label =
                !savedName || savedName.toLowerCase() === 'you'
                  ? `@${thread.username}`
                  : savedName
              const preview = last?.text?.trim()
              const previewText =
                !preview ||
                preview === "This message couldn't be read on this device." ||
                /^\s*\{[\s\S]*"iv"\s*:[\s\S]*"ciphertext"\s*:/.test(preview)
                  ? 'New message'
                  : preview
              const initial = label.charAt(0).toUpperCase() || '#'
              return (
                <button
                  key={thread.id}
                  type="button"
                  onClick={() => onOpenThread(thread.id)}
                  className={`flex w-full items-start gap-3 rounded-2xl text-left hover:bg-warm-cream focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heart-pink ${compact ? 'px-3 py-3' : 'px-5 py-6'}`}
                >
                  <span
                    aria-hidden="true"
                    className={`flex shrink-0 items-center justify-center rounded-full bg-soft-blush font-bold text-pink-ink ${compact ? 'h-10 w-10 text-base' : 'h-14 w-14 text-lg'}`}
                  >
                    {initial}
                  </span>
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="block break-words text-base font-bold text-warm-charcoal">
                      {label}
                    </span>
                    <span className="readable-text block break-words text-soft-grey">
                      {thread.username === 'everyone' ? 'Everyone in HonDen' : `@${thread.username}`}
                    </span>
                    <span className="preview-text mt-1 block text-soft-grey">
                      {previewText}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        {!compact && (
          <div className="border-t border-border px-6 py-4">
            <p className="text-center text-sm text-soft-grey">
              Start a conversation with someone you care about.
            </p>
          </div>
        )}
      </div>

      {newMessage && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-warm-charcoal/30 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-message-title"
            className="w-full max-w-sm rounded-2xl border border-border bg-white p-6 shadow-soft"
          >
            <h2 id="new-message-title" className="mb-3 text-xl font-bold">
              New message
            </h2>
            <p className="mb-4 text-base text-soft-grey">
              Start a conversation with someone you care about.
            </p>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') start()
              }}
              aria-label="Username"
              placeholder="@username"
              className="mb-4 w-full rounded-2xl border border-border bg-white px-4 py-3 text-base text-warm-charcoal placeholder:text-soft-grey focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heart-pink"
            />
            <div className="space-y-3">
              <button
                type="button"
                onClick={start}
                className="w-full rounded-xl bg-heart-pink px-6 py-3 text-base font-bold text-white hover:bg-deep-rose focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heart-pink"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => setNewMessage(false)}
                className="w-full rounded-xl border border-border px-6 py-3 text-base font-bold text-deep-rose hover:bg-soft-blush focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heart-pink"
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
