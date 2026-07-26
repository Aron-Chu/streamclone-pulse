/** @deprecated Route `/login` redirects to `/analytics`. Quarantined beta-key screen. */
import { FormEvent, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { apiClient, type ApiError } from '../../lib/apiClient'
import { setBetaKey } from '../../lib/auth'
import { PublicLayout } from '../../ui/components/PublicLayout'

const REQUEST_ACCESS_GITHUB = 'https://github.com/Aron-Chu/streamclone-pulse'
const REQUEST_ACCESS_DISCORD = 'https://discord.gg/streampulse'
const CHROME_EXTENSION_URL =
  'https://chrome.google.com/webstore/detail/streamclone-pulse/placeholder'

export default function Login() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [betaKey, setBetaKeyField] = useState('')
  const [errorHint, setErrorHint] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setErrorHint(null)
    const trimmed = betaKey.trim()
    if (!trimmed) return

    setBusy(true)
    await setBetaKey(trimmed)

    try {
      await apiClient('/v1/extension/pulse/channels/xqc', { gated: true })
    } catch (error) {
      const apiError = error as ApiError
      if (apiError.kind === 'unauthorized') {
        setErrorHint(apiError.hint ?? 'Set X-Streamclone-Beta-Key header (Pulse extension options)')
        setBusy(false)
        return
      }
    }

    const next = searchParams.get('next')
    navigate(next && next.startsWith('/') ? next : '/dashboard', { replace: true })
    setBusy(false)
  }

  return (
    <PublicLayout>
      <section className="panel panel--elevated" style={{ maxWidth: '32rem', margin: '0 auto' }}>
        <h1>Connect StreamPulse</h1>
        <p className="muted">
          <strong>Private operator route.</strong> Public analytics at{' '}
          <Link to="/analytics">/analytics</Link> does not require a beta key. This screen is for
          private dashboard access only.
        </p>
        <p className="muted">Enter your beta key to open the private workspace dashboard.</p>

        <form className="stack-md" onSubmit={(event) => void handleSubmit(event)}>
          <div>
            <label className="field-label" htmlFor="login-beta-key">
              Beta key
            </label>
            <input
              id="login-beta-key"
              className="field-input"
              value={betaKey}
              onChange={(event) => setBetaKeyField(event.target.value)}
              placeholder="PULSE-____-____-____"
              autoComplete="off"
            />
          </div>

          {errorHint ? (
            <div className="alert alert-error" role="alert">
              {errorHint}
            </div>
          ) : null}

          <button type="submit" className="btn btn-primary" disabled={busy || !betaKey.trim()}>
            {busy ? 'Connecting…' : 'Connect'}
          </button>
        </form>

        <p className="muted" style={{ marginTop: '1.5rem' }}>
          Don&apos;t have a key? StreamPulse is in private beta — request access on{' '}
          <a href={REQUEST_ACCESS_GITHUB} target="_blank" rel="noreferrer">
            GitHub
          </a>{' '}
          or{' '}
          <a href={REQUEST_ACCESS_DISCORD} target="_blank" rel="noreferrer">
            Discord
          </a>
          .
        </p>

        <p className="muted" style={{ marginTop: '1rem' }}>
          Need the Twitch overlay?{' '}
          <a href={CHROME_EXTENSION_URL} target="_blank" rel="noreferrer">
            Install the Chrome extension
          </a>{' '}
          and set backend URL or beta key in extension Options — not on this page.
        </p>
      </section>
    </PublicLayout>
  )
}
