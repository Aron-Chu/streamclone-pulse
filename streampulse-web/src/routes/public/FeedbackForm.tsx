import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, ArrowRight, ArrowUpRight, Check, Lightbulb } from 'lucide-react'
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
  turnstileErrorRetryable,
  utf8ByteLength,
  validateFeedbackDraft,
  type FeedbackDraftError,
  type FeedbackKind,
  type SupportSendOutcome,
} from '../../lib/supportForm'
import './support.css'

/**
 * The private feedback form (RPR-4), shared by /feedback. Moved here unchanged
 * from the /support page: validation, Turnstile, idempotency, rate-limit and
 * both consent boxes behave exactly as they did there.
 */

type CardState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'invalid'; error: FeedbackDraftError | 'check_pending' }
  | Exclude<SupportSendOutcome, { kind: 'rate_limited' }>
  | { kind: 'rate_limited'; until: number; seconds: number | null }

/** Where keyboard focus goes after a send or a reset, so it never falls to <body>. */
type FocusTarget = 'message' | 'email' | 'contact' | 'consent' | 'submit'

/** The control that has to change for each problem found before sending. */
const DRAFT_ERROR_TARGET: Record<FeedbackDraftError, FocusTarget> = {
  message_required: 'message',
  message_too_long: 'message',
  invalid_email: 'email',
  contact_consent_required: 'contact',
  consent_required: 'consent',
}

type TurnstileAPI = {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string
      size?: 'normal' | 'flexible' | 'compact'
      appearance?: 'always' | 'execute' | 'interaction-only'
      callback: (token: string) => void
      'expired-callback'?: () => void
      /** Gets Cloudflare's client error code; a truthy return marks it handled. */
      'error-callback'?: (errorCode?: string) => boolean | void
      'before-interactive-callback'?: () => void
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

const REJECTED_FIELD_TEXT = {
  message: 'The server could not accept this message. Shorten it and try again.',
  email: 'The server did not accept that email. Check it, or leave it blank.',
} as const

/** The hint shown next to a field for this state, if any. */
function fieldProblemText(state: CardState): string | null {
  if (state.kind === 'invalid' && state.error !== 'check_pending') return DRAFT_ERRORS[state.error]
  if (state.kind === 'rejected' && state.field) return REJECTED_FIELD_TEXT[state.field]
  return null
}

/** Show the byte count once a long message gets close to the limit. */
const COUNTER_FROM = SUPPORT_DESCRIPTION_MAX - 500

/**
 * How long Send waits after a 429 that names no readable Retry-After. The
 * backend's limiter for this route counts per minute; current backends send
 * `Retry-After: 60` and list it in CORS, but older ones send none and a
 * cross-origin reply only exposes the header when CORS lists it, so a missing
 * value must still be handled.
 */
const RATE_LIMIT_FALLBACK_MS = 60_000

/**
 * Fresh challenges the reader's Send presses may start after the widget errors,
 * before the card stops offering the form and shows the unavailable panel (an
 * extension or network that blocks Cloudflare's iframe fails every time).
 */
const WIDGET_RETRY_LIMIT = 2

function retrySeconds(until: number, now: number): number {
  return Math.max(1, Math.ceil((until - now) / 1000))
}

/** The server's wait in words, fixed when the 429 arrives (the alert never ticks). */
function waitPhrase(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`
  if (seconds < 90) return 'a minute'
  return `${Math.round(seconds / 60)} minutes`
}

/**
 * Places to post in public when the private form cannot take a message. Each
 * one is labelled public, never private: anyone can read what is posted there.
 * Discord shows only when the build has a valid invite.
 */
function PublicAlternatives({ compact = false }: { compact?: boolean }) {
  const discord = discordInviteUrl()
  return (
    <div className={`feedback-public${compact ? ' feedback-public--compact' : ''}`} data-testid="feedback-public-alternatives">
      <p className="feedback-public__note">
        <strong>Public alternatives.</strong> Anyone can read these, so leave out emails, account details and anything personal.
      </p>
      <div className="feedback-off__actions">
        <a className={buttonClass('outline', compact ? 'default' : 'lg')} href={PUBLIC_SUPPORT_URL} target="_blank" rel="noopener noreferrer"
          aria-label="Open a public issue on GitHub (opens in a new tab)">
          Open a public issue on GitHub<ArrowUpRight aria-hidden="true" />
        </a>
        {discord ? (
          <a className={buttonClass('outline', compact ? 'default' : 'lg')} href={discord} target="_blank" rel="noopener noreferrer"
            aria-label="Ask in the public Discord (opens in a new tab)">
            <DiscordMark size={15} />Ask in the public Discord
          </a>
        ) : null}
      </div>
    </div>
  )
}

function UnavailablePanel({ keptMessage, takeFocus = false }: { keptMessage?: string; takeFocus?: boolean }) {
  const [diagnostics, setDiagnostics] = useState('')
  const [copyStatus, setCopyStatus] = useState('')
  const leadRef = useRef<HTMLParagraphElement | null>(null)
  // Only when it replaces a form the reader was using; never on page load.
  useEffect(() => {
    if (takeFocus) leadRef.current?.focus()
  }, [takeFocus])
  async function copyDiagnostics() {
    const summary = supportDiagnostics({ userAgent: navigator.userAgent, online: navigator.onLine,
      width: window.innerWidth, height: window.innerHeight })
    setDiagnostics(summary)
    try { await navigator.clipboard.writeText(summary); setCopyStatus('Diagnostics copied. Review before sharing.') }
    catch { setCopyStatus('Copy was unavailable. Select and copy the summary below.') }
  }
  return (
    <div className="feedback-off" data-testid="support-form-unavailable">
      <p className="feedback-off__lead" role="status" ref={leadRef} tabIndex={-1}>
        The private feedback form is unavailable right now{keptMessage ? ', so your message was not sent' : ''}.
        <small>Please try again later. If it can&apos;t wait and contains nothing private, you can post it in public instead.</small>
      </p>
      {keptMessage ? (
        <label className="feedback-field">
          <span className="feedback-label">Your message, kept so you can copy it</span>
          <textarea className="feedback-input" readOnly value={keptMessage} rows={4} />
        </label>
      ) : null}
      <PublicAlternatives />
      <div className="feedback-off__actions">
        <button type="button" className={buttonClass('outline', 'lg')} onClick={() => void copyDiagnostics()}>Copy safe diagnostics</button>
      </div>
      <p className="feedback-off__copy" role="status">{copyStatus}</p>
      {diagnostics ? <pre aria-label="Diagnostics to review">{diagnostics}</pre> : null}
    </div>
  )
}

/**
 * Public feedback card (RPR-4). The form works only in a browser with a
 * Turnstile site key; the backend stays flag-gated and answers 503 until it is
 * activated, which the card shows as unavailable rather than as a send failure.
 *
 * `shell` is the prerendered copy: the same markup with every control
 * disabled, so the page does not jump when the live form replaces it, and
 * nothing typed before JavaScript runs is thrown away by that replacement.
 */
function FeedbackCard({ siteKey, shell = false }: { siteKey: string; shell?: boolean }) {
  const availability = supportFormAvailability(siteKey)
  const [kind, setKind] = useState<FeedbackKind>('bug')
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [contactConsent, setContactConsent] = useState(false)
  const [consent, setConsent] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState('')
  // Turnstile stays invisible unless Cloudflare needs the reader to interact.
  const [challengeShown, setChallengeShown] = useState(false)
  const [state, setState] = useState<CardState>(availability === 'unavailable' ? { kind: 'unavailable' } : { kind: 'idle' })
  const [now, setNow] = useState(() => Date.now())
  // One polite status line for things said once (never a ticking value).
  const [liveNote, setLiveNote] = useState('')
  const noteTimerRef = useRef<number | null>(null)

  const idempotency = useRef(createSupportIdempotency())
  const widgetHostRef = useRef<HTMLDivElement | null>(null)
  const widgetIdRef = useRef<string | null>(null)
  const submitControllerRef = useRef<AbortController | null>(null)
  const sentHeadingRef = useRef<HTMLParagraphElement | null>(null)
  const formRef = useRef<HTMLFormElement | null>(null)
  const messageRef = useRef<HTMLTextAreaElement | null>(null)
  const emailRef = useRef<HTMLInputElement | null>(null)
  const contactRef = useRef<HTMLInputElement | null>(null)
  const consentRef = useRef<HTMLInputElement | null>(null)
  const submitRef = useRef<HTMLButtonElement | null>(null)
  const pendingFocusRef = useRef<FocusTarget | null>(null)
  // The widget reported an error since its last token, and how many fresh
  // challenges the reader's presses have started since then.
  const widgetFailedRef = useRef(false)
  const widgetRetriesRef = useRef(0)
  const [panelTakesFocus, setPanelTakesFocus] = useState(false)
  useEffect(() => () => {
    submitControllerRef.current?.abort()
    if (noteTimerRef.current !== null) window.clearTimeout(noteTimerRef.current)
  }, [])

  /** Say `text` once through the status line, even when it repeats the last note. */
  function announce(text: string) {
    if (noteTimerRef.current !== null) window.clearTimeout(noteTimerRef.current)
    setLiveNote('')
    noteTimerRef.current = window.setTimeout(() => {
      noteTimerRef.current = null
      setLiveNote(text)
    }, 100)
  }

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
        // The normal and flexible widgets are at least 300px wide, wider than a
        // 320px phone leaves inside the card, so a narrow card gets compact.
        const width = widgetHostRef.current.clientWidth
        widgetIdRef.current = window.turnstile.render(widgetHostRef.current, {
          sitekey: siteKey,
          appearance: 'interaction-only',
          size: width > 0 && width < 300 ? 'compact' : 'flexible',
          'before-interactive-callback': () => setChallengeShown(true),
          callback: token => {
            widgetFailedRef.current = false
            widgetRetriesRef.current = 0
            setTurnstileToken(token)
            setState(prev => (prev.kind === 'invalid' && prev.error === 'check_pending' ? { kind: 'idle' } : prev))
          },
          'expired-callback': () => setTurnstileToken(''),
          'error-callback': errorCode => {
            widgetFailed(errorCode)
            // Handled here, so Turnstile does not also log it to the console.
            return true
          },
        })
      })
      .catch(() => {
        if (!cancelled) becomeUnavailable()
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
        announce('You can send again.')
      }
    }, 1000)
    return () => window.clearInterval(tick)
  }, [rateUntil])

  useEffect(() => {
    if (state.kind === 'sent') sentHeadingRef.current?.focus()
  }, [state.kind])

  // Runs after the new state's markup is in place, so the target exists.
  useEffect(() => {
    const want = pendingFocusRef.current
    if (!want) return
    pendingFocusRef.current = null
    const target = {
      message: messageRef, email: emailRef, contact: contactRef, consent: consentRef, submit: submitRef,
    }[want].current
    if (!target) return
    if (document.activeElement !== target) {
      // Focus lands with the field's aria-invalid and hint already in place,
      // so a screen reader reads the problem with the field.
      target.focus()
      return
    }
    // Focus cannot move to where the reader already is (Enter in the email
    // box), so say the problem through the status line instead.
    const text = fieldProblemText(state)
    if (text) announce(text)
  }, [state])

  /** The unavailable panel takes focus only if the reader was in the form it replaces. */
  function notePanelFocus() {
    const active = typeof document === 'undefined' ? null : document.activeElement
    setPanelTakesFocus(!!active && !!formRef.current?.contains(active))
  }

  function becomeUnavailable() {
    notePanelFocus()
    setState({ kind: 'unavailable' })
  }

  /**
   * The widget reported an error. A timeout, a failed challenge or an iframe
   * that did not load keeps the form and the typed message: Turnstile retries
   * on its own, and the reader's next Send starts a fresh challenge. A
   * configuration error (site key, domain), or fresh challenges that keep
   * failing, show the unavailable panel instead.
   */
  function widgetFailed(errorCode: unknown) {
    setTurnstileToken('')
    widgetFailedRef.current = true
    if (!turnstileErrorRetryable(errorCode) || widgetRetriesRef.current >= WIDGET_RETRY_LIMIT) {
      notePanelFocus()
      // A case already sent, or on its way, stays on screen.
      setState(prev => (prev.kind === 'sent' || prev.kind === 'sending' ? prev : { kind: 'unavailable' }))
      return
    }
    // Said only to a reader waiting on the check, never to one still typing;
    // a repeat while it is shown changes nothing, so it is said once.
    setState(prev => (prev.kind === 'invalid' && prev.error === 'check_pending' ? { kind: 'check_failed' } : prev))
  }

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
      pendingFocusRef.current = DRAFT_ERROR_TARGET[problem]
      setState({ kind: 'invalid', error: problem })
      return
    }
    if (!turnstileToken.trim()) {
      if (widgetFailedRef.current) {
        // The widget errored: this press starts a fresh challenge (at the
        // reader's pace, so a failing network is never retried in a loop).
        widgetFailedRef.current = false
        widgetRetriesRef.current += 1
        resetChallenge()
      }
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
    if (outcome.kind === 'unavailable') {
      becomeUnavailable()
      return
    }
    // Keep the reader where they can act: on the field the server pointed at,
    // otherwise on Send / Try again (the alert says what happened).
    pendingFocusRef.current = outcome.kind === 'rejected' && outcome.field ? outcome.field : 'submit'
    if (outcome.kind === 'rate_limited') {
      const waitMs = outcome.retryAfterMs ?? RATE_LIMIT_FALLBACK_MS
      // `now` last moved at mount or on the last tick; move it with the state so
      // the first frame of the countdown does not count from back then.
      const arrived = Date.now()
      setNow(arrived)
      setState({
        kind: 'rate_limited',
        until: arrived + waitMs,
        seconds: outcome.retryAfterMs === null ? null : Math.ceil(outcome.retryAfterMs / 1000),
      })
      return
    }
    setState(outcome)
  }

  if (state.kind === 'unavailable') {
    return <UnavailablePanel keptMessage={message.trim() ? message : undefined} takeFocus={panelTakesFocus} />
  }

  const sending = state.kind === 'sending'
  const messageBytes = utf8ByteLength(message.trim())
  const messageError = state.kind === 'invalid' && (state.error === 'message_required' || state.error === 'message_too_long')
    ? DRAFT_ERRORS[state.error]
    : state.kind === 'rejected' && state.field === 'message'
      ? REJECTED_FIELD_TEXT.message
      : null
  const emailError = state.kind === 'invalid' && state.error === 'invalid_email'
    ? DRAFT_ERRORS.invalid_email
    : state.kind === 'rejected' && state.field === 'email'
      ? REJECTED_FIELD_TEXT.email
      : null
  // The reply-consent box is what needs ticking here, not the email itself.
  const contactError = state.kind === 'invalid' && state.error === 'contact_consent_required'
    ? DRAFT_ERRORS.contact_consent_required
    : null
  const consentError = state.kind === 'invalid' && state.error === 'consent_required' ? DRAFT_ERRORS.consent_required : null
  // Visible countdown only; the alert below keeps the wording it arrived with,
  // because a role="alert" whose text changes is read out again every second.
  const waitSeconds = state.kind === 'rate_limited' ? retrySeconds(state.until, now) : null
  const alert = state.kind === 'failed' ? "Couldn't send. Your message is still here."
    : state.kind === 'check_failed' ? "The bot check didn't go through. Your message is still here; try again."
    : state.kind === 'rejected' && state.field === null ? 'The server could not accept this report. Check the fields and try again.'
    : state.kind === 'rate_limited'
      ? state.seconds === null
        ? 'Too many attempts. Wait a minute, then try again. Your message is still here.'
        : `Too many attempts. Try again in about ${waitPhrase(state.seconds)}. Your message is still here.`
      : null

  return (
    <>
      <p className="feedback-sr" role="status" data-testid="support-form-announce">{liveNote}</p>
      {state.kind === 'sent' ? (
        <div className="feedback-done" data-testid="support-form-success" role="status">
          <span className="feedback-done__check" aria-hidden="true"><Check /></span>
          <div>
            <p className="feedback-done__title" ref={sentHeadingRef} tabIndex={-1}>Saved. Thank you.</p>
            <p className="feedback-done__sub">Keep this ID if you follow up.</p>
            <p className="feedback-done__ref">Case ID: <code>{state.caseId}</code></p>
            <button type="button" className={buttonClass('outline', 'default')}
              onClick={() => { pendingFocusRef.current = 'message'; setState({ kind: 'idle' }) }}>
              Send something else
            </button>
          </div>
        </div>
      ) : (
        <form data-testid="support-form" className={shell ? 'feedback-form feedback-form--shell' : 'feedback-form'}
          onSubmit={onSubmit} aria-busy={sending} noValidate ref={formRef}>
          {/* Paused, not disabled, while sending: disabling the control that has
              focus drops focus to <body> and the keyboard reader starts over. */}
          <div className="feedback-form__fields" data-paused={sending ? 'true' : undefined}>
            <fieldset className="feedback-choice">
              <legend className="feedback-sr">What is this about?</legend>
              {FEEDBACK_KINDS.map(option => (
                <label key={option.value} className={`feedback-choice__opt${kind === option.value ? ' is-on' : ''}`}>
                  <input type="radio" name="feedback-kind" value={option.value} checked={kind === option.value}
                    disabled={shell || undefined} aria-disabled={sending ? true : undefined}
                    onChange={() => { if (sending) return; setKind(option.value); edited() }} />
                  {option.value === 'bug' ? <AlertCircle aria-hidden="true" /> : <Lightbulb aria-hidden="true" />}
                  {option.label}
                </label>
              ))}
            </fieldset>

            <div className="feedback-field">
              <label className="feedback-label" htmlFor="feedback-message">Your message</label>
              <textarea id="feedback-message" ref={messageRef} className="feedback-input" rows={5} value={message} readOnly={sending}
                disabled={shell || undefined}
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
              <input id="feedback-email" ref={emailRef} className="feedback-input" type="email" autoComplete="email" maxLength={254}
                placeholder="you@example.com" value={email} readOnly={sending} disabled={shell || undefined}
                aria-invalid={emailError ? true : undefined}
                aria-describedby={emailError ? 'feedback-email-hint' : undefined}
                onChange={e => { setEmail(e.target.value); edited() }} />
              {emailError ? <p className="feedback-hint" id="feedback-email-hint">{emailError}</p> : null}
            </div>

            {email.trim() ? (
              <>
                <label className="feedback-check">
                  <input type="checkbox" ref={contactRef} checked={contactConsent} aria-disabled={sending ? true : undefined}
                    aria-invalid={contactError ? true : undefined}
                    aria-describedby={contactError ? 'feedback-contact-hint' : undefined}
                    onChange={e => { if (sending) return; setContactConsent(e.target.checked); edited() }} />
                  <span>I consent to being contacted at this email about this report.</span>
                </label>
                {contactError ? <p className="feedback-hint" id="feedback-contact-hint">{contactError}</p> : null}
              </>
            ) : null}
            <label className="feedback-check">
              <input type="checkbox" ref={consentRef} checked={consent} aria-required="true" aria-disabled={sending ? true : undefined}
                disabled={shell || undefined}
                aria-invalid={consentError ? true : undefined}
                aria-describedby={consentError ? 'feedback-consent-hint' : undefined}
                onChange={e => { if (sending) return; setConsent(e.target.checked); edited() }} />
              <span>I consent to submitting this text to StreamPulse support.</span>
            </label>
            {consentError ? <p className="feedback-hint" id="feedback-consent-hint">{consentError}</p> : null}

            {alert ? (
              <div className="feedback-alert" role="alert" data-testid={state.kind === 'rate_limited' ? 'support-form-rate-limit' : 'support-form-error'}>
                <AlertCircle aria-hidden="true" />{alert}
              </div>
            ) : null}
            {/* After a send that failed outright, say where else it can go,
                labelled public; the form and the message stay for a retry. */}
            {state.kind === 'failed' ? <PublicAlternatives compact /> : null}
            {state.kind === 'invalid' && state.error === 'check_pending' ? (
              <p className="feedback-hint" role="status">{DRAFT_ERRORS.check_pending}</p>
            ) : null}

            <div className="feedback-row">
              {/* aria-disabled, not disabled, so the button keeps focus; onSubmit
                  ignores presses while sending or rate limited. */}
              <button type="submit" ref={submitRef} className={buttonClass('default', 'lg')} disabled={shell || undefined}
                aria-disabled={sending || state.kind === 'rate_limited' ? true : undefined}>
                {sending ? <><span className="feedback-spin" aria-hidden="true" />Sending…</>
                  : state.kind === 'failed' || state.kind === 'check_failed' ? 'Try again'
                  : <>Send feedback<ArrowRight aria-hidden="true" /></>}
              </button>
              {sending ? <p className="feedback-muted" role="status" data-testid="support-form-loading">Sending. The form is paused until it finishes.</p> : null}
              {waitSeconds !== null ? (
                <p className="feedback-muted" aria-hidden="true" data-testid="support-rate-countdown">Send again in {waitSeconds}s</p>
              ) : null}
            </div>
          </div>
          <p className="feedback-legal">
            How we handle it: <Link to="/privacy">Privacy policy</Link> · Privacy or legal: <a href="mailto:privacy@streampulse.stream">privacy@streampulse.stream</a> · Security: see <Link to="/support#security">security reports</Link>
          </p>
        </form>
      )}
      <div ref={widgetHostRef} hidden={state.kind === 'sent'} data-testid="support-turnstile"
        className={`feedback-challenge${challengeShown ? ' is-shown' : ''}`} />
    </>
  )
}

/**
 * The form as a page shows it. In the prerender it is the form's own markup
 * with every control disabled, so the live form takes exactly its space;
 * without JavaScript that shell hides and the unavailable panel shows.
 */
export function FeedbackFormSlot() {
  const siteKey = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim() ?? ''
  const ready = supportFormAvailability(siteKey) === 'ready'
  return ready && typeof window === 'undefined' ? (
    <>
      <FeedbackCard siteKey={siteKey} shell />
      <noscript><UnavailablePanel /></noscript>
    </>
  ) : <FeedbackCard siteKey={siteKey} />
}
