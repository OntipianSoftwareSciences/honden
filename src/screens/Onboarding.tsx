import { useState } from 'react'
import CuteLoader from '../components/CuteLoader'
import { apiUrl } from '../api/client'

type Props = {
  onDone: (username: string, notice?: string, token?: string, password?: string) => void | Promise<void>
  invite?: boolean
}

const primaryButton =
  'w-full rounded-xl bg-heart-pink px-6 py-3 text-base font-bold text-white hover:bg-deep-rose focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heart-pink'
const secondaryButton =
  'w-full rounded-xl border border-border px-6 py-3 text-base font-bold text-deep-rose hover:bg-soft-blush focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heart-pink'
const field =
  'w-full rounded-xl border border-border bg-white px-4 py-3 text-base text-warm-charcoal placeholder:text-soft-grey focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heart-pink'
const loginError = "We couldn't find that account. Check the spelling and try again."
const takenError = 'That @username is already taken. Try another one.'
const mismatchError = "Those passwords don't match. Try again."
const recoveryError = "That recovery code doesn't match. Check it and try again."
const rateLimitError = 'Too many tries. Wait a minute and try again.'
const recoveryNotice = 'Your recovery code is still the same. Keep it safe.'
const genericError =
  'Something went wrong on our side. Nothing was sent. Try again in a moment.'

function cleanName(value: string) {
  return value.replace(/^@/, '').toLowerCase()
}

export default function Onboarding({ onDone, invite = false }: Props) {
  const [view, setView] = useState<'invite' | 'login' | 'signup' | 'recovery' | 'reset'>(
    invite ? 'invite' : 'login',
  )
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [resetUsername, setResetUsername] = useState('')
  const [resetCode, setResetCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [copied, setCopied] = useState(false)
  const [recoveryToken, setRecoveryToken] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const backView = invite ? 'invite' : 'login'

  async function login() {
    const name = cleanName(username.trim())
    if (!name || !password || busy) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch(apiUrl('/api/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: name, password }),
      })
      const data = (await response.json()) as { error?: string; token?: string }
      if (!response.ok) {
        setError(data.error ?? loginError)
        return
      }
      await onDone(name, undefined, data.token, password)
    } catch {
      setError(loginError)
    } finally {
      setBusy(false)
    }
  }

  async function createAccount() {
    const name = cleanName(username.trim())
    if (!name || !password || !confirmPassword || busy) return
    if (password !== confirmPassword) {
      setError(mismatchError)
      return
    }
    setBusy(true)
    setError('')
    try {
      const response = await fetch(apiUrl('/api/accounts'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: name, password }),
      })
      const data = (await response.json()) as {
        error?: string
        username?: string
        recoveryCode?: string
        token?: string
      }
      if (!response.ok || !data.recoveryCode) {
        setError(data.error ?? takenError)
        return
      }
      setUsername(data.username ?? name)
      setRecoveryCode(data.recoveryCode)
      setRecoveryToken(data.token ?? '')
      setView('recovery')
    } catch {
      setError(genericError)
    } finally {
      setBusy(false)
    }
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(recoveryCode)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  async function resetPassword() {
    const name = cleanName(resetUsername.trim())
    if (!name || !resetCode.trim() || !newPassword || !confirmNewPassword || busy) return
    if (newPassword !== confirmNewPassword) {
      setError(mismatchError)
      return
    }
    setBusy(true)
    setError('')
    try {
      const response = await fetch(apiUrl('/api/reset'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: name,
          recoveryCode: resetCode,
          newPassword,
          confirmPassword: confirmNewPassword,
        }),
      })
      const data = (await response.json()) as {
        error?: string
        notice?: string
        username?: string
        token?: string
      }
      if (!response.ok) {
        setError(data.error ?? (response.status === 429 ? rateLimitError : recoveryError))
        return
      }
      await onDone(data.username ?? name, data.notice ?? recoveryNotice, data.token, newPassword)
    } catch {
      setError(recoveryError)
    } finally {
      setBusy(false)
    }
  }

  function shell(content: React.ReactNode) {
    return (
      <main className="screen-fade flex min-h-screen flex-col bg-warm-cream">
        <div className="flex flex-1 items-center justify-center px-4 py-10">
          <section className="w-full max-w-md rounded-3xl border border-border bg-white p-8 text-center shadow-soft">
            <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-soft-blush text-2xl" aria-hidden="true">
              🍯
            </div>
            {content}
            <p className="mt-4 text-[0.8125rem] text-soft-grey">
              No ads. No tracking. No selling your data.
            </p>
          </section>
        </div>
      </main>
    )
  }

  if (view === 'invite') {
    return shell(
      <>
        <h1 className="mb-2 text-2xl font-bold">Welcome to HonDen — you've been invited</h1>
        <p className="mb-8 text-base leading-relaxed">
          A sweet, safe den to talk in. Log in or get started to join the conversation.
        </p>
        <button
          type="button"
          className={primaryButton}
          onClick={() => {
            setError('')
            setView('login')
          }}
        >
          Log in
        </button>
        <button
          type="button"
          className={`mt-3 ${secondaryButton}`}
          onClick={() => {
            setError('')
            setView('signup')
          }}
        >
          Get started
        </button>
      </>,
    )
  }

  if (view === 'recovery') {
    return shell(
      <>
        <h1 className="mb-2 text-2xl font-bold">Save this code</h1>
        <p className="mb-6 text-left text-base leading-relaxed">
          This is your recovery code. Write it down somewhere safe — if you forget your
          password, this is the only way back in.
        </p>
        <p className="mb-4 rounded-2xl bg-soft-blush px-4 py-5 text-2xl font-bold tracking-widest text-warm-charcoal">
          {recoveryCode}
        </p>
        <button type="button" className={secondaryButton} onClick={() => void copyCode()}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          type="button"
          className={`mt-3 ${primaryButton}`}
          onClick={() => void onDone(username, undefined, recoveryToken, password)}
        >
          I've saved it
        </button>
      </>,
    )
  }

  if (view === 'reset') {
    return shell(
      <>
        <h1 className="mb-2 text-2xl font-bold">Reset password</h1>
        <p className="mb-8 text-sm text-soft-grey">A sweet, safe den to talk in.</p>
        <form
          className="space-y-3 text-left"
          onSubmit={(event) => {
            event.preventDefault()
            void resetPassword()
          }}
        >
          <input
            className={field}
            value={resetUsername}
            onChange={(event) => setResetUsername(cleanName(event.target.value))}
            aria-label="@username"
            placeholder="@username"
            autoCapitalize="none"
            autoCorrect="off"
          />
          <input
            className={field}
            value={resetCode}
            onChange={(event) => setResetCode(event.target.value.toLowerCase())}
            aria-label="Recovery code"
            placeholder="honey-xxxx-xxxx"
            autoCapitalize="none"
            autoCorrect="off"
          />
          <input
            className={field}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            type="password"
            aria-label="New password"
            placeholder="New password"
          />
          <input
            className={field}
            value={confirmNewPassword}
            onChange={(event) => setConfirmNewPassword(event.target.value)}
            type="password"
            aria-label="Confirm new password"
            placeholder="Confirm new password"
          />
          {error && (
            <p className="rounded-xl bg-soft-blush px-4 py-3 text-sm text-warm-charcoal">
              {error}
            </p>
          )}
          <button type="submit" className={primaryButton} disabled={busy}>
            {busy ? (
              <span className="inline-flex items-center justify-center gap-2">
                <CuteLoader size="sm" label="Resetting password" />
                Resetting…
              </span>
            ) : (
              'Reset password'
            )}
          </button>
        </form>
        <button
          type="button"
          className={`mt-3 ${secondaryButton}`}
          onClick={() => {
            setError('')
            setView(backView)
          }}
        >
          Back
        </button>
      </>,
    )
  }

  if (view === 'signup') {
    return shell(
      <>
        <h1 className="mb-2 text-2xl font-bold">Welcome to HonDen</h1>
        <p className="mb-8 text-sm text-soft-grey">A sweet, safe den to talk in.</p>
        <form
          className="space-y-3 text-left"
          onSubmit={(event) => {
            event.preventDefault()
            void createAccount()
          }}
        >
          <input
            className={field}
            value={username}
            onChange={(event) => setUsername(cleanName(event.target.value))}
            aria-label="@username"
            placeholder="@username"
            autoCapitalize="none"
            autoCorrect="off"
          />
          <input
            className={field}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            aria-label="Password"
            placeholder="Password"
          />
          <input
            className={field}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            type="password"
            aria-label="Confirm password"
            placeholder="Confirm password"
          />
          {error && (
            <p className="rounded-xl bg-soft-blush px-4 py-3 text-sm text-warm-charcoal">
              {error}
            </p>
          )}
          <button type="submit" className={primaryButton} disabled={busy}>
            {busy ? (
              <span className="inline-flex items-center justify-center gap-2">
                <CuteLoader size="sm" label="Creating account" />
                Creating account…
              </span>
            ) : (
              'Create account'
            )}
          </button>
        </form>
        <button
          type="button"
          className={`mt-3 ${secondaryButton}`}
          onClick={() => {
            setError('')
            setView(backView)
          }}
        >
          Back
        </button>
      </>,
    )
  }

  return shell(
    <>
      <h1 className="mb-2 text-2xl font-bold">Welcome to HonDen</h1>
      <p className="mb-8 text-sm text-soft-grey">A sweet, safe den to talk in.</p>
      <form
        className="space-y-3 text-left"
        onSubmit={(event) => {
          event.preventDefault()
          void login()
        }}
      >
        <input
          className={field}
          value={username}
          onChange={(event) => setUsername(cleanName(event.target.value))}
          aria-label="@username"
          placeholder="@username"
          autoCapitalize="none"
          autoCorrect="off"
        />
        <input
          className={field}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          type="password"
          aria-label="Password"
          placeholder="Password"
        />
        {error && (
          <p className="rounded-xl bg-soft-blush px-4 py-3 text-sm text-warm-charcoal">
            {error}
          </p>
        )}
        <button type="submit" className={primaryButton} disabled={busy}>
          {busy ? (
            <span className="inline-flex items-center justify-center gap-2">
              <CuteLoader size="sm" label="Logging in" />
              Logging in…
            </span>
          ) : (
            'Log in'
          )}
        </button>
      </form>
      <button
        type="button"
        className="mt-3 text-sm font-bold text-deep-rose underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heart-pink"
        onClick={() => {
          setError('')
          setView('reset')
        }}
      >
        Forgot your password?
      </button>
      <button
        type="button"
        className={`mt-3 ${secondaryButton}`}
        onClick={() => {
          setError('')
          setView('signup')
        }}
      >
        Get started
      </button>
      {invite && (
        <button
          type="button"
          className="mt-3 text-sm font-bold text-deep-rose underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heart-pink"
          onClick={() => {
            setError('')
            setView('invite')
          }}
        >
          Back
        </button>
      )}
    </>,
  )
}
