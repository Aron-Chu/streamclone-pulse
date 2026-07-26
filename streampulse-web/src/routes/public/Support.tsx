import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { ChromeInstallCta } from '../../ui/components/ChromeInstallCta'
import { buttonClass } from '../../ui/primitives'
import {
  SUPPORT_CATEGORIES,
  createSupportIdempotencyKey,
  ensureTurnstileScript,
  supportBackendRoot,
  supportFormAvailability,
  validateSupportForm,
  type SupportCategory,
} from '../../lib/supportForm'

type FormState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'validation'; message: string }
  | { kind: 'success'; caseId: string }
  | { kind: 'rate_limit' }
  | { kind: 'unavailable' }

const CATEGORY_LABELS: Record<SupportCategory, string> = {
  bug: 'Bug',
  data_coverage: 'Data / coverage',
  suggestion: 'Suggestion',
  product_complaint: 'Product complaint',
}

type TurnstileAPI = {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string
      callback: (token: string) => void
      'expired-callback'?: () => void
      'error-callback'?: () => void
    },
  ) => string
  reset: (widgetId?: string) => void
  remove: (widgetId?: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileAPI
  }
}

/**
 * Hosted support form (RPR-4).
 * Form is hidden unless a Turnstile site key is present. Backend remains flag-gated (503 until activation).
 */
export default function Support() {
  const siteKey = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim() ?? ''
  const availability = supportFormAvailability(siteKey)

  const [category, setCategory] = useState<SupportCategory>('bug')
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [email, setEmail] = useState('')
  const [contactConsent, setContactConsent] = useState(false)
  const [twitchLogin, setTwitchLogin] = useState('')
  const [consent, setConsent] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState('')
  const [state, setState] = useState<FormState>(
    availability === 'unavailable' ? { kind: 'unavailable' } : { kind: 'idle' },
  )

  const idempotencyKeyRef = useRef<string>(createSupportIdempotencyKey())
  const widgetHostRef = useRef<HTMLDivElement | null>(null)
  const widgetIdRef = useRef<string | null>(null)

  const backendRoot = useMemo(
    () => supportBackendRoot(import.meta.env.VITE_BACKEND_URL as string | undefined),
    [],
  )

  useEffect(() => {
    if (availability !== 'ready' || !siteKey) {
      return
    }
    let cancelled = false
    ensureTurnstileScript(siteKey)
      .then(() => {
        if (cancelled || !widgetHostRef.current || !window.turnstile) {
          return
        }
        if (widgetIdRef.current) {
          window.turnstile.remove(widgetIdRef.current)
          widgetIdRef.current = null
        }
        widgetIdRef.current = window.turnstile.render(widgetHostRef.current, {
          sitekey: siteKey,
          callback: token => {
            setTurnstileToken(token)
            setState(prev => (prev.kind === 'validation' ? { kind: 'idle' } : prev))
          },
          'expired-callback': () => setTurnstileToken(''),
          'error-callback': () => {
            setTurnstileToken('')
            setState({ kind: 'unavailable' })
          },
        })
      })
      .catch(() => {
        if (!cancelled) {
          setState({ kind: 'unavailable' })
        }
      })
    return () => {
      cancelled = true
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current)
        widgetIdRef.current = null
      }
    }
  }, [availability, siteKey])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (availability === 'unavailable') {
      setState({ kind: 'unavailable' })
      return
    }

    const validation = validateSupportForm({
      category,
      subject,
      description,
      consent,
      email,
      contactConsent,
      twitchLogin,
      turnstileToken,
    })
    if (!validation.ok) {
      if (validation.error === 'privacy_redirect') {
        setState({
          kind: 'validation',
          message: 'Privacy and legal requests go to privacy@streampulse.stream — not this form.',
        })
        return
      }
      if (validation.error === 'security_not_accepted') {
        setState({
          kind: 'validation',
          message: 'Security reports are not accepted on this form yet.',
        })
        return
      }
      if (validation.error === 'turnstile_required') {
        setState({
          kind: 'validation',
          message: 'Please complete the bot-protection check before submitting.',
        })
        return
      }
      setState({ kind: 'validation', message: `Please fix the form (${validation.error}).` })
      return
    }

    setState({ kind: 'loading' })
    try {
      const res = await fetch(`${backendRoot}/v1/portal/support/cases`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKeyRef.current,
        },
        body: JSON.stringify({
          category,
          subject: subject.trim(),
          description: description.trim(),
          consent: true,
          email: email.trim() || undefined,
          contact_consent: email.trim() ? contactConsent : undefined,
          twitch_login: twitchLogin.trim() || undefined,
          turnstile_token: turnstileToken,
        }),
      })
      if (res.status === 429) {
        setState({ kind: 'rate_limit' })
        return
      }
      if (res.status === 503) {
        setState({ kind: 'unavailable' })
        return
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setState({
          kind: 'validation',
          message: body?.error ? `Request rejected (${body.error}).` : 'Request rejected.',
        })
        if (window.turnstile && widgetIdRef.current) {
          window.turnstile.reset(widgetIdRef.current)
          setTurnstileToken('')
        }
        return
      }
      const body = (await res.json()) as { case_id?: string }
      if (!body.case_id) {
        setState({ kind: 'unavailable' })
        return
      }
      setState({ kind: 'success', caseId: body.case_id })
      // Next logical submission gets a fresh idempotency key.
      idempotencyKeyRef.current = createSupportIdempotencyKey()
    } catch {
      setState({ kind: 'unavailable' })
    }
  }

  const formVisible = availability === 'ready' && state.kind !== 'unavailable'

  return (
    <PublicLayout>
      <article className="panel public-document" data-testid="support-page">
        <h1>StreamPulse Support</h1>
        <p className="muted">
          Troubleshooting for the Twitch extension and public analytics portal.
        </p>

        <h2>Install StreamPulse</h2>
        <p>
          <ChromeInstallCta className={buttonClass('default', 'sm')} data-cta="chrome-install-support" />
        </p>

        <h2>Extension not appearing on Twitch</h2>
        <ol>
          <li>
            Open <code>chrome://extensions</code> and confirm StreamPulse is enabled.
          </li>
          <li>
            Select <strong>Reload</strong> for StreamPulse.
          </li>
          <li>Hard-refresh the Twitch channel or VOD tab.</li>
          <li>
            Open Twitch chat and look for the <strong>Chat / Pulse</strong> switch above chat.
          </li>
        </ol>

        <h2>Pulse is loading or has limited coverage</h2>
        <p>
          StreamPulse only displays data the backend actually collected. A newly tracked stream can show
          collecting, stats-only, or partial coverage while minute rollups arrive. Check the{' '}
          <Link to="/status">service status</Link> and retry after the next update.
        </p>

        <h2>Contact form</h2>
        <p className="muted">
          The hosted support form stays unavailable until operators enable backend acceptance and configure
          bot protection. This page does not claim the form is live.
        </p>

        {!formVisible ? (
          <p data-testid="support-form-unavailable" role="status" aria-live="polite">
            The hosted form is unavailable right now. For privacy or legal questions only, email{' '}
            <a href="mailto:privacy@streampulse.stream">privacy@streampulse.stream</a>. That address is not
            for routine product support. Security reports are not accepted here.
          </p>
        ) : null}

        {formVisible ? (
          <form data-testid="support-form" onSubmit={onSubmit} className="support-form" aria-busy={state.kind === 'loading'}>
            <label>
              Category
              <select
                value={category}
                onChange={e => setCategory(e.target.value as SupportCategory)}
                aria-required="true"
              >
                {SUPPORT_CATEGORIES.map(value => (
                  <option key={value} value={value}>
                    {CATEGORY_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Subject
              <input
                value={subject}
                maxLength={120}
                onChange={e => setSubject(e.target.value)}
                required
                aria-required="true"
              />
            </label>
            <label>
              Description
              <textarea
                value={description}
                maxLength={4000}
                rows={6}
                onChange={e => setDescription(e.target.value)}
                required
                aria-required="true"
              />
            </label>
            <label>
              Twitch login (optional, typed manually)
              <input value={twitchLogin} onChange={e => setTwitchLogin(e.target.value)} autoComplete="off" />
            </label>
            <label>
              Reply email (optional)
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="email"
              />
            </label>
            {email.trim() ? (
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={contactConsent}
                  onChange={e => setContactConsent(e.target.checked)}
                />
                I consent to being contacted at this email about this report.
              </label>
            ) : null}
            <label className="checkbox">
              <input
                type="checkbox"
                checked={consent}
                onChange={e => setConsent(e.target.checked)}
                aria-required="true"
              />
              I consent to submitting this text to StreamPulse support.
            </label>
            <div
              ref={widgetHostRef}
              data-testid="support-turnstile"
              aria-label="Bot protection challenge"
            />
            <button
              type="submit"
              className={buttonClass('default', 'sm')}
              disabled={state.kind === 'loading'}
              aria-disabled={state.kind === 'loading'}
            >
              {state.kind === 'loading' ? 'Submitting…' : 'Submit'}
            </button>
          </form>
        ) : null}

        {state.kind === 'loading' ? (
          <p data-testid="support-form-loading" role="status" aria-live="polite">
            Submitting your report…
          </p>
        ) : null}
        {state.kind === 'validation' ? (
          <p data-testid="support-form-validation" role="alert" aria-live="assertive">
            {state.message}
          </p>
        ) : null}
        {state.kind === 'rate_limit' ? (
          <p data-testid="support-form-rate-limit" role="alert" aria-live="assertive">
            Too many requests. Please wait and try again.
          </p>
        ) : null}
        {state.kind === 'success' ? (
          <p data-testid="support-form-success" role="status" aria-live="polite">
            Submitted. Case ID: <code>{state.caseId}</code>
          </p>
        ) : null}

        <h2>What to include in a support request</h2>
        <ul>
          <li>Chrome and StreamPulse extension versions.</li>
          <li>The Twitch channel or VOD name (typed manually is fine).</li>
          <li>The exact error message and whether the Chat / Pulse switch appears.</li>
        </ul>
        <p>
          Do not send Twitch cookies, authorization headers, raw chat exports, passwords, or access keys.
          Do not attach screenshots that contain account secrets.
        </p>

        <h2>Contact</h2>
        <p>
          Email <a href="mailto:privacy@streampulse.stream">privacy@streampulse.stream</a> for privacy or
          legal questions only. It is not a routine product-support mailbox.
        </p>
        <p className="muted">
          Dedicated product-support and security channels are not published yet. Do not invent or use
          unverified addresses.
        </p>
        <p>
          You can also review the <Link to="/docs#extension">extension setup guide</Link> or the{' '}
          <Link to="/privacy">privacy policy</Link>.
        </p>
      </article>
    </PublicLayout>
  )
}
