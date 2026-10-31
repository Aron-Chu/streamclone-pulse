import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { apiClient, isApiError } from '../../lib/apiClient'
import { ensureTurnstileScript, feedbackSiteKey, utf8ByteLength } from '../../lib/supportForm'
import { forgetWithdrawalKey, newWithdrawalKey, pendingWithdrawalKey, rememberWithdrawalKey, supporterWithdrawalEnabled } from '../../lib/supporterWithdrawal'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { buttonClass } from '../../ui/primitives'
import './withdraw.css'

type Phase = 'details' | 'review' | 'sending' | 'uncertain' | 'sent'
type Receipt = { reference: string; received_at: string }

function clean(value: string, limit: number): boolean {
  const text = value.trim()
  return Boolean(text) && utf8ByteLength(text) <= limit && !/[\u0000-\u001f\u007f-\u009f]/.test(text)
}

function safeName(value: string): boolean {
  const text = value.trim()
  return !text || (utf8ByteLength(text) <= 200 && /\p{L}/u.test(text) && /^[\p{L}\p{M} .'’,\-]+$/u.test(text))
}

function purchaseDateValid(value: string): boolean {
  if (!value) return true
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && !value.startsWith('0000')
}

export default function Withdraw() {
  const enabled = supporterWithdrawalEnabled()
  const siteKey = feedbackSiteKey()
  const [key, setKey] = useState(newWithdrawalKey)
  const [recovered, setRecovered] = useState(() => Boolean(pendingWithdrawalKey()))
  const [hydrated, setHydrated] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [purchaseDate, setPurchaseDate] = useState('')
  const [phase, setPhase] = useState<Phase>('details')
  const [token, setToken] = useState('')
  const [checkFailed, setCheckFailed] = useState(false)
  const [problem, setProblem] = useState('')
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [attempted, setAttempted] = useState(false)
  const [retryAt, setRetryAt] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const sending = useRef(false)
  const host = useRef<HTMLDivElement | null>(null)
  const widget = useRef<string | null>(null)
  const successHeading = useRef<HTMLHeadingElement | null>(null)
  const review = phase === 'review' || phase === 'sending' || phase === 'uncertain'

  // Never prerender an active HTML form: without JavaScript the browser could
  // otherwise put private field values into a GET URL.
  useEffect(() => { setHydrated(true) }, [])

  useEffect(() => {
    if (!enabled || !siteKey || !review) return
    let cancelled = false
    setCheckFailed(false)
    ensureTurnstileScript(siteKey).then(() => {
      if (cancelled || !host.current || !window.turnstile) return
      widget.current = window.turnstile.render(host.current, {
        sitekey: siteKey,
        action: 'withdrawal',
        appearance: 'interaction-only',
        size: host.current.clientWidth > 0 && host.current.clientWidth < 300 ? 'compact' : 'flexible',
        callback: value => { setToken(value); setCheckFailed(false) },
        'expired-callback': () => setToken(''),
        'error-callback': () => { setToken(''); setCheckFailed(true); return true },
      })
    }).catch(() => { if (!cancelled) setCheckFailed(true) })
    return () => {
      cancelled = true
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current)
      widget.current = null
      setToken('')
    }
  }, [enabled, siteKey, review])

  useEffect(() => {
    if (!retryAt || now >= retryAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [retryAt, now])
  useEffect(() => { if (phase === 'sent') successHeading.current?.focus() }, [phase])

  function showReview(event: FormEvent) {
    event.preventDefault()
    if (!safeName(name)) {
      setProblem('Use letters and common punctuation for your name, or leave it blank. Do not enter card details.')
      return
    }
    if (!clean(email, 254) || !/^[^\s@]+@[^\s@]+$/.test(email.trim()) || /\p{N}(?:[.\-_' ]*\p{N}){11}/u.test(email)) {
      setProblem('Enter a valid email address without card details.')
      return
    }
    if (!purchaseDateValid(purchaseDate)) {
      setProblem('Enter a valid purchase date, or leave it blank.')
      return
    }
    setProblem('')
    setPhase('review')
  }

  async function confirm() {
    if (sending.current || !key || !token || retryAt > Date.now()) return
    sending.current = true
    rememberWithdrawalKey(key)
    setAttempted(true)
    setPhase('sending')
    setProblem('')
    try {
      // Header rather than apiClient's retry option: the customer explicitly
      // retries an uncertain submission with the same key and same details.
      const result = await apiClient<Receipt>('/v1/portal/supporter/withdrawals', {
        method: 'POST', sensitive: true, credentials: 'omit', headers: { 'Idempotency-Key': key },
        body: { name: name.trim(), email: email.trim(), contract: purchaseDate, turnstile_token: token },
        maxResponseBytes: 4096, timeoutMs: 12_000,
      })
      if (!result.data || !/^[0-9a-f-]{36}$/i.test(result.data.reference) || !Number.isFinite(Date.parse(result.data.received_at))) throw new Error('invalid receipt')
      forgetWithdrawalKey(key)
      setReceipt(result.data)
      setPhase('sent')
    } catch (error) {
      // A lost response may follow a successful commit. Keep the original
      // details and key; never claim either success or definite failure.
      const body = isApiError(error) && error.body && typeof error.body === 'object' ? error.body as { retry_after_seconds?: unknown } : null
      const seconds = typeof body?.retry_after_seconds === 'number' && Number.isFinite(body.retry_after_seconds)
        ? Math.min(3601, Math.max(1, Math.ceil(body.retry_after_seconds))) : null
      const wait = isApiError(error) && error.status === 429 ? (seconds ? seconds * 1000 : error.retryAfterMs ?? 60_000) : 0
      setNow(Date.now())
      setRetryAt(wait ? Date.now() + wait : 0)
      setProblem(wait ? 'The form is busy. Wait before trying the same request again, or email us.' : 'We could not confirm whether your request was received. Try the same request again, or email us and mention this uncertainty.')
      setPhase('uncertain')
      setToken('')
      if (widget.current && window.turnstile) window.turnstile.reset(widget.current)
    } finally {
      sending.current = false
    }
  }

  return <PublicLayout><section className="withdraw-page" aria-labelledby="withdraw-title">
    <p className="withdraw-kicker">Pulse Supporter</p>
    <h1 id="withdraw-title">Withdraw from your contract</h1>
    <p>Use this form to tell us you wish to withdraw. You do not need an account or a reason.</p>
    <p>You can also email <a href="mailto:privacy@streampulse.stream">privacy@streampulse.stream</a>. Do not send your full card number or security code.</p>
    {!hydrated ? <p>Email us instead, or enable JavaScript to check whether the online form is available.</p> : null}
    {hydrated && (!enabled || !siteKey || !key) ? <div className="withdraw-message" role="status">
      The online form is unavailable. Please email us instead; include your name and enough detail to identify the subscription.
    </div> : null}
    {hydrated && enabled && siteKey && key && phase === 'details' ? <form className="withdraw-card" onSubmit={showReview}>
      {recovered ? <div role="status">
        <p>An earlier request in this tab may have been received. Enter the same details to check it again.</p>
        <button type="button" className={buttonClass('outline', 'sm')} onClick={() => {
          forgetWithdrawalKey(key)
          setKey(newWithdrawalKey())
          setRecovered(false)
        }}>Start a different request</button>
        <p>A different request may create a duplicate if the earlier one was received.</p>
      </div> : null}
      <label className="feedback-field"><span className="feedback-label">Your name (optional)</span>
        <input className="feedback-input" name="name" autoComplete="name" value={name} onChange={event => setName(event.target.value)} />
      </label>
      <label className="feedback-field"><span className="feedback-label">Email for your acknowledgement</span>
        <input className="feedback-input" name="email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} />
      </label>
      <label className="feedback-field"><span className="feedback-label">Purchase date (optional)</span>
        <input className="feedback-input" name="purchase-date" type="date" value={purchaseDate} onChange={event => setPurchaseDate(event.target.value)} aria-describedby="withdraw-contract-hint" />
      </label>
      <p id="withdraw-contract-hint">We only ask for a name, email and optional purchase date here. Never enter a card number or security code.</p>
      {problem ? <p role="alert">{problem}</p> : null}
      <button type="submit" className={buttonClass('default', 'lg')}>Review withdrawal</button>
    </form> : null}
    {hydrated && enabled && siteKey && key && review ? <div className="withdraw-card" aria-busy={phase === 'sending'}>
      <h2>Review your withdrawal</h2>
      <p>I wish to withdraw from my Pulse Supporter contract.</p>
      <dl><dt>Name</dt><dd>{name.trim() || 'Not provided'}</dd><dt>Acknowledgement email</dt><dd>{email.trim()}</dd><dt>Purchase date</dt><dd>{purchaseDate || 'Not provided'}</dd></dl>
      <div ref={host} aria-label="Security check" />
      {checkFailed ? <p role="alert">The security check could not load. Please email us instead.</p> : null}
      {!token && !checkFailed ? <p role="status">Waiting for the security check.</p> : null}
      {problem ? <p role="alert">{problem}</p> : null}
      {retryAt > now ? <p role="status">Try again in {Math.ceil((retryAt - now) / 1000)} seconds.</p> : null}
      <div className="withdraw-actions">
        <button type="button" className={buttonClass('default', 'lg')} disabled={!token || phase === 'sending' || retryAt > now} onClick={() => void confirm()}>
          {phase === 'sending' ? 'Sending…' : phase === 'uncertain' ? 'Try the same request again' : 'Confirm withdrawal'}
        </button>
        {!attempted ? <button type="button" className={buttonClass('outline', 'lg')} onClick={() => setPhase('details')}>Edit details</button> : null}
      </div>
    </div> : null}
    {phase === 'sent' && receipt ? <div className="withdraw-card" role="status">
      <h2 ref={successHeading} tabIndex={-1}>Withdrawal request received</h2>
      <p>We recorded your request on {new Date(receipt.received_at).toUTCString()}. An acknowledgement will be sent to {email.trim()}.</p>
      <p>Reference: <strong>{receipt.reference}</strong></p>
      <p>This confirms the request was recorded. It does not mean a refund has already been issued. If the acknowledgement does not arrive, email us with your reference.</p>
    </div> : null}
    <p>See <Link to="/refunds">cancellation and refunds</Link> and our <Link to="/privacy">privacy policy</Link>.</p>
  </section></PublicLayout>
}
