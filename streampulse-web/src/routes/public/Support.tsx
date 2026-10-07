import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, ArrowRight, ArrowUpRight, Check, Lightbulb } from 'lucide-react'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { ChromeInstallCta } from '../../ui/components/ChromeInstallCta'
import { DiscordMark } from '../../ui/components/DiscordMark'
import { buttonClass } from '../../ui/primitives'
import { apiClient } from '../../lib/apiClient'
import { discordInviteUrl } from '../../lib/discord'
import { PUBLIC_SUPPORT_URL } from '../../lib/externalLinks'
import { supportDiagnostics } from '../../lib/supportDiagnostics'
import {
  FEEDBACK_KINDS,
  SUPPORT_DESCRIPTION_MAX,
  buildSupportCaseBody,
  createSupportIdempotency,
  ensureTurnstileScript,
  supportFailureOutcome,
  supportFormAvailability,
  supportSuccessOutcome,
  utf8ByteLength,
  validateFeedbackDraft,
  type FeedbackDraftError,
  type FeedbackKind,
  type SupportSendOutcome,
} from '../../lib/supportForm'
import './support.css'

type CardState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'invalid'; error: FeedbackDraftError | 'check_pending' }
  | Exclude<SupportSendOutcome, { kind: 'rate_limited' }>
  | { kind: 'rate_limited'; until: number; guessed: boolean }

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

const DRAFT_ERRORS: Record<FeedbackDraftError | 'check_pending', string> = {
  message_required: 'Add a few words first.',
  message_too_long: `Shorten your message to fit ${SUPPORT_DESCRIPTION_MAX.toLocaleString('en-US')} bytes. Emoji and accented letters count as more than one.`,
  consent_required: 'Tick the consent box to send this.',
  contact_consent_required: 'Allow a reply to this email, or leave the email blank.',
  invalid_email: 'Enter a valid email, or leave it blank.',
  check_pending: 'Still checking that you are not a bot. Try again in a moment.',
}

/** Show the byte count once a long message gets close to the limit. */
const COUNTER_FROM = SUPPORT_DESCRIPTION_MAX - 500

/**
 * How long Send waits after a 429 that names no readable Retry-After. The
 * backend's limiter for this route counts per minute and its 429 carries no
 * Retry-After, and a cross-origin reply only exposes that header when CORS
 * lists it, so a missing value is the normal case, not an edge.
 */
const RATE_LIMIT_FALLBACK_MS = 60_000

function retrySeconds(until: number, now: number): number {
  return Math.max(1, Math.ceil((until - now) / 1000))
}

function UnavailablePanel({ keptMessage }: { keptMessage?: string }) {
  const [diagnostics, setDiagnostics] = useState('')
  const [copyStatus, setCopyStatus] = useState('')
  async function copyDiagnostics() {
    const summary = supportDiagnostics({ userAgent: navigator.userAgent, online: navigator.onLine,
      width: window.innerWidth, height: window.innerHeight })
    setDiagnostics(summary)
    try { await navigator.clipboard.writeText(summary); setCopyStatus('Diagnostics copied. Review before sharing.') }
    catch { setCopyStatus('Copy was unavailable. Select and copy the summary below.') }
  }
  return (
    <div className="feedback-off" data-testid="support-form-unavailable">
      <p className="feedback-off__lead" role="status">
        The hosted form is unavailable right now.
        <small>For non-sensitive questions, open a public issue. GitHub posts are public, so leave out personal details.</small>
      </p>
      {keptMessage ? (
        <label className="feedback-field">
          <span className="feedback-label">Your message, kept so you can copy it</span>
          <textarea className="feedback-input" readOnly value={keptMessage} rows={4} />
        </label>
      ) : null}
      <div className="feedback-off__actions">
        <a className={buttonClass('outline', 'lg')} href={PUBLIC_SUPPORT_URL} target="_blank" rel="noopener noreferrer">
          Open a public issue on GitHub<ArrowUpRight aria-hidden="true" />
        </a>
        <button type="button" className={buttonClass('outline', 'lg')} onClick={() => void copyDiagnostics()}>Copy safe diagnostics</button>
      </div>
      <p className="feedback-off__copy" role="status">{copyStatus}</p>
      {diagnostics ? <pre aria-label="Diagnostics to review">{diagnostics}</pre> : null}
    </div>
  )
}

/**
 * Public feedback card (RPR-4). The form renders only in a browser with a
 * Turnstile site key; the backend stays flag-gated and answers 503 until it is
 * activated, which the card shows as unavailable rather than as a send failure.
 */
function FeedbackCard({ siteKey }: { siteKey: string }) {
  const availability = supportFormAvailability(siteKey)
  const [kind, setKind] = useState<FeedbackKind>('bug')
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [contactConsent, setContactConsent] = useState(false)
  const [consent, setConsent] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState('')
  const [state, setState] = useState<CardState>(availability === 'unavailable' ? { kind: 'unavailable' } : { kind: 'idle' })
  const [now, setNow] = useState(() => Date.now())

  const idempotency = useRef(createSupportIdempotency())
  const widgetHostRef = useRef<HTMLDivElement | null>(null)
  const widgetIdRef = useRef<string | null>(null)
  const submitControllerRef = useRef<AbortController | null>(null)
  const sentHeadingRef = useRef<HTMLParagraphElement | null>(null)
  useEffect(() => () => submitControllerRef.current?.abort(), [])

  useEffect(() => {
    if (availability !== 'ready' || !siteKey) return
    let cancelled = false
    ensureTurnstileScript(siteKey)
      .then(() => {
        if (cancelled || !widgetHostRef.current || !window.turnstile) return
        if (widgetIdRef.current) {
          window.turnstile.remove(widgetIdRef.current)
          widgetIdRef.current = null
        }
        widgetIdRef.current = window.turnstile.render(widgetHostRef.current, {
          sitekey: siteKey,
          callback: token => {
            setTurnstileToken(token)
            setState(prev => (prev.kind === 'invalid' && prev.error === 'check_pending' ? { kind: 'idle' } : prev))
          },
          'expired-callback': () => setTurnstileToken(''),
          'error-callback': () => {
            setTurnstileToken('')
            setState({ kind: 'unavailable' })
          },
        })
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'unavailable' })
      })
    return () => {
      cancelled = true
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current)
        widgetIdRef.current = null
      }
    }
  }, [availability, siteKey])

  // A rate limit holds Send until the server's Retry-After (or the fallback
  // minute) has passed, then lets the reader send again without a reload.
  const rateUntil = state.kind === 'rate_limited' ? state.until : null
  useEffect(() => {
    if (rateUntil === null) return
    setNow(Date.now())
    const tick = window.setInterval(() => {
      const current = Date.now()
      setNow(current)
      if (current >= rateUntil) {
        window.clearInterval(tick)
        setState(prev => (prev.kind === 'rate_limited' ? { kind: 'idle' } : prev))
      }
    }, 1000)
    return () => window.clearInterval(tick)
  }, [rateUntil])

  useEffect(() => {
    if (state.kind === 'sent') sentHeadingRef.current?.focus()
  }, [state.kind])

  /** Every attempt spends its challenge token; the widget issues a fresh one. */
  function resetChallenge() {
    setTurnstileToken('')
    if (window.turnstile && widgetIdRef.current) window.turnstile.reset(widgetIdRef.current)
  }

  function edited() {
    setState(prev => (prev.kind === 'invalid' || prev.kind === 'rejected' ? { kind: 'idle' } : prev))
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (submitControllerRef.current || state.kind === 'rate_limited') return
    const draft = { kind, message, email, consent, contactConsent }
    const problem = validateFeedbackDraft(draft)
    if (problem) {
      setState({ kind: 'invalid', error: problem })
      return
    }
    if (!turnstileToken.trim()) {
      setState({ kind: 'invalid', error: 'check_pending' })
      return
    }
    const body = buildSupportCaseBody(draft)
    const key = idempotency.current.keyFor(body)
    setState({ kind: 'sending' })
    const controller = new AbortController()
    submitControllerRef.current = controller
    let outcome: SupportSendOutcome
    try {
      const { data } = await apiClient<unknown>('/v1/portal/support/cases', {
        method: 'POST',
        sensitive: true,
        signal: controller.signal,
        timeoutMs: 12_000,
        maxResponseBytes: 64 * 1024,
        // Sent as a header, not `idempotencyKey`, so the client never replays a
        // spent challenge token on its own; a retry is always the reader's.
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify({ ...body, turnstile_token: turnstileToken }),
      })
      outcome = supportSuccessOutcome(data)
    } catch (error) {
      if (controller.signal.aborted) return
      outcome = supportFailureOutcome(error)
    } finally {
      submitControllerRef.current = null
    }
    resetChallenge()
    if (outcome.kind === 'sent') {
      idempotency.current.reset()
      setMessage('')
      setEmail('')
      setContactConsent(false)
      // Consent is per submission: the next report asks again.
      setConsent(false)
      setState(outcome)
      return
    }
    if (outcome.kind === 'rate_limited') {
      const guessed = outcome.retryAfterMs === null
      setState({ kind: 'rate_limited', until: Date.now() + (outcome.retryAfterMs ?? RATE_LIMIT_FALLBACK_MS), guessed })
      return
    }
    setState(outcome)
  }

  if (state.kind === 'unavailable') return <UnavailablePanel keptMessage={message.trim() ? message : undefined} />

  const sending = state.kind === 'sending'
  const messageBytes = utf8ByteLength(message.trim())
  const messageError = state.kind === 'invalid' && (state.error === 'message_required' || state.error === 'message_too_long')
    ? DRAFT_ERRORS[state.error]
    : state.kind === 'rejected' && state.field === 'message'
      ? 'The server could not accept this message. Shorten it and try again.'
      : null
  const emailError = state.kind === 'invalid' && (state.error === 'invalid_email' || state.error === 'contact_consent_required')
    ? DRAFT_ERRORS[state.error]
    : state.kind === 'rejected' && state.field === 'email'
      ? 'The server did not accept that email. Check it, or leave it blank.'
      : null
  const waitSeconds = state.kind === 'rate_limited' ? retrySeconds(state.until, now) : null
  const alert = state.kind === 'failed' ? "Couldn't send. Your message is still here."
    : state.kind === 'check_failed' ? "The bot check didn't go through. Your message is still here; try again."
    : state.kind === 'rejected' && state.field === null ? 'The server could not accept this report. Check the fields and try again.'
    : state.kind === 'rate_limited'
      ? state.guessed || waitSeconds === null
        ? 'Too many attempts. Wait a minute, then try again. Your message is still here.'
        : `Too many attempts. Try again in ${waitSeconds} second${waitSeconds === 1 ? '' : 's'}. Your message is still here.`
      : null

  return (
    <>
      {state.kind === 'sent' ? (
        <div className="feedback-done" data-testid="support-form-success" role="status">
          <span className="feedback-done__check" aria-hidden="true"><Check /></span>
          <div>
            <p className="feedback-done__title" ref={sentHeadingRef} tabIndex={-1}>Saved. Thank you.</p>
            <p className="feedback-done__sub">Keep this ID if you follow up.</p>
            <p className="feedback-done__ref">Case ID: <code>{state.caseId}</code></p>
            <button type="button" className={buttonClass('outline', 'default')} onClick={() => setState({ kind: 'idle' })}>
              Send something else
            </button>
          </div>
        </div>
      ) : (
        <form data-testid="support-form" className="feedback-form" onSubmit={onSubmit} aria-busy={sending} noValidate>
          <fieldset className="feedback-form__fields" disabled={sending}>
            <fieldset className="feedback-choice">
              <legend className="feedback-sr">What is this about?</legend>
              {FEEDBACK_KINDS.map(option => (
                <label key={option.value} className={`feedback-choice__opt${kind === option.value ? ' is-on' : ''}`}>
                  <input type="radio" name="feedback-kind" value={option.value} checked={kind === option.value}
                    onChange={() => { setKind(option.value); edited() }} />
                  {option.value === 'bug' ? <AlertCircle aria-hidden="true" /> : <Lightbulb aria-hidden="true" />}
                  {option.label}
                </label>
              ))}
            </fieldset>

            <div className="feedback-field">
              <label className="feedback-label" htmlFor="feedback-message">Your message</label>
              <textarea id="feedback-message" className="feedback-input" rows={5} value={message}
                placeholder={kind === 'bug' ? 'What happened? Mention the channel if it helps.' : 'What would make StreamPulse better for you?'}
                aria-invalid={messageError ? true : undefined}
                aria-describedby={[messageError ? 'feedback-message-hint' : '', messageBytes >= COUNTER_FROM ? 'feedback-message-count' : ''].filter(Boolean).join(' ') || undefined}
                onChange={e => { setMessage(e.target.value); edited() }} />
              {messageError ? <p className="feedback-hint" id="feedback-message-hint">{messageError}</p> : null}
              {messageBytes >= COUNTER_FROM ? (
                <p className={`feedback-count${messageBytes > SUPPORT_DESCRIPTION_MAX ? ' is-over' : ''}`} id="feedback-message-count" data-testid="support-message-count">
                  {messageBytes.toLocaleString('en-US')} / {SUPPORT_DESCRIPTION_MAX.toLocaleString('en-US')} bytes
                </p>
              ) : null}
            </div>

            <div className="feedback-field">
              <label className="feedback-label" htmlFor="feedback-email">Email <small>· optional, only if you&apos;d like a reply</small></label>
              <input id="feedback-email" className="feedback-input" type="email" autoComplete="email" maxLength={254}
                placeholder="you@example.com" value={email}
                aria-invalid={emailError ? true : undefined}
                aria-describedby={emailError ? 'feedback-email-hint' : undefined}
                onChange={e => { setEmail(e.target.value); edited() }} />
              {emailError ? <p className="feedback-hint" id="feedback-email-hint">{emailError}</p> : null}
            </div>

            {email.trim() ? (
              <label className="feedback-check">
                <input type="checkbox" checked={contactConsent} onChange={e => { setContactConsent(e.target.checked); edited() }} />
                <span>I consent to being contacted at this email about this report.</span>
              </label>
            ) : null}
            <label className="feedback-check">
              <input type="checkbox" checked={consent} aria-required="true"
                aria-invalid={state.kind === 'invalid' && state.error === 'consent_required' ? true : undefined}
                onChange={e => { setConsent(e.target.checked); edited() }} />
              <span>I consent to submitting this text to StreamPulse support.</span>
            </label>
            {state.kind === 'invalid' && state.error === 'consent_required' ? <p className="feedback-hint">{DRAFT_ERRORS.consent_required}</p> : null}

            {alert ? (
              <div className="feedback-alert" role="alert" data-testid={state.kind === 'rate_limited' ? 'support-form-rate-limit' : 'support-form-error'}>
                <AlertCircle aria-hidden="true" />{alert}
              </div>
            ) : null}
            {state.kind === 'invalid' && state.error === 'check_pending' ? (
              <p className="feedback-hint" role="status">{DRAFT_ERRORS.check_pending}</p>
            ) : null}

            <div className="feedback-row">
              <button type="submit" className={buttonClass('default', 'lg')} disabled={state.kind === 'rate_limited'}>
                {sending ? <><span className="feedback-spin" aria-hidden="true" />Sending…</>
                  : state.kind === 'failed' || state.kind === 'check_failed' ? 'Try again'
                  : <>Send feedback<ArrowRight aria-hidden="true" /></>}
              </button>
              {sending ? <p className="feedback-muted" role="status" data-testid="support-form-loading">Sending. The form is paused until it finishes.</p> : null}
            </div>
          </fieldset>
          <p className="feedback-legal">
            How we handle it: <Link to="/privacy">Privacy policy</Link> · Privacy or legal: <a href="mailto:privacy@streampulse.stream">privacy@streampulse.stream</a> · Security: see <a href="#security">Contact</a> below
          </p>
        </form>
      )}
      <div ref={widgetHostRef} hidden={state.kind === 'sent'} data-testid="support-turnstile" className="feedback-challenge" />
    </>
  )
}

/** Rendered before JavaScript runs (prerender) when the form is configured. */
function FeedbackCardPlaceholder() {
  return (
    <>
      <p className="feedback-muted">Loading the feedback form…</p>
      <noscript><UnavailablePanel /></noscript>
    </>
  )
}

export default function Support() {
  const siteKey = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim() ?? ''
  const ready = supportFormAvailability(siteKey) === 'ready'
  const discord = discordInviteUrl()

  return (
    <PublicLayout>
      <div data-testid="support-page" className="support-page">
        <section id="send-feedback" className="feedback-card" aria-labelledby="feedback-title">
          <h2 id="feedback-title" className="feedback-card__title">Send us feedback</h2>
          <p className="feedback-card__sub">Spotted a problem or have an idea? Tell us here.</p>
          {ready && typeof window === 'undefined' ? <FeedbackCardPlaceholder /> : <FeedbackCard siteKey={siteKey} />}
        </section>

        {discord ? (
          <p className="support-discord-line" data-testid="support-discord-line">
            Ideas or just want to chat?{' '}
            <a href={discord} target="_blank" rel="noopener noreferrer" aria-label="Join the Discord (opens in a new tab)">
              <DiscordMark size={15} /><span>Join the Discord</span>
            </a>
            <small>It&apos;s public, so keep account problems in the form.</small>
          </p>
        ) : null}

        <article className="panel public-document support-page__guide">
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
                Turn StreamPulse off and on again, or select <strong>Reload</strong> if that control is available.
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
          <section id="contact" className="mt-8 border-t border-white/[0.08] pt-6">
            <h2>Contact</h2>
            <p>
              Email <a href="mailto:privacy@streampulse.stream" className="text-violet-400 font-bold hover:underline">privacy@streampulse.stream</a> for privacy or
              legal questions only. It is not a routine product-support mailbox.
            </p>
            <h3 id="security">Security reports</h3>
            <p className="muted text-xs">A private security-reporting channel has not been published yet. Do not post vulnerability details in public issues or in this form. A verified private contact is required before sending sensitive details.</p>
            <p className="text-xs text-zinc-400 mt-2">
              You can also review the <Link to="/docs#extension" className="text-violet-400 hover:underline">extension setup guide</Link> or the{' '}
              <Link to="/privacy" className="text-violet-400 hover:underline">privacy policy</Link>.
            </p>
          </section>
        </article>
      </div>
    </PublicLayout>
  )
}
