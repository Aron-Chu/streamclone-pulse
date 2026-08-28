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
        <header className="mb-6 border-b border-white/[0.08] pb-6">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="inline-flex items-center gap-1.5 rounded bg-violet-500/10 px-2.5 py-1 text-xs font-bold text-violet-300">
              <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
              StreamPulse Help & Diagnostic Desk
            </span>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-white lg:text-4xl">Support & Troubleshooting</h1>
          <p className="mt-2 text-base text-zinc-400">
            Troubleshooting for the Twitch Chrome extension, coverage states, and public analytics portal.
          </p>
        </header>

        {/* Self-Help / Quick Diagnostics Grid */}
        <div className="feature-grid">
          <div className="feature-card">
            <span className="feature-card__badge text-cyan-300">Quick Fix 01</span>
            <h3>Extension Not Appearing?</h3>
            <p>
              Open <code>chrome://extensions</code>, confirm StreamPulse is enabled, select <strong>Reload</strong>, and hard-refresh your Twitch tab.
            </p>
          </div>
          <div className="feature-card">
            <span className="feature-card__badge text-amber-300">Quick Fix 02</span>
            <h3>Limited Coverage / Warming?</h3>
            <p>
              New streams take 1–3 minutes to warm up IRC collectors. Check the <Link to="/status" className="text-violet-400 hover:underline">live system status</Link> for telemetry.
            </p>
          </div>
          <div className="feature-card">
            <span className="feature-card__badge text-emerald-300">Install Guide</span>
            <h3>Official Chrome Listing</h3>
            <p>
              Install the verified Manifest V3 build directly from the official Chrome Web Store.
            </p>
          </div>
        </div>

        <section id="install" className="mt-6">
          <h2>Install StreamPulse</h2>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <ChromeInstallCta className={buttonClass('default', 'sm')} data-cta="chrome-install-support" />
            <span className="text-xs font-mono text-zinc-500">Official Web Store Build</span>
          </div>
        </section>

        <section className="mt-8 rounded-xl border border-white/[0.08] bg-black/20 p-6">
          <h2 className="!mt-0">Extension not appearing on Twitch</h2>
          <ol className="mt-3 space-y-2 text-sm text-zinc-300">
            <li>
              Open <code className="font-mono text-violet-300">chrome://extensions</code> and confirm StreamPulse is enabled.
            </li>
            <li>
              Select <strong>Reload</strong> for StreamPulse.
            </li>
            <li>Hard-refresh the Twitch channel or VOD tab (<kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-xs font-mono">Ctrl+F5</kbd> / <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-xs font-mono">Cmd+Shift+R</kbd>).</li>
            <li>
              Open Twitch chat and look for the <strong>Chat / Pulse</strong> switch above the chat input box.
            </li>
          </ol>
        </section>

        <section className="mt-8">
          <h2>Pulse is loading or has limited coverage</h2>
          <p>
            StreamPulse only displays data the backend actually collected. A newly tracked stream can show
            collecting, stats-only, or partial coverage while minute rollups arrive. Check the{' '}
            <Link to="/status" className="text-violet-400 hover:underline font-semibold">service status</Link> and retry after the next update.
          </p>
        </section>

        {/* Contact / Case Submission Section */}
        <section className="mt-10 rounded-xl border border-white/[0.08] bg-black/40 p-6">
          <h2 className="!mt-0">Contact form</h2>
          <p className="muted text-sm">
            The hosted support form stays unavailable until operators enable backend acceptance and configure
            bot protection. This page does not claim the form is live.
          </p>

          {!formVisible ? (
            <div className="alert alert-warning mt-4" data-testid="support-form-unavailable" role="status" aria-live="polite">
              <span>
                The hosted form is unavailable right now. For privacy or legal questions only, email{' '}
                <a href="mailto:privacy@streampulse.stream" className="underline font-bold">privacy@streampulse.stream</a>. That address is not
                for routine product support. Security reports are not accepted here.
              </span>
            </div>
          ) : null}

          {formVisible ? (
            <form data-testid="support-form" onSubmit={onSubmit} className="support-form mt-6 space-y-4" aria-busy={state.kind === 'loading'}>
              <div className="form-group">
                <label className="field-label">
                  Category
                </label>
                <div className="category-pills" role="radiogroup" aria-label="Support Category">
                  {SUPPORT_CATEGORIES.map(value => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setCategory(value)}
                      className={`category-pill${category === value ? ' is-selected' : ''}`}
                    >
                      {CATEGORY_LABELS[value]}
                    </button>
                  ))}
                </div>
                <select
                  value={category}
                  onChange={e => setCategory(e.target.value as SupportCategory)}
                  aria-required="true"
                  className="field-input hidden"
                >
                  {SUPPORT_CATEGORIES.map(value => (
                    <option key={value} value={value}>
                      {CATEGORY_LABELS[value]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="field-label">
                  Subject
                </label>
                <input
                  value={subject}
                  maxLength={120}
                  onChange={e => setSubject(e.target.value)}
                  required
                  aria-required="true"
                  placeholder="Brief summary of the issue..."
                  className="field-input"
                />
              </div>

              <div className="form-group">
                <label className="field-label">
                  Description
                </label>
                <textarea
                  value={description}
                  maxLength={4000}
                  rows={5}
                  onChange={e => setDescription(e.target.value)}
                  required
                  aria-required="true"
                  placeholder="Describe what happened, channel name, or steps to reproduce..."
                  className="field-input"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="form-group">
                  <label className="field-label">
                    Twitch login (optional, typed manually)
                  </label>
                  <input
                    value={twitchLogin}
                    onChange={e => setTwitchLogin(e.target.value)}
                    autoComplete="off"
                    placeholder="e.g. xqc"
                    className="field-input"
                  />
                </div>
                <div className="form-group">
                  <label className="field-label">
                    Reply email (optional)
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    autoComplete="email"
                    placeholder="you@example.com"
                    className="field-input"
                  />
                </div>
              </div>

              {email.trim() ? (
                <label className="flex items-center gap-2.5 text-xs text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={contactConsent}
                    onChange={e => setContactConsent(e.target.checked)}
                    className="rounded border-zinc-700 bg-zinc-900"
                  />
                  <span>I consent to being contacted at this email about this report.</span>
                </label>
              ) : null}

              <label className="flex items-center gap-2.5 text-xs text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={e => setConsent(e.target.checked)}
                  aria-required="true"
                  className="rounded border-zinc-700 bg-zinc-900"
                />
                <span>I consent to submitting this text to StreamPulse support.</span>
              </label>

              <div
                ref={widgetHostRef}
                data-testid="support-turnstile"
                aria-label="Bot protection challenge"
                className="py-2"
              />

              <button
                type="submit"
                className="btn btn-primary"
                disabled={state.kind === 'loading'}
                aria-disabled={state.kind === 'loading'}
              >
                {state.kind === 'loading' ? 'Submitting…' : 'Submit Support Request'}
              </button>
            </form>
          ) : null}

          {state.kind === 'loading' ? (
            <p data-testid="support-form-loading" role="status" aria-live="polite" className="mt-4 text-xs font-mono text-zinc-400">
              Submitting your report…
            </p>
          ) : null}
          {state.kind === 'validation' ? (
            <div data-testid="support-form-validation" role="alert" aria-live="assertive" className="alert alert-error mt-4">
              <span>{state.message}</span>
            </div>
          ) : null}
          {state.kind === 'rate_limit' ? (
            <div data-testid="support-form-rate-limit" role="alert" aria-live="assertive" className="alert alert-error mt-4">
              <span>Too many requests. Please wait and try again.</span>
            </div>
          ) : null}
          {state.kind === 'success' ? (
            <div data-testid="support-form-success" role="status" aria-live="polite" className="alert alert-success mt-4">
              <span>Submitted successfully. Case ID: <code className="font-mono font-bold text-emerald-300">{state.caseId}</code></span>
            </div>
          ) : null}
        </section>

        {/* What to Include */}
        <section className="mt-8">
          <h2>What to include in a support request</h2>
          <ul className="space-y-1.5 text-zinc-300 text-sm">
            <li>Chrome and StreamPulse extension versions.</li>
            <li>The Twitch channel or VOD name (typed manually is fine).</li>
            <li>The exact error message and whether the Chat / Pulse switch appears.</li>
          </ul>
          <p className="alert alert-warning mt-4 text-xs">
            <span>
              <strong>Privacy Protection:</strong> Do not send Twitch cookies, authorization headers, raw chat exports, passwords, or access keys.
              Do not attach screenshots that contain account secrets.
            </span>
          </p>
        </section>

        {/* Contact Mailbox */}
        <section className="mt-8 border-t border-white/[0.08] pt-6">
          <h2>Contact</h2>
          <p>
            Email <a href="mailto:privacy@streampulse.stream" className="text-violet-400 font-bold hover:underline">privacy@streampulse.stream</a> for privacy or
            legal questions only. It is not a routine product-support mailbox.
          </p>
          <p className="muted text-xs">
            Dedicated product-support and security channels are not published yet. Do not invent or use
            unverified addresses.
          </p>
          <p className="text-xs text-zinc-400 mt-2">
            You can also review the <Link to="/docs#extension" className="text-violet-400 hover:underline">extension setup guide</Link> or the{' '}
            <Link to="/privacy" className="text-violet-400 hover:underline">privacy policy</Link>.
          </p>
        </section>
      </article>
    </PublicLayout>
  )
}
