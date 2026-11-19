import { useEffect, useRef, useState } from 'react'
import type { StoredMessage } from '../store/messages'

type Props = {
  name: string
  threadId: string
  messages: StoredMessage[]
  readReceipts: boolean
  peerCount: number
  onBack: () => void
  onSend: (threadId: string, text: string) => void | Promise<void>
  onDelete: (id: string, threadId: string) => void
}

export default function Chat({
  name,
  threadId,
  messages,
  readReceipts,
  peerCount,
  onBack,
  onSend,
  onDelete,
}: Props) {
  const [draft, setDraft] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [showCipher, setShowCipher] = useState(false)
  const bottom = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  function send() {
    console.log('Send tapped', { threadId, draft })
    const text = draft.trim()
    if (!text) return
    console.log('sendMessage() called', { text, chatId: threadId, user: name })
    void onSend(threadId, text)
    setDraft('')
  }

  function removeSelected() {
    if (!selected) return
    onDelete(selected, threadId)
    setSelected(null)
  }

  return (
    <main className="screen-fade min-h-screen bg-warm-cream p-4">
      <div className="mx-auto flex h-[calc(100vh-2rem)] w-full max-w-3xl flex-col rounded-3xl border border-border bg-white shadow-soft">
        <header className="flex items-center gap-3 border-b border-border px-6 py-4">
          <button
            type="button"
            onClick={onBack}
            className="rounded-xl border border-border px-4 py-2 text-sm font-bold text-deep-rose hover:bg-soft-blush focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heart-pink"
          >
            Back
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold">{name}</h1>
              <span
                aria-label={peerCount > 0 ? 'Online' : 'Waiting for a peer'}
                className={`h-2 w-2 rounded-full ${
                  peerCount > 0 ? 'bg-leaf-green' : 'bg-warm-amber'
                }`}
              />
            </div>
            <p className="text-[0.8125rem] text-soft-grey">
              Only you and {name} can read this.
            </p>
          </div>
          <button
            type="button"
            aria-pressed={showCipher}
            onClick={() => setShowCipher((current) => !current)}
            className="ml-auto rounded-xl border border-border px-3 py-2 text-xs font-bold text-deep-rose hover:bg-soft-blush focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heart-pink"
          >
            Ciphertext
          </button>
        </header>

        <section className="flex-1 space-y-4 overflow-y-auto px-6 py-6">
          {messages.length === 0 && (
            <p className="py-10 text-center text-base text-soft-grey">
              No messages yet. Say hello — they'll be glad to hear from you.
            </p>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${
                message.from === 'me' ? 'justify-end' : 'justify-start'
              }`}
            >
              <button
                type="button"
                onClick={() => setSelected(message.id)}
                className={`max-w-[80%] rounded-2xl px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heart-pink ${
                  message.from === 'me'
                    ? 'bg-soft-blush'
                    : 'border border-border bg-white'
                }`}
              >
                <span className="block text-base text-warm-charcoal">
                  {message.text || 'Encrypted message'}
                </span>
                {showCipher && (
                  <span className="mt-2 block break-all rounded-lg bg-white/60 px-2 py-1 font-mono text-[0.6875rem] text-soft-grey">
                    {message.payload.iv} · {message.payload.ciphertext}
                  </span>
                )}
                <span className="mt-1 block text-right text-[0.8125rem] text-soft-grey">
                  {message.time}
                  {message.from === 'me' && readReceipts ? ' · Seen' : ''}
                </span>
              </button>
            </div>
          ))}
          <div ref={bottom} />
        </section>

        <footer className="border-t border-border px-6 py-4">
          <div className="flex items-end gap-3">
            <input
              type="text"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') send()
              }}
              aria-label="Message"
              placeholder="Start a conversation with someone you care about."
              className="min-h-12 flex-1 rounded-2xl border border-border bg-white px-4 py-3 text-base text-warm-charcoal placeholder:text-soft-grey focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heart-pink"
            />
            <button
              type="button"
              onClick={send}
              className="rounded-xl bg-heart-pink px-6 py-3 text-base font-bold text-white hover:bg-deep-rose focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heart-pink"
            >
              Send
            </button>
          </div>
          <p className="mt-2 text-center text-[0.8125rem] text-soft-grey">
            Only you and {name} can read this.
          </p>
        </footer>
      </div>

      {selected && (
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
                onClick={removeSelected}
                className="w-full rounded-xl bg-soft-red px-6 py-3 text-base font-bold text-white hover:bg-deep-rose focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heart-pink"
              >
                Delete for everyone
              </button>
              <button
                type="button"
                onClick={() => setSelected(null)}
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
