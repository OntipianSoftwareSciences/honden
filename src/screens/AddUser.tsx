import { useState } from 'react'
import { joinUrl } from '../net/invite'
import { normalizeUsername } from '../store/messages'

type Props = {
  onAdd: (username: string) => boolean | Promise<boolean>
  onBack: () => void
}

export default function AddUser({ onAdd, onBack }: Props) {
  const [username, setUsername] = useState('')
  const [error, setError] = useState('')
  const [link, setLink] = useState('')

  async function add() {
    const value = normalizeUsername(username)
    const found = value ? await onAdd(value) : false
    if (!found) {
      const shown = value || username.trim().replace(/^@/, '')
      setError(`We couldn't find @${shown}. Check the spelling and try again.`)
      return
    }
    setError('')
    setUsername('')
    onBack()
  }

  function createInviteLink() {
    const token = Math.random().toString(36).slice(2, 8)
    setLink(joinUrl(`honey-${token}`))
  }

  function copyLink() {
    void navigator.clipboard.writeText(link)
  }

  return (
    <main className="screen-fade min-h-screen w-full bg-warm-cream p-2 sm:p-4">
      <div className="mx-auto flex min-h-[calc(100vh-1rem)] w-full max-w-3xl flex-col rounded-3xl border border-border bg-white shadow-soft sm:min-h-[calc(100vh-2rem)]">
        <header className="flex items-center gap-3 border-b border-border px-6 py-4">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="rounded-lg px-2 py-1 text-warm-charcoal transition hover:bg-warm-cream"
          >
            ←
          </button>
          <h1 className="text-[20px] font-bold text-warm-charcoal">Add a user</h1>
        </header>

        <section className="flex-1 space-y-6 px-6 py-6">
          <div className="rounded-2xl border border-border bg-white p-4">
            <h2 className="mb-4 text-base font-bold text-warm-charcoal">Add by username</h2>
            <input
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void add()
              }}
              aria-label="Username"
              placeholder="@username"
              className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-base text-warm-charcoal placeholder:text-soft-grey focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heart-pink"
            />
            {error && (
              <p className="mt-3 text-[13px] text-warm-charcoal">{error}</p>
            )}
            <button
              type="button"
              onClick={() => void add()}
              className="mt-4 w-full rounded-xl bg-heart-pink px-6 py-3 text-base font-bold text-white transition hover:bg-deep-rose"
            >
              Add
            </button>
          </div>

          <div className="rounded-2xl border border-border bg-white p-4">
            <h2 className="mb-4 text-base font-bold text-warm-charcoal">Send an invite</h2>
            <button
              type="button"
              onClick={createInviteLink}
              className="w-full rounded-xl border border-border px-6 py-3 text-base font-bold text-warm-charcoal transition hover:bg-warm-cream"
            >
              Create invite link
            </button>
            {link && (
              <div className="mt-4 space-y-3">
                <p className="break-all rounded-xl bg-warm-cream px-3 py-2 text-[13px] text-warm-charcoal">
                  {link}
                </p>
                <p className="text-[13px] text-soft-grey">Expires in 24 hours</p>
                <button
                  type="button"
                  onClick={copyLink}
                  className="w-full rounded-xl bg-heart-pink px-6 py-3 text-base font-bold text-white transition hover:bg-deep-rose"
                >
                  Copy
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}
