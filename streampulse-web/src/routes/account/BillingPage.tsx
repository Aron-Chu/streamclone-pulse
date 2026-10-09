import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { SUPPORTER_PERKS } from '../../ui/components/SupporterPerks'
import { DEFAULT_TRY_LATER_SECONDS, retryWaitCopy, tryLaterCopy } from '../../lib/billingTryLater'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { CreditCard } from 'lucide-react'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { AccountFooter } from './AccountFooter'
import { AccountSteps, SUPPORTER_JOURNEY_STEPS, accountReference } from './AccountJourney'
import { AccountError, billingRequest } from '../../lib/accountApi'
import { accountBillingReturnPath, accountBillingSignInHref } from '../../lib/accountBillingReturn'
import { onAccountSessionSignal } from '../../lib/accountSessionSignal'
import './account.css'

export function stripeDestination(value: unknown, kind: 'checkout' | 'portal'): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === (kind === 'checkout' ? 'checkout.stripe.com' : 'billing.stripe.com') && !url.username && !url.password && !url.port ? url.href : null
  } catch { return null }
}

/**
 * After Stripe returns, confirmation is read on this backoff (seconds) while the
 * tab is visible: about two and a half minutes in all. These are database reads;
 * the server's reconciler, not this page, talks to Stripe.
 */
export const CONFIRM_DELAYS_S = [2, 3, 5, 8, 13, 20, 30, 30, 30] as const
/** Focus and visibility re-read the membership at most this often. */
export const BILLING_WAKE_DEBOUNCE_MS = 5_000

const STATUSES = ['none', 'active', 'grace', 'pending', 'expired', 'review']
// Attempt states that may still become a payment. Only the server decides.
const OPEN_ATTEMPT = new Set(['created', 'open', 'pending'])

type Snapshot = Record<string, unknown> & { status: string }
type Load = 'loading' | 'ready' | 'signed_out' | 'error'
type Watch = 'idle' | 'confirming' | 'slow'

function readReturn(pathname: string, search: string) {
  if (!pathname.endsWith('/return')) return { invalid: false, attempt: null as string | null, cancelled: false }
  const path = accountBillingReturnPath(pathname + search)
  if (!path) return { invalid: true, attempt: null, cancelled: false }
  const query = new URLSearchParams(path.slice(path.indexOf('?')))
  return { invalid: false, attempt: query.get('attempt'), cancelled: query.get('cancelled') === '1' }
}

function longDate(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })
    : null
}

export default function BillingPage() {
  const location = useLocation()
  const navigate = useNavigate()
  // The approval note belongs to the moment of arrival, not to reloads or
  // back navigation, so it is read once and removed from history.
  const [connected, setConnected] = useState(() => (location.state as { connected?: unknown } | null)?.connected === true)
  useEffect(() => {
    if ((location.state as { connected?: unknown } | null)?.connected === true) navigate(location.pathname + location.search, { replace: true, state: null })
  }, [location, navigate])
  const { invalid, attempt, cancelled } = readReturn(location.pathname, location.search)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [load, setLoad] = useState<Load>('loading')
  const [stale, setStale] = useState<number | null>(null)
  const [attemptState, setAttemptState] = useState('')
  const [attemptMissing, setAttemptMissing] = useState(false)
  const [watch, setWatch] = useState<Watch>('idle')
  const [busy, setBusy] = useState(false)
  const [opening, setOpening] = useState(false)
  const openingRef = useRef(false)
  const [notice, setNotice] = useState('')
  // A 429 try_later from Checkout or the portal (backend #162): which action
  // and until when. Nothing is sent before then, and nothing retries by itself.
  const [paused, setPaused] = useState<{ kind: 'checkout' | 'portal'; until: number } | null>(null)
  const [reauth, setReauth] = useState(false)
  const [pendingAttempt, setPendingAttempt] = useState<string | null>(null)
  const requestID = useRef(0)
  const inFlight = useRef(false)
  const readOwner = useRef(0)
  const pendingSessionRead = useRef(false)
  const sessionRound = useRef<{ accountId: unknown; watch: Watch; step: number; hadSnapshot: boolean } | null>(null)
  const lastRead = useRef(Number.NEGATIVE_INFINITY)
  const accountID = useRef<unknown>(undefined)
  const snapshotRef = useRef<Snapshot | null>(null)
  const retryUntil = useRef(0)
  const [retrySeconds, setRetrySeconds] = useState(0)
  const step = useRef(0)
  const watchRef = useRef(watch)
  watchRef.current = watch
  const activeAttempt = attempt ?? pendingAttempt
  const returnPath = accountBillingReturnPath(location.pathname + location.search) ?? '/account/billing'
  const signInHref = accountBillingSignInHref(returnPath)

  // One read of the attempt (if any) and membership, keeping the last confirmed
  // snapshot visible instead of blanking the card during a refresh.
  const read = useCallback(async (): Promise<void> => {
    if (openingRef.current || inFlight.current || Date.now() < retryUntil.current) return
    if (watchRef.current === 'confirming' && step.current >= CONFIRM_DELAYS_S.length) {
      // React may still be batching the transition after the last read settled.
      // A second same-turn notification must not spend an extra automatic slot.
      setWatch('slow'); return
    }
    inFlight.current = true
    // Every deliberate read during confirmation uses the existing round's budget.
    if (watchRef.current === 'confirming') step.current++
    const request = ++requestID.current
    readOwner.current = request
    lastRead.current = performance.now()
    setBusy(true)
    try {
      let nextAttempt = ''
      let missing = false
      if (activeAttempt) {
        try {
          const result = await billingRequest(`/checkout/${activeAttempt}`)
          nextAttempt = typeof result.state === 'string' ? result.state : ''
        } catch (error) {
          if (!(error instanceof AccountError && error.status === 404)) throw error
          missing = true
        }
      }
      if (request !== requestID.current) return
      const result = await billingRequest('/supporter')
      if (request !== requestID.current) return
      if (result.schemaVersion !== 1 || !STATUSES.includes(String(result.status))) throw new Error('Invalid membership')
      // A different account in this browser makes the earlier attempt foreign.
      if (typeof accountID.current === 'string' && accountID.current && typeof result.accountId === 'string' && result.accountId && result.accountId !== accountID.current) setPendingAttempt(null)
      if (sessionRound.current) {
        const previous = sessionRound.current
        sessionRound.current = null
        const changedIdentity = typeof previous.accountId === 'string' && previous.accountId && typeof result.accountId === 'string' && result.accountId && previous.accountId !== result.accountId
        if (previous.hadSnapshot && !changedIdentity) {
          // A fresh session read for this same account must not restart polling.
          step.current = previous.step + (previous.watch === 'confirming' ? 1 : 0)
          const resumed = previous.watch === 'confirming' && step.current >= CONFIRM_DELAYS_S.length ? 'slow' : previous.watch
          watchRef.current = resumed; setWatch(resumed)
        } else {
          step.current = 0; watchRef.current = 'idle'; setWatch('idle')
          if (changedIdentity) setPendingAttempt(null)
        }
      }
      accountID.current = result.accountId
      snapshotRef.current = result as Snapshot
      setSnapshot(result as Snapshot)
      setAttemptState(nextAttempt)
      setAttemptMissing(missing)
      setLoad('ready')
      setStale(null)
      retryUntil.current = 0; setRetrySeconds(0)
    } catch (error) {
      // Even an invalidated request can report a cooldown for this endpoint.
      if (readOwner.current === request && error instanceof AccountError && error.retryAfterSeconds) {
        retryUntil.current = Math.max(retryUntil.current, Date.now() + error.retryAfterSeconds * 1000)
        setRetrySeconds(Math.ceil((retryUntil.current - Date.now()) / 1000))
      }
      if (request !== requestID.current) return
      if (error instanceof AccountError && error.status === 401) {
        snapshotRef.current = null
        setSnapshot(null); setLoad('signed_out'); setWatch('idle'); setStale(null)
        setPendingAttempt(null); sessionRound.current = null; step.current = 0; watchRef.current = 'idle'
        accountID.current = undefined
        return
      }
      // Keep the last confirmed membership visible and say it may be out of date.
      if (snapshotRef.current) setStale(Date.now())
      else setLoad('error')
    } finally {
      if (readOwner.current === request) {
        readOwner.current = 0; inFlight.current = false; setBusy(false)
        // Wake and session reads can consume the final slot too. Stop the
        // armed automatic timer as soon as any read finishes that budget.
        if (request === requestID.current && watchRef.current === 'confirming' && step.current >= CONFIRM_DELAYS_S.length) setWatch('slow')
        drainSessionRead()
      }
    }
  }, [activeAttempt])

  const readRef = useRef(read)
  readRef.current = read

  function drainSessionRead() {
    if (!pendingSessionRead.current || inFlight.current || openingRef.current || Date.now() < retryUntil.current) return
    pendingSessionRead.current = false
    void readRef.current()
  }

  useEffect(() => {
    if (retrySeconds <= 0) { drainSessionRead(); return }
    const timer = window.setTimeout(() => setRetrySeconds(Math.max(0, Math.ceil((retryUntil.current - Date.now()) / 1000))), 1000)
    return () => window.clearTimeout(timer)
  }, [retrySeconds])

  // Fresh state for each billing route, then the first read.
  useEffect(() => {
    snapshotRef.current = null
    setSnapshot(null); setLoad('loading'); setStale(null); setAttemptState(''); setAttemptMissing(false); setNotice(''); setReauth(false); setPendingAttempt(null)
    accountID.current = undefined
    readOwner.current = 0; inFlight.current = false; pendingSessionRead.current = false; sessionRound.current = null
    openingRef.current = false; setOpening(false)
    retryUntil.current = 0; setRetrySeconds(0); step.current = 0
    void readRef.current()
    return () => { requestID.current++; readOwner.current = 0; inFlight.current = false; pendingSessionRead.current = false; sessionRound.current = null }
  }, [location.pathname, location.search])
  // A checkout found pending mid-page is read at once under its own attempt.
  useEffect(() => { if (pendingAttempt) void readRef.current() }, [pendingAttempt])

  const status = snapshot?.status ?? ''
  const confirmed = status === 'active' || status === 'grace'
  // Payment may still complete: the attempt is open (and not a cancelled
  // return) or the membership itself reports a pending payment.
  const uncertain = !confirmed && load === 'ready' && (
    status === 'pending'
    // A checkout the server just reported pending is uncertain before its first read.
    || (Boolean(pendingAttempt) && attemptState === '')
    || (Boolean(activeAttempt) && OPEN_ATTEMPT.has(attemptState) && !(cancelled && attemptState !== 'pending'))
  )

  useEffect(() => {
    if (uncertain) setWatch(current => current === 'idle' ? 'confirming' : current)
    else setWatch('idle')
  }, [uncertain])

  // Bounded confirmation reads with backoff; paused while hidden.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (watch !== 'confirming') { if (watch === 'idle') step.current = 0; return }
    if (step.current >= CONFIRM_DELAYS_S.length) { setWatch('slow'); return }
    // A rate-limited read waits as long as the server asked before the next.
    const delay = Math.max(CONFIRM_DELAYS_S[step.current] * 1000, retryUntil.current - Date.now())
    const timer = window.setTimeout(() => {
      if (document.hidden) { setTick(value => value + 1); return }
      void readRef.current().finally(() => setTick(value => value + 1))
    }, delay)
    return () => window.clearTimeout(timer)
  }, [watch, tick])

  // Coming back to the tab (from Stripe, the extension or email) re-reads once.
  useEffect(() => {
    const wake = () => {
      if (document.hidden || load === 'loading') return
      if (performance.now() - lastRead.current >= BILLING_WAKE_DEBOUNCE_MS) void readRef.current()
    }
    const unsubscribe = onAccountSessionSignal(() => {
      // A session hint makes the previous identity's projection untrusted now.
      // Keep a held GET physically owned until it settles, then read once for
      // the current session; late results cannot render or open Stripe.
      sessionRound.current ??= { accountId: accountID.current, watch: watchRef.current, step: step.current, hadSnapshot: snapshotRef.current !== null }
      requestID.current++; openingRef.current = false; setOpening(false)
      snapshotRef.current = null
      setSnapshot(null); setLoad('loading'); setStale(null); setConnected(false)
      setAttemptState(''); setAttemptMissing(false); setNotice(''); setReauth(false)
      watchRef.current = 'idle'; setWatch('idle')
      pendingSessionRead.current = true
      drainSessionRead()
    })
    window.addEventListener('focus', wake)
    document.addEventListener('visibilitychange', wake)
    return () => {
      unsubscribe()
      window.removeEventListener('focus', wake)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [load])

  async function checkAgain() {
    await read()
  }

  useEffect(() => {
    if (!paused) return
    const timer = window.setTimeout(() => { setPaused(null); setNotice('') }, Math.min(2_147_483_647, Math.max(0, paused.until - Date.now()) + 250))
    return () => window.clearTimeout(timer)
  }, [paused])

  async function open(kind: 'checkout' | 'portal') {
    if (openingRef.current || inFlight.current || busy) return
    if (paused && Date.now() < paused.until) return
    const request = ++requestID.current
    openingRef.current = true
    setOpening(true); setNotice(''); setReauth(false)
    try {
      const result = await billingRequest(kind === 'checkout' ? '/checkout' : '/portal', {})
      if (request !== requestID.current) return
      const destination = stripeDestination(result.url, kind)
      if (!destination) throw new Error('Invalid destination')
      window.location.assign(destination)
    } catch (error) {
      if (request !== requestID.current) return
      openingRef.current = false; setOpening(false)
      if (error instanceof AccountError && error.status === 401) {
        // Changing billing needs a sign-in from the last ten minutes; the
        // membership read does not, so the page stays as it is.
        setReauth(true)
        return
      }
      if (error instanceof AccountError && error.code === 'checkout_pending') {
        // With its attempt named, the confirming card says everything needed;
        // the same attempt again means its earlier read was superseded.
        if (error.attemptId && error.attemptId !== pendingAttempt) setPendingAttempt(error.attemptId)
        else {
          if (!error.attemptId) setNotice('A checkout for this account is still being confirmed. You don’t need to pay again.')
          void readRef.current()
        }
        return
      }
      if (error instanceof AccountError && error.status === 429) {
        const until = Date.now() + (error.retryAfterSeconds ?? DEFAULT_TRY_LATER_SECONDS) * 1000
        setPaused({ kind, until })
        setNotice(tryLaterCopy(kind, until))
        return
      }
      setNotice(error instanceof AccountError && error.code === 'subscription_exists' ? 'You already have a Supporter membership. Use Manage subscription to make changes.'
        : error instanceof AccountError && error.code === 'checkout_expired' ? 'The previous checkout expired without a purchase. Nothing was charged; you can start a new checkout.'
        : error instanceof AccountError && (error.code === 'checkout_disabled' || error.code === 'checkout_not_available') ? 'Checkout is not open for this account right now.'
        : 'Billing could not open. Check your connection and try again.')
      if (error instanceof AccountError && (error.code === 'subscription_exists' || error.code === 'checkout_disabled' || error.code === 'checkout_not_available')) void read()
    }
  }

  const checkoutEnabled = snapshot?.checkoutEnabled === true
  // Only an explicit "sandbox" proves test mode; anything else shows no banner.
  const sandbox = snapshot?.environment === 'sandbox'
  const accessUntil = longDate(snapshot?.accessUntil)
  const periods = typeof snapshot?.supportPeriods === 'number' && snapshot.supportPeriods > 0 ? snapshot.supportPeriods : 0
  const reference = accountReference(snapshot?.accountId)
  // A welcome belongs to this purchase only: not to a stale or foreign return link.
  const returnedFromStripe = Boolean(attempt) && !cancelled && !attemptMissing && attemptState !== 'expired'
  const actionBusy = opening || busy
  const readBusy = actionBusy || retrySeconds > 0

  let state = 'loading'
  let title = 'Checking your membership…'
  let body: ReactNode = null
  let primary: ReactNode = null
  let secondary: ReactNode = null
  let terms = false
  let showRefresh = true

  const pausedLabel = paused ? `Try again after ${retryWaitCopy(paused.until).at}` : null
  const portal = (label: string, emphasis = true) => <button className={emphasis ? 'pulse-account-primary' : undefined} type="button" disabled={actionBusy || Boolean(paused)} onClick={() => void open('portal')}>{opening ? 'Opening…' : paused?.kind === 'portal' ? pausedLabel : label}</button>
  const checkout = (label: string) => <button className="pulse-account-primary" type="button" disabled={actionBusy || Boolean(paused)} onClick={() => void open('checkout')}>{opening ? 'Opening Stripe…' : paused?.kind === 'checkout' ? pausedLabel : label}</button>
  const refresh = (label: string) => <button className="pulse-account-primary" type="button" disabled={readBusy} onClick={() => void checkAgain()}>{busy ? 'Checking…' : label}</button>

  if (load === 'loading') {
    showRefresh = false
  } else if (load === 'signed_out') {
    state = 'signed-out'
    title = 'Sign in to see your membership'
    body = <p>{attempt && !cancelled ? 'If you just paid, sign in with the same account you used at checkout to see it confirmed. Don’t start another checkout.' : 'Supporter sign-ups are not open yet. Invited testers can sign in to see their membership. Free tools work without an account.'}</p>
    primary = <Link className="pulse-account-button pulse-account-primary" to={signInHref}>Tester sign-in</Link>
    showRefresh = false
  } else if (load === 'error' || !snapshot) {
    state = 'unavailable'
    title = 'Billing status is unavailable right now'
    body = <p>{attempt ? 'If you just paid, your payment is safe and will appear here once confirmed. Don’t start another checkout.' : 'Your membership is unchanged. Try again in a moment.'}</p>
    primary = refresh('Check again')
    showRefresh = false
  } else if (uncertain) {
    // Chosen from `uncertain` itself, so no frame can offer checkout first.
    state = watch === 'slow' ? 'confirming-slow' : 'confirming'
    title = watch === 'slow' ? 'Still confirming your payment' : 'Confirming your payment'
    body = watch === 'slow'
      ? <p>Some payments take a few minutes to confirm. Don’t start another checkout; this page and your extension update once Stripe confirms. If nothing changes within an hour, <Link to="/support">contact support</Link>.</p>
      : <p className="pulse-account-waiting"><span className="pulse-account-spinner" aria-hidden="true" />Stripe has your payment details. This usually takes a few seconds, and you don’t need to pay again. Your extension updates by itself.</p>
    primary = refresh('Check again')
    // A pending membership already has a subscription: invoices and the
    // payment method stay one click away, never a second checkout.
    secondary = status === 'pending' ? portal('Manage subscription', false) : null
    showRefresh = false
  } else if (confirmed && (returnedFromStripe || connected) && status === 'active') {
    state = 'welcome'
    title = 'You’re a Supporter'
    body = <p>Thank you. Your Supporter perks unlock in any StreamPulse extension connected to this account, and a connected extension updates by itself.</p>
    primary = portal('Manage subscription')
  } else if (status === 'active') {
    state = 'active'
    title = 'Supporter active'
    body = <p>Thank you for supporting Pulse. If you cancel, access continues until the end of the period you’ve paid for.</p>
    primary = portal('Manage subscription')
  } else if (status === 'grace') {
    state = 'grace'
    title = 'Payment needs attention'
    body = <p>Your last renewal payment didn’t go through. {accessUntil ? `Supporter stays active until ${accessUntil} while Stripe retries the payment.` : 'Supporter stays active for now while Stripe retries the payment.'} Update your payment method to keep it.</p>
    primary = portal('Update payment method')
  } else if (status === 'review') {
    state = 'review'
    title = 'Membership needs review'
    body = <p>Supporter access is paused while a payment is reviewed, for example during an open dispute. Nothing is lost, and your free tools are unaffected.</p>
    primary = portal('Manage subscription')
    secondary = <Link className="pulse-account-button" to="/support">Contact support</Link>
  } else if (status === 'expired') {
    state = 'expired'
    title = 'Supporter ended'
    body = <p>Saved Supporter preferences are kept but inactive, and your billing history stays available.{checkoutEnabled ? '' : ' New Supporter sign-ups are not open yet.'}</p>
    terms = checkoutEnabled
    primary = checkoutEnabled ? checkout('Rejoin Supporter') : portal('Billing history')
    secondary = checkoutEnabled ? portal('Billing history', false) : null
  } else if (cancelled && attempt && OPEN_ATTEMPT.has(attemptState)) {
    state = 'checkout-cancelled'
    title = 'Checkout cancelled'
    body = <><p>You left Stripe checkout before paying. Nothing was charged.</p>{!checkoutEnabled && <p>New Supporter sign-ups are not open yet.</p>}</>
    terms = checkoutEnabled
    primary = checkoutEnabled ? checkout('Return to checkout') : refresh('Refresh status')
    if (!checkoutEnabled) showRefresh = false
  } else {
    state = checkoutEnabled ? 'offer' : 'closed'
    title = attempt && attemptState === 'expired' ? 'This checkout expired' : checkoutEnabled ? 'Become a Pulse Supporter' : 'Supporter sign-ups are not open yet'
    body = attempt && attemptState === 'expired'
      ? <p>It ended without a payment. Nothing was charged.</p>
      : checkoutEnabled ? <p>Supporter funds Pulse development and adds a few original cosmetics. Every analytics feature stays free.</p>
      : <p>New Supporter sign-ups are not open yet. Your account and free tools are unaffected.</p>
    terms = true
    primary = checkoutEnabled ? checkout(attempt && attemptState === 'expired' ? 'Start a new checkout' : 'Continue to Stripe checkout') : refresh('Refresh status')
    if (!checkoutEnabled) showRefresh = false
  }

  const facts: Array<[string, string]> = []
  if ((status === 'active' || status === 'grace') && accessUntil) facts.push([status === 'grace' ? 'Access until' : 'Access through', accessUntil])
  if (periods && status !== 'none') facts.push(['Supported', `${periods} ${periods === 1 ? 'month' : 'months'}`])
  if (reference && load === 'ready') facts.push(['Pulse account', reference])

  return <PublicLayout><section className="pulse-account" aria-label="Supporter billing">
    <p className="pulse-account-kicker"><CreditCard size={16} aria-hidden="true" /> StreamPulse account</p><h1>Supporter membership</h1>
    {sandbox ? <p className="pulse-account-sandbox" role="note" data-testid="billing-sandbox-banner"><strong>Sandbox — test mode, no real charge.</strong> This page is connected to Stripe’s test environment. No real card is charged and no real membership is created.</p> : null}
    {connected ? <><AccountSteps labels={SUPPORTER_JOURNEY_STEPS} steps={['done', 'done', confirmed ? 'done' : 'current']} /><p className="pulse-account-note" data-testid="billing-connected-note">Extension approved. It finishes connecting by itself.</p></> : null}
    <div className="pulse-membership" data-state={state} aria-busy={load === 'loading' || undefined}>
      <div role="status" aria-live="polite" className="pulse-membership-status">
        <h2>{title}</h2>
        {load === 'loading' ? <p className="pulse-account-waiting"><span className="pulse-account-spinner" aria-hidden="true" />Reading your Supporter status.</p> : body}
        {invalid ? <p>This checkout link is invalid. Your current membership is shown here.</p> : null}
        {attempt && attemptMissing ? <p>This checkout link is no longer available. Your current membership is shown here.</p> : null}
        {stale !== null ? <p className="pulse-account-meta" data-testid="billing-stale">Couldn’t refresh just now; showing your status from {new Date(stale).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.</p> : null}
        {notice ? <p className="pulse-account-note">{notice}</p> : null}
      </div>
      {facts.length ? <dl className="pulse-membership-facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : null}
      {terms ? <dl className="pulse-membership-terms"><dt>Price</dt><dd>US$4.99 per month, charged in US dollars</dd><dt>Renews</dt><dd>Monthly, automatically, until you cancel</dd><dt>Includes</dt><dd>{SUPPORTER_PERKS.names.join(', ')}. Only you see them</dd><dt>Taxes</dt><dd>Handled as stated at checkout</dd></dl> : null}
      {reauth ? <div className="pulse-account-note" role="alert"><p>For your security, changing billing needs a sign-in from the last 10 minutes. Nothing was charged.</p><Link className="pulse-account-button pulse-account-primary" to={signInHref}>Sign in again</Link></div> : null}
      {!reauth && (primary || secondary) ? <div className="pulse-account-actions">{primary}{secondary}</div> : null}
      {retrySeconds > 0 && <p role="status">Wait {retrySeconds} seconds before checking again.</p>}
      {status !== 'none' && load === 'ready' && !uncertain ? <p className="pulse-account-meta">Payment details, invoices and cancellation are in the Stripe Customer Portal. Cancellation takes effect at the end of the paid period.</p> : null}
      {!reauth && showRefresh ? <button className="pulse-account-text-button" type="button" disabled={readBusy} onClick={() => void checkAgain()}>{busy ? 'Checking…' : 'Refresh status'}</button> : null}
    </div>
    <p className="pulse-account-links">{load !== 'signed_out' ? <><Link to="/account/link-device">Connect your extension</Link><span aria-hidden="true">·</span></> : null}<Link to="/terms">Supporter terms</Link><span aria-hidden="true">·</span><Link to="/refunds">Cancellation and refunds</Link><span aria-hidden="true">·</span><Link to="/support">Support</Link></p>
    <AccountFooter current="billing" />
  </section></PublicLayout>
}
