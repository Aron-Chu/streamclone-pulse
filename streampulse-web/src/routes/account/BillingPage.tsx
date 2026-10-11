import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { SUPPORTER_PERKS } from '../../ui/components/SupporterPerks'
import { BILLING_SEEN_IN_CHAT_NOTE } from '../../ui/components/SupporterChatBadgeCopy'
import { supporterChatBadgesEnabled } from '../../lib/supporterChatBadgesFlag'
import { DEFAULT_TRY_LATER_SECONDS, retryWaitCopy, tryLaterCopy } from '../../lib/billingTryLater'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { CreditCard } from 'lucide-react'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { AccountFooter } from './AccountFooter'
import { AccountSteps, SUPPORTER_JOURNEY_STEPS, accountReference } from './AccountJourney'
import { AccountError, accountErrorText, billingRequest } from '../../lib/accountApi'
import { ACCOUNT_BILLING_SUBSCRIBE_PATH, accountBillingReturnPath, accountBillingSignInHref } from '../../lib/accountBillingReturn'
import { onAccountSessionSignal } from '../../lib/accountSessionSignal'
import { knownTwitchIdentity, leaveAccountPagesAfterSignOut, signOutAccount, useAccountSession } from '../../lib/accountSession'
import { SUPPORTER_OFFER_CONFIG, billingContactEmail, statementDescriptor, stripeReceiptsOn, taxKeyFor, useSupporterOffer, type SupporterOfferView } from '../../lib/supporterOffer'
import { stripePortalLoginUrl } from '../../lib/accountStripePortalLogin'
import { captureAccountIssue } from '../../lib/sentry'
import { CHROME_WEB_STORE_LISTING_URL } from '../../lib/publicSiteConfig'
import { clearBillingStepUp, rememberBillingStepUp, takeBillingStepUp } from '../../lib/accountStepUp'
import { twitchSignInEnabled, twitchSignInPublic } from '../../lib/twitchSignInFlag'
import { beginTwitchFlow, twitchErrorCode, type TwitchErrorCode } from '../../lib/twitchSignIn'
import { TwitchButton, TwitchErrorNotice } from './TwitchSignIn'
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

function SignInAgain({ signInHref }: { signInHref: string }) {
  return <div className="pulse-account-note" role="alert"><p>For your security, changing billing needs a sign-in from the last 10 minutes. Nothing was charged.</p><Link className="pulse-account-button pulse-account-primary" to={signInHref}>Sign in again</Link></div>
}

/**
 * Recent-auth prompt while Continue with Twitch is on. Mounted only then, so
 * the /v1/account/me check behind useAccountSession runs only for this prompt.
 * Accounts that sign in with Twitch confirm with Twitch; others keep the email path.
 */
function ConfirmItsYou({ signInHref, busy, onTwitch }: { signInHref: string; busy: boolean; onTwitch: () => void }) {
  const session = useAccountSession()
  if (session.status === 'checking') return <p className="pulse-account-note" role="status">Checking your sign-in…</p>
  const twitchAccount = session.status === 'signed_in' && (session.profile.twitchLinked === true || session.profile.via === 'signin')
  if (!twitchAccount) return <SignInAgain signInHref={signInHref} />
  return <div className="pulse-account-note" role="alert" data-testid="billing-confirm-twitch"><h3>Confirm it’s you</h3><p>For your security, managing your subscription needs a Twitch check from the last 10 minutes. Nothing was charged.</p><TwitchButton busy={busy} busyLabel="Opening Twitch…" onClick={onTwitch}>Continue with Twitch</TwitchButton></div>
}


/**
 * One month after `from` in local time, with the day clamped to the end of
 * that month (Jan 31 gives Feb 28 or 29). A display estimate of Stripe's
 * billing anchor for the review screen, never a promise the server relies on.
 */
export function addOneMonthClamped(from: Date): Date {
  const year = from.getFullYear()
  const month = from.getMonth() + 1
  const lastDay = new Date(year, month + 1, 0).getDate()
  return new Date(year, month, Math.min(from.getDate(), lastDay))
}

function displayDate(value: Date): string {
  return value.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })
}

/**
 * Renewal state from the membership snapshot (backend `renewal`, `renewsOn`,
 * `endsOn`; additive under schemaVersion 1). 'unknown' means a server that
 * does not send it yet.
 */
export function renewalOf(snapshot: Record<string, unknown> | null): { kind: 'auto' | 'ends' | 'none' | 'unknown'; date: string | null } {
  const renewal = snapshot?.renewal
  if (renewal === 'auto') return { kind: 'auto', date: longDate(snapshot?.renewsOn) }
  if (renewal === 'ends') return { kind: 'ends', date: longDate(snapshot?.endsOn) }
  if (renewal === 'none') return { kind: 'none', date: null }
  return { kind: 'unknown', date: null }
}

/** "Today, plus sales tax…" or "Today. Stripe shows the total before you pay." */
function firstChargeLine(offer: SupporterOfferView): string {
  return taxKeyFor(offer.offer, offer.state) === 'fallback' ? `Today. ${offer.taxLineShort}.` : `Today, ${offer.taxLineShort}.`
}

/**
 * "Lost access to Twitch?" (spec §4): Stripe's no-code portal login when a
 * valid VITE_STRIPE_PORTAL_LOGIN_URL is set, otherwise the billing mailbox, so
 * the page never promises a link that does not exist.
 */
function LostTwitchLine() {
  const login = stripePortalLoginUrl()
  const email = billingContactEmail()
  return <p className="pulse-account-meta" data-testid="billing-lost-twitch">Lost access to Twitch?{' '}
    {login
      ? <a href={login} target="_blank" rel="noopener noreferrer" data-testid="billing-stripe-portal-login">Manage billing with your email</a>
      : <>Email <a href={`mailto:${email}`}>{email}</a>.</>}
  </p>
}

/** Who pays: the Twitch name this tab saw, or the short account reference. */
function ReviewIdentity({ reference, onSwitch, switching }: { reference: string | null; onSwitch: (() => void) | null; switching: boolean }) {
  const identity = knownTwitchIdentity()
  const name = identity?.displayName
  return <div className="pulse-account-review-who" data-testid="billing-review-identity">
    {identity?.avatarUrl ? <img src={identity.avatarUrl} alt="" width={32} height={32} referrerPolicy="no-referrer" /> : null}
    <p>{name ? <><strong>{name}</strong>{' '}</> : null}<span className="pulse-account-meta">{twitchSignInPublic() ? 'Signed in with Twitch' : 'Signed in'}{!name && reference ? ` · Pulse account ${reference}` : ''}</span>
      {onSwitch ? <>{' '}<span aria-hidden="true">·</span>{' '}<button type="button" className="pulse-account-text-button pulse-account-inline-button" disabled={switching} onClick={onSwitch}>{switching ? 'Opening Twitch…' : 'Use a different Twitch account'}</button></> : null}
    </p>
  </div>
}

/** Review rows (mockup 01, step 03). Static except the renew estimate and the tax line. */
function ReviewRows({ offer, includes }: { offer: SupporterOfferView; includes: string }) {
  const descriptor = statementDescriptor()
  return <dl className="pulse-membership-terms" data-testid="billing-review-rows">
    <dt>Pulse Supporter</dt><dd><strong>{SUPPORTER_OFFER_CONFIG.price.short}</strong></dd>
    <dt>First charge</dt><dd>{firstChargeLine(offer)}</dd>
    <dt>Renews</dt><dd>{displayDate(addOneMonthClamped(new Date()))}, then monthly</dd>
    {descriptor ? <><dt>On your statement</dt><dd>{descriptor}</dd></> : null}
    <dt>Cancel</dt><dd>Any time with Manage subscription. You keep Supporter until the end of the month you paid for.</dd>
    <dt>Includes</dt><dd>{includes}</dd>
  </dl>
}

/** Activation checkpoints after Stripe returns (spec §3.4). Facts only, never a payment claim. */
function ActivationSteps({ paid, name }: { paid: boolean; name: string | undefined }) {
  const step = (done: boolean, label: string) => <li data-done={done ? 'true' : 'false'}><span aria-hidden="true">{done ? '✓' : '◌'}</span> {label}{done ? '' : ' (waiting)'}</li>
  return <ol className="pulse-account-checklist" data-testid="billing-activation-steps">
    {step(true, 'Back from Stripe')}
    {step(paid, 'Stripe confirmed your payment')}
    {step(false, `Supporter turned on for ${name ?? 'this account'}`)}
  </ol>
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
  // Set when a "Confirm it's you" Twitch sign-in came back as a different
  // StreamPulse account: that account's portal is never offered here.
  const [wrongAccount, setWrongAccount] = useState(false)
  const wrongAccountRef = useRef(false)
  const [stepUpConfirmed, setStepUpConfirmed] = useState(false)
  const [twitchBusy, setTwitchBusy] = useState(false)
  const [twitchError, setTwitchError] = useState<TwitchErrorCode | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState('')
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
  // "Become a Supporter" from /supporter or the extension lands here with this
  // one remembered intent; it stays in the URL until Stripe opens, so "Confirm
  // it's you" returns to the same review.
  const intent = returnPath === ACCOUNT_BILLING_SUBSCRIBE_PATH
  const offer = useSupporterOffer()

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
      // Back from "Confirm it's you": the same account may continue; a different
      // one sees the wrong-account explanation and no portal button.
      const stepUp = takeBillingStepUp(result.accountId)
      if (stepUp === 'different') { wrongAccountRef.current = true; setWrongAccount(true); setStepUpConfirmed(false) }
      else if (stepUp === 'same') setStepUpConfirmed(true)
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
      captureAccountIssue('billing_read_failed')
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
    wrongAccountRef.current = false; setWrongAccount(false); setStepUpConfirmed(false); setTwitchError(null)
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
      // A sign-in or sign-out elsewhere is a deliberate choice of account; any
      // "Confirm it's you" outcome belonged to the previous session.
      wrongAccountRef.current = false; setWrongAccount(false); setStepUpConfirmed(false)
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
    if (openingRef.current || inFlight.current || busy || wrongAccountRef.current) return
    if (paused && Date.now() < paused.until) return
    const request = ++requestID.current
    openingRef.current = true
    setOpening(true); setNotice(''); setReauth(false); setStepUpConfirmed(false)
    try {
      const result = await billingRequest(kind === 'checkout' ? '/checkout' : '/portal', {})
      if (request !== requestID.current) return
      const destination = stripeDestination(result.url, kind)
      if (!destination) throw new Error('Invalid destination')
      window.location.assign(destination)
    } catch (error) {
      if (request !== requestID.current) return
      openingRef.current = false; setOpening(false)
      if (error instanceof AccountError && (error.status === 401 || error.code === 'recent_auth_required')) {
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
      else if (!(error instanceof AccountError && error.code === 'checkout_expired')) captureAccountIssue(kind === 'checkout' ? 'checkout_open_failed' : 'portal_open_failed')
    }
  }

  /** Continue with Twitch from this page: a signed-out visit (public stage) or "Confirm it's you". */
  async function continueWithTwitch(confirmAccount: boolean) {
    if (twitchBusy) return
    setTwitchBusy(true); setTwitchError(null)
    // The account that asked, tied to this exact flow, so the return can tell
    // whether Twitch chose the same one. It counts only once that flow's
    // callback finishes a sign-in (accountStepUp.ts).
    const account = accountID.current
    // On success the page leaves for Twitch, so the button stays busy.
    try { await beginTwitchFlow({ purpose: 'signin', returnTo: returnPath, beforeLeave: confirmAccount ? flowId => { rememberBillingStepUp(account, flowId) } : undefined }) }
    catch (failure) {
      // Nothing started (or leaving failed): no note may outlive this click.
      if (confirmAccount) clearBillingStepUp()
      setTwitchError(twitchErrorCode(failure)); setTwitchBusy(false)
      captureAccountIssue('twitch_flow_failed')
    }
  }

  /** "Use a different Twitch account" on the review: Twitch asks which account, then the same review. */
  async function switchTwitchAccount() {
    if (twitchBusy) return
    setTwitchBusy(true); setTwitchError(null)
    try { await beginTwitchFlow({ purpose: 'signin', forceVerify: true, returnTo: ACCOUNT_BILLING_SUBSCRIBE_PATH }) }
    catch (failure) { setTwitchError(twitchErrorCode(failure)); setTwitchBusy(false); captureAccountIssue('twitch_flow_failed') }
  }

  // A return whose confirmation outlasts the automatic reads is reported once.
  useEffect(() => { if (watch === 'slow' && attempt && !cancelled) captureAccountIssue('checkout_confirm_slow') }, [watch, attempt, cancelled])

  async function signOutOfWrongAccount() {
    if (signingOut) return
    setSigningOut(true); setSignOutError('')
    try { await signOutAccount(); leaveAccountPagesAfterSignOut() }
    catch (failure) { setSignOutError(accountErrorText(failure)); setSigningOut(false) }
  }

  // The server's sales switch on the per-account read (additive field): sales
  // are open, but this account cannot start a checkout.
  const serverSalesOpen = snapshot?.salesOpen === true
  // Only an explicit "sandbox" proves test mode; anything else shows no banner.
  const sandbox = snapshot?.environment === 'sandbox'
  // Every checkout button needs the account AND the one sales switch (spec §2).
  // The per-account checkoutEnabled alone is not enough: the server can allow
  // an account while the public offer is closed (price unread or stale) or
  // states a price this build would not show. The one exception is the
  // invited-tester sandbox pilot (SPEC §2: sandbox, salesOpen=false), and only
  // before Continue with Twitch is public. A server price that differs from the
  // one this page prints closes every path, the pilot included.
  const priceMismatch = Boolean(offer.offer?.price) && !offer.priceOk
  const sandboxPilot = sandbox && !twitchSignInPublic()
  const accountCheckout = snapshot?.checkoutEnabled === true
  const checkoutEnabled = accountCheckout && !priceMismatch && (offer.state === 'open' || sandboxPilot)
  // The offer answer is still on its way: wait for it rather than flash "not open yet".
  const offerPending = accountCheckout && !checkoutEnabled && offer.state === 'unknown' && twitchSignInPublic()
  const accessUntil = longDate(snapshot?.accessUntil)
  const renewal = renewalOf(snapshot)
  const periods = typeof snapshot?.supportPeriods === 'number' && snapshot.supportPeriods > 0 ? snapshot.supportPeriods : 0
  const reference = accountReference(snapshot?.accountId)
  // A welcome belongs to this purchase only: not to a stale or foreign return link.
  const returnedFromStripe = Boolean(attempt) && !cancelled && !attemptMissing && attemptState !== 'expired'
  const actionBusy = opening || busy
  const readBusy = actionBusy || retrySeconds > 0
  const includes = `${SUPPORTER_PERKS.names.join(', ')}. ${supporterChatBadgesEnabled() ? BILLING_SEEN_IN_CHAT_NOTE : 'Only you see them'}`

  let state = 'loading'
  let title = 'Checking your membership…'
  let body: ReactNode = null
  let primary: ReactNode = null
  let secondary: ReactNode = null
  // 'summary': the plain offer terms while closed; 'review': the one-screen review rows.
  let rows: 'none' | 'summary' | 'review' = 'none'
  let steps: ReactNode = null
  let footnote: ReactNode = null
  let lostTwitch = false
  let showRefresh = true

  const pausedLabel = paused ? `Try again after ${retryWaitCopy(paused.until).at}` : null
  const portal = (label: string, emphasis: boolean | 'text' = true) => <button className={emphasis === 'text' ? 'pulse-account-text-button' : emphasis ? 'pulse-account-primary' : undefined} type="button" disabled={actionBusy || Boolean(paused)} onClick={() => void open('portal')}>{opening ? 'Opening…' : paused?.kind === 'portal' ? pausedLabel : label}</button>
  const checkout = (label: string) => <button className="pulse-account-primary" type="button" disabled={actionBusy || Boolean(paused)} onClick={() => void open('checkout')}>{opening ? 'Opening Stripe…' : paused?.kind === 'checkout' ? pausedLabel : label}</button>
  const refresh = (label: string, quiet = false) => <button className={quiet ? 'pulse-account-text-button' : 'pulse-account-primary'} type="button" disabled={readBusy} onClick={() => void checkAgain()}>{busy ? 'Checking…' : label}</button>

  if (load === 'loading') {
    showRefresh = false
  } else if (load === 'signed_out') {
    state = 'signed-out'
    title = 'Sign in to see your membership'
    if (twitchSignInPublic()) {
      body = <p>{attempt && !cancelled ? 'If you just paid, Continue with Twitch with the same Twitch account you used at checkout to see it confirmed. Don’t start another checkout.'
        : offer.state === 'open' ? 'Continue with Twitch to become a Supporter or see your membership.'
        : 'Your Supporter membership belongs to the Twitch account you sign in with. Free tools work without an account.'}</p>
      primary = <TwitchButton busy={twitchBusy} busyLabel="Opening Twitch…" onClick={() => void continueWithTwitch(false)}>Continue with Twitch</TwitchButton>
      lostTwitch = true
    } else {
      body = <p>{attempt && !cancelled ? 'If you just paid, sign in with the same account you used at checkout to see it confirmed. Don’t start another checkout.' : 'Supporter sign-ups are not open yet. Invited testers can sign in to see their membership. Free tools work without an account.'}</p>
      primary = <Link className="pulse-account-button pulse-account-primary" to={signInHref}>Tester sign-in</Link>
    }
    showRefresh = false
  } else if (load === 'error' || !snapshot) {
    state = 'unavailable'
    title = 'Billing status is unavailable right now'
    body = <p>{attempt ? 'If you just paid, your payment is safe and will appear here once confirmed. Don’t start another checkout.' : 'Your membership is unchanged. Try again in a moment.'}</p>
    primary = refresh('Check again')
    showRefresh = false
  } else if (uncertain && attempt && !cancelled && status !== 'pending') {
    // Back from Stripe (spec §3.4): the same bounded confirmation reads, shown
    // as checkpoints. Chosen from `uncertain` itself, so no frame offers checkout.
    const slow = watch === 'slow'
    state = slow ? 'activating-slow' : 'activating'
    title = slow ? 'Still activating your membership' : 'Activating your membership'
    body = slow
      ? <p>Stripe is still confirming. This can take a few minutes, and your extension updates by itself. Don’t start another checkout.{reference ? ` Reference ${reference}-${attempt.slice(-4)}.` : ''}</p>
      : <p className="pulse-account-waiting"><span className="pulse-account-spinner" aria-hidden="true" />This page updates itself. It usually takes a few seconds.</p>
    steps = <ActivationSteps paid={attemptState === 'pending' || attemptState === 'active'} name={knownTwitchIdentity()?.displayName} />
    footnote = <p className="pulse-account-meta">You won’t be charged twice, even if you close this tab.</p>
    primary = slow ? <Link className="pulse-account-button pulse-account-primary" to="/support">Contact support</Link> : null
    // A quiet check: the page already reads by itself, so this is never the primary.
    secondary = refresh('Check again', true)
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
    // "Here's your look" (spec §3.4, payment audit F9): what they bought and where it shows.
    state = 'welcome'
    title = 'You’re a Supporter. Thank you.'
    body = <p>Here’s your look: title paint, a tenure crest that starts today, emote rain and your Supporter card, in your StreamPulse extension. {supporterChatBadgesEnabled() ? `${BILLING_SEEN_IN_CHAT_NOTE}.` : 'Only you see them.'}</p>
    steps = <ol className="pulse-account-welcome-steps" data-testid="billing-welcome-steps">
      <li>Get the StreamPulse extension.</li>
      <li>In the extension, Continue with Twitch with the same Twitch account. Your look turns on by itself.</li>
      {stripeReceiptsOn() ? <li>Stripe emailed your receipt to your billing email.</li> : null}
    </ol>
    primary = <a className="pulse-account-button pulse-account-primary" href="https://www.twitch.tv/" target="_blank" rel="noopener noreferrer">Open Twitch</a>
    secondary = <><a className="pulse-account-button" href={CHROME_WEB_STORE_LISTING_URL} target="_blank" rel="noopener noreferrer">Get the extension</a>{portal('Manage subscription', 'text')}</>
    footnote = <p className="pulse-account-meta pulse-account-narrow-only">Your look shows in the extension on desktop Chrome or Firefox.</p>
  } else if (status === 'active' && renewal.kind === 'ends' && renewal.date) {
    // Cancelled at period end (spec §3.5, payment audit F8): when it ends and how to undo it.
    state = 'ending'
    title = `Supporter ends ${renewal.date}`
    body = <p>You cancelled, so it won’t renew. You keep Supporter until then, and your crest keeps its months.</p>
    primary = portal('Resume')
    secondary = portal('Manage subscription', false)
    footnote = <p className="pulse-account-meta">Resume opens Stripe, where you choose Renew.</p>
  } else if (status === 'active' && intent) {
    state = 'already-supporter'
    title = 'You’re already a Supporter on this Twitch account'
    body = <p>There’s nothing new to buy, so you won’t be charged twice. Manage subscription shows your renewal, payment method and invoices.</p>
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
    body = <p>Saved Supporter preferences are kept but inactive, and your billing history stays available.{checkoutEnabled || offerPending ? '' : ' New Supporter sign-ups are not open yet.'}</p>
    rows = checkoutEnabled ? 'review' : 'none'
    primary = checkoutEnabled ? checkout('Rejoin Supporter') : portal('Billing history')
    secondary = checkoutEnabled ? portal('Billing history', false) : null
  } else if (cancelled && attempt && OPEN_ATTEMPT.has(attemptState)) {
    state = 'checkout-cancelled'
    title = 'Checkout cancelled'
    body = <><p>You left Stripe checkout before paying. Nothing was charged.</p>{!checkoutEnabled && !offerPending && <p>New Supporter sign-ups are not open yet.</p>}</>
    rows = checkoutEnabled ? 'review' : 'none'
    primary = checkoutEnabled ? checkout('Return to checkout') : refresh('Refresh status')
    if (!checkoutEnabled) showRefresh = false
  } else if (offerPending) {
    showRefresh = false
  } else if (checkoutEnabled) {
    // The one-screen review (spec §3.2, mockup 01 step 03). This click is the
    // deliberate confirmation: Stripe never opens by itself after Twitch.
    const expiredAttempt = Boolean(attempt) && attemptState === 'expired'
    state = 'offer'
    title = expiredAttempt ? 'This checkout expired' : 'Become a Pulse Supporter'
    body = expiredAttempt
      ? <p>It ended without a payment. Nothing was charged.</p>
      : <ReviewIdentity reference={reference} switching={twitchBusy} onSwitch={twitchSignInEnabled() ? () => void switchTwitchAccount() : null} />
    rows = 'review'
    primary = checkout(expiredAttempt ? 'Start a new checkout' : 'Continue to payment')
    footnote = <p className="pulse-account-meta" data-testid="billing-review-footnote">{offer.offer?.termsConsent ? 'You’ll accept the Supporter terms on Stripe. ' : ''}Already a Supporter on this Twitch account? We take you to Manage subscription instead, so you can’t be charged twice.</p>
    lostTwitch = true
  } else if (serverSalesOpen) {
    state = 'not-available'
    title = 'Checkout isn’t available for this account right now'
    body = <p>Supporter is open, but this account can’t start a checkout at the moment. Nothing was charged, and your free tools are unaffected.</p>
    primary = <Link className="pulse-account-button pulse-account-primary" to="/support">Contact support</Link>
    showRefresh = false
  } else {
    state = 'closed'
    title = attempt && attemptState === 'expired' ? 'This checkout expired' : 'Supporter sign-ups are not open yet'
    body = attempt && attemptState === 'expired'
      ? <p>It ended without a payment. Nothing was charged.</p>
      : <p>New Supporter sign-ups are not open yet. Your account and free tools are unaffected.</p>
    // The plain terms state this build's price; never beside a different server price.
    rows = priceMismatch ? 'none' : 'summary'
    primary = refresh('Refresh status')
    showRefresh = false
  }

  // A different account came back from "Confirm it's you": its own membership
  // is not shown as if it were the one being managed, and no billing action is
  // offered until the person chooses which account to continue with.
  if (wrongAccount && load === 'ready') {
    state = 'wrong-account'
    title = 'You came back as a different account'
    body = <p>Twitch signed you in to a different StreamPulse account{reference ? ` (${reference})` : ''} than the one that asked to manage its subscription.</p>
    primary = null; secondary = null; rows = 'none'; steps = null; footnote = null; showRefresh = false
    lostTwitch = true
  }

  const facts: Array<[string, string]> = []
  if (status === 'grace' && accessUntil) facts.push(['Access until', accessUntil])
  // A renewing membership shows when it renews (F8) and a cancelled one says
  // when it ends in its title. Every other active membership keeps "Access
  // through": renewal "none" (support access, or cancelled immediately with
  // a paid period left), and a server that does not send renewal state yet.
  if (status === 'active' && renewal.kind === 'auto' && renewal.date) facts.push(['Renews', renewal.date])
  if (status === 'active' && !renewal.date && accessUntil) facts.push(['Access through', accessUntil])
  if (periods && status !== 'none') facts.push(['Supported', `${periods} ${periods === 1 ? 'month' : 'months'}`])
  if (reference && load === 'ready') facts.push(['Pulse account', reference])
  if (wrongAccount) facts.length = 0

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
      {steps}
      {facts.length ? <dl className="pulse-membership-facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : null}
      {rows === 'review' ? <ReviewRows offer={offer} includes={includes} /> : null}
      {rows === 'summary' ? <dl className="pulse-membership-terms"><dt>Price</dt><dd>{SUPPORTER_OFFER_CONFIG.price.long}</dd><dt>Renews</dt><dd>Monthly, automatically, until you cancel</dd><dt>Includes</dt><dd>{includes}</dd><dt>Taxes</dt><dd>{offer.taxLine}</dd></dl> : null}
      {wrongAccount && load === 'ready' ? <div className="pulse-account-note" role="alert" data-testid="billing-wrong-account"><p>This subscription belongs to a different Twitch account. Sign out, then Continue with Twitch with the account you subscribed with.</p><div className="pulse-account-actions"><button type="button" className="pulse-account-primary" disabled={signingOut} onClick={() => void signOutOfWrongAccount()}>{signingOut ? 'Signing out…' : 'Sign out'}</button><button type="button" className="pulse-account-text-button" disabled={signingOut} onClick={() => { wrongAccountRef.current = false; setWrongAccount(false) }}>Stay with this account</button></div>{signOutError ? <p role="alert">{signOutError}</p> : null}</div> : null}
      {reauth && !wrongAccount ? twitchSignInEnabled()
        ? <ConfirmItsYou signInHref={signInHref} busy={twitchBusy} onTwitch={() => void continueWithTwitch(true)} />
        : <SignInAgain signInHref={signInHref} /> : null}
      {twitchError ? <TwitchErrorNotice code={twitchError} purpose="signin" returnTo={returnPath} current="/account/billing" /> : null}
      {stepUpConfirmed && !wrongAccount && !reauth ? <p className="pulse-account-note" role="status" data-testid="billing-step-up-confirmed">Thanks, that’s confirmed. Choose Manage subscription to continue.</p> : null}
      {!reauth && (primary || secondary) ? <div className="pulse-account-actions">{primary}{secondary}</div> : null}
      {!reauth ? footnote : null}
      {lostTwitch && !reauth ? <LostTwitchLine /> : null}
      {retrySeconds > 0 && <p role="status">Wait {retrySeconds} seconds before checking again.</p>}
      {status !== 'none' && load === 'ready' && !uncertain && !wrongAccount ? <p className="pulse-account-meta">Payment details, invoices and cancellation are in the Stripe Customer Portal. Cancellation takes effect at the end of the paid period.</p> : null}
      {!reauth && showRefresh ? <button className="pulse-account-text-button" type="button" disabled={readBusy} onClick={() => void checkAgain()}>{busy ? 'Checking…' : 'Refresh status'}</button> : null}
    </div>
    <p className="pulse-account-links">{load !== 'signed_out' && !twitchSignInPublic() ? <><Link to="/account/link-device">Connect your extension</Link><span aria-hidden="true">·</span></> : null}<Link to="/terms">Supporter terms</Link><span aria-hidden="true">·</span><Link to="/refunds">Cancellation and refunds</Link><span aria-hidden="true">·</span><Link to="/support">Support</Link></p>
    <AccountFooter current="billing" />
  </section></PublicLayout>
}
