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
}

export default function EmptyChat({
  threads,
  messages,
  connection,
  onOpenSettings,
  onOpenThread,
  onNewThread,
  onAddUser,
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
    <main className="screen-fade h-full min-h-screen w-full bg-warm-cream">
      <div className="flex min-h-screen w-full flex-col border-0 bg-white">
        <header className="flex items-center gap-3 border-b border-border px-6 py-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-2xl bg-soft-blush text-lg" aria-hidden="true">
            🍯
          </span>
          <h2 className="text-base font-bold text-warm-charcoal">HonDen</h2>
          <ConnectionPill status={connection} />
          <button
            type="button"
            onClick={onOpenSettings}
            className="ml-auto rounded-xl border border-border px-4 py-2 text-sm font-bold text-deep-rose hover:bg-soft-blush focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heart-pink"
          >
            Settings
          </button>
        </header>

        <section className="flex-1 px-6 py-8 sm:px-10">
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h1 className="text-[20px] font-bold text-warm-charcoal">Your conversations</h1>
            <div className="flex flex-col gap-2 sm:flex-row">
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
                  className="flex w-full items-start gap-4 rounded-2xl px-5 py-6 text-left hover:bg-warm-cream focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heart-pink"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-soft-blush text-lg font-bold text-deep-rose"
                  >
                    {initial}
                  </span>
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="block truncate text-base font-bold text-warm-charcoal">
                      {label}
                    </span>
                    <span className="block truncate text-[13px] text-soft-grey">
                      {thread.username === 'everyone' ? 'Everyone in HonDen' : `@${thread.username}`}
                    </span>
                    <span className="mt-2 block truncate text-[13px] text-soft-grey">
                      {previewText}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        <div className="border-t border-border px-6 py-4">
          <p className="text-center text-sm text-soft-grey">
            Start a conversation with someone you care about.
          </p>
        </div>
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
