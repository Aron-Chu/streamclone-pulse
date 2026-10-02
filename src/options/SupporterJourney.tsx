import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { BackgroundResponse } from '../shared/messages.ts'
import { POLICY_LINKS, deviceLinkWithCode, productLink } from '../shared/portalLinks.ts'
import {
  ACCOUNT_REVISION_KEY,
  SUPPORTER_REVISION_KEY,
  type SupporterAccountAction,
  type SupporterAccountState,
  type SupporterEntitlement,
  type SupporterUnavailableReason,
  type SupporterBillingState,
  type SupporterRestoreState,
} from '../shared/supporterAccount.ts'
import { PulseSectionCard } from '../ui/PulseSectionCard.tsx'
import { usePortalOrigin } from './usePortalOrigin.ts'

/**
 * Account connection and Supporter membership as one journey.
 *
 * The worker owns credentials, polling secrets and every HTTP request; this page
 * receives safe projections and asks it to act. Purchase and billing management
 * happen on Stripe through the installation bearer. Older deployments retain
 * the website account flow. Nothing here asserts an
 * entitlement locally: paid access appears only after the server projects it.
 */

// USD only at launch, matching the public /supporter page.
const PRICE_DISPLAY = 'US$4.99 / month'
/** Reads after a purchase or payment wait stop after this long; focus still refreshes. */
export const MEMBERSHIP_WATCH_MS = 15 * 60_000
/** Backoff for those reads while the page is visible. */
export const MEMBERSHIP_WATCH_DELAYS_MS = [5_000, 5_000, 10_000, 10_000, 15_000, 20_000, 30_000] as const
/** Focus and visibility re-read membership at most this often. */
export const MEMBERSHIP_WAKE_DEBOUNCE_MS = 5_000

type Intent = 'purchase' | 'connect' | null
// This tab's journey survives a reload of settings; it is a flow name only.
const INTENT_KEY = 'pulse.supporterJourneyIntent.v1'
function storedIntent(): Intent {
  try {
    const value = sessionStorage.getItem(INTENT_KEY)
    return value === 'purchase' || value === 'connect' ? value : null
  } catch { return null }
}
function storeIntent(value: Intent): void {
  try {
    if (value) sessionStorage.setItem(INTENT_KEY, value)
    else sessionStorage.removeItem(INTENT_KEY)
  } catch { /* Storage restrictions only lose the continuation hint. */ }
}

const UNAVAILABLE_COPY: Record<SupporterUnavailableReason, string> = {
  not_deployed: 'Supporter is not available on the server yet.',
  temporarily_unavailable: 'Supporter status is temporarily unavailable. Check again in a moment.',
  environment_mismatch: 'Supporter is not open in this build yet.',
}

const UNLINKED_NOTICE: Partial<Record<SupporterAccountState['state'], string>> = {
  denied: 'The last connection request was declined. You can start again when ready.',
  expired: 'The last connection request expired before it was approved. Start again when ready.',
  relink_required: 'This extension was disconnected from your Pulse account. Connect again to restore your Supporter status here.',
}

/** A short, non-secret reference that matches the one streampulse.stream shows. */
export function accountReference(accountId: string): string {
  return `··${accountId.replace(/-/g, '').slice(-6)}`
}

function shortDate(value: string | undefined): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null
  return new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

function openPortal(url: string): void {
  const tabs = globalThis.chrome?.tabs
  const fallback = () => { window.open(url, '_blank', 'noopener,noreferrer') }
  if (typeof tabs?.create === 'function') {
    try { void Promise.resolve(tabs.create({ url })).catch(fallback) } catch { fallback() }
  } else fallback()
}

type Step = 'done' | 'current' | 'todo'
function Progress({ steps }: { steps: [Step, Step, Step] }) {
  const labels = ['Pulse account', 'This extension', 'Supporter']
  return (
    <ol className="pulse-journey-steps" aria-label="Supporter setup progress">
      {labels.map((label, index) => (
        <li key={label} data-step={steps[index]} aria-current={steps[index] === 'current' ? 'step' : undefined}>
          <span className="pulse-journey-step-mark" aria-hidden="true">{steps[index] === 'done' ? '✓' : index + 1}</span>
          <span>{label}<span className="pulse-visually-hidden">{steps[index] === 'done' ? ' (done)' : steps[index] === 'current' ? ' (in progress)' : ''}</span></span>
        </li>
      ))}
    </ol>
  )
}

function OfferTerms() {
  return (
    <>
      <dl className="pulse-supporter-terms">
        <dt>Price</dt><dd>{PRICE_DISPLAY}</dd>
        <dt>Renews</dt><dd>Monthly, until you cancel</dd>
        <dt>Cancel</dt><dd>Any time; access runs to the end of the paid month</dd>
        <dt>You get</dt><dd>A private Pulse header accent, three accent finishes, and private support recognition</dd>
      </dl>
      {/* The "You get" row lists only shipped benefits, and the chat badge
          has its own card, so it is not restated here. */}
      <p className="pulse-supporter-detail">Taxes, if any, are shown before you pay.</p>
    </>
  )
}

export function SupporterJourney({ onEntitlement }: { onEntitlement?: (value: SupporterEntitlement | null) => void } = {}) {
  const portalOrigin = usePortalOrigin()
  const [account, setAccount] = useState<SupporterAccountState | null>(null)
  const [entitlement, setEntitlement] = useState<SupporterEntitlement | null>(null)
  // A quiet re-read that failed keeps the last membership on screen, marked
  // stale, instead of blanking the card; paid controls only see fresh values.
  const [stale, setStale] = useState(false)
  const [accountBusy, setAccountBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [notice, setNotice] = useState('')
  const [billing, setBilling] = useState<SupporterBillingState>({ state: 'idle' })
  const [restore, setRestore] = useState<SupporterRestoreState>({ state: 'idle' })
  const [restoreForm, setRestoreForm] = useState(false)
  const [restoreEmail, setRestoreEmail] = useState('')
  const [payBusy, setPayBusy] = useState(false)
  const payInFlight = useRef(false)
  const [intent, setIntentState] = useState<Intent>(storedIntent)
  const setIntent = useCallback((value: Intent) => { storeIntent(value); setIntentState(value) }, [])
  const [watchUntil, setWatchUntil] = useState(0)
  const accountRequest = useRef(0)
  const accountInFlight = useRef(false)
  const entitlementRequest = useRef(0)
  const entitlementInFlight = useRef(false)
  const lastEntitlementRead = useRef(Number.NEGATIVE_INFINITY)
  const pendingOpen = useRef<Intent>(null)
  // The membership on screen, for deciding whether a failed quiet read can keep it.
  const shown = useRef<SupporterEntitlement | null>(null)
  const lastAccount = useRef<SupporterAccountState | null>(null)

  useEffect(() => { onEntitlement?.(stale ? null : entitlement) }, [entitlement, stale, onEntitlement])

  const readEntitlement = useCallback(async (quiet: boolean) => {
    if (entitlementInFlight.current) return
    entitlementInFlight.current = true
    const id = ++entitlementRequest.current
    lastEntitlementRead.current = performance.now()
    if (!quiet) setChecking(true)
    try {
      const response: BackgroundResponse = await chrome.runtime.sendMessage({ type: 'SUPPORTER_ENTITLEMENT' })
      if (id !== entitlementRequest.current) return
      if (!response || !('type' in response) || response.type !== 'SUPPORTER_ENTITLEMENT') throw new Error('worker unavailable')
      const next = response.entitlement
      if (quiet && shown.current?.state === 'ready' && (next.state === 'error' || (next.state === 'unavailable' && next.reason === 'temporarily_unavailable'))) {
        setStale(true)
      } else {
        shown.current = next
        setStale(false)
        setEntitlement(next)
      }
    } catch {
      if (id !== entitlementRequest.current) return
      if (quiet && shown.current?.state === 'ready') setStale(true)
      else {
        shown.current = { state: 'error' }
        setStale(false)
        setEntitlement({ state: 'error' })
      }
    } finally {
      if (id === entitlementRequest.current) { entitlementInFlight.current = false; setChecking(false) }
    }
  }, [])

  const run = useCallback(async (action: SupporterAccountAction): Promise<SupporterAccountState | null> => {
    if (accountInFlight.current) return null
    accountInFlight.current = true
    const id = ++accountRequest.current
    const background = action === 'poll' || action === 'status'
    if (!background) { setAccountBusy(true); setNotice('') }
    try {
      const response: BackgroundResponse = await chrome.runtime.sendMessage({ type: 'SUPPORTER_ACCOUNT', action })
      if (id !== accountRequest.current) return null
      if (!response || !('type' in response) || response.type !== 'SUPPORTER_ACCOUNT') throw new Error('Account worker unavailable')
      // The worker forgets why it cleared a credential, so a connection that
      // vanished without the user asking (revoked on the website, or rejected
      // by the server) is explained here rather than silently becoming an offer.
      const previous = lastAccount.current?.state
      const vanished = (previous === 'linked' || previous === 'relink_required') && response.account.state === 'signed_out' && action !== 'disconnect' && action !== 'cancel'
      const next: SupporterAccountState = vanished ? { state: 'relink_required' } : response.account
      lastAccount.current = next
      setAccount(next)
      if (action === 'disconnect' && response.account.state === 'error') {
        setNotice('Disconnect did not finish cleanly; server revocation could not be confirmed. Check the connection before trying again.')
      }
      return response.account
    } catch {
      if (id === accountRequest.current) {
        lastAccount.current = { state: 'error' }
        setAccount({ state: 'error' })
        if (action === 'disconnect') setNotice('Disconnect could not be confirmed. Try again when the extension is available.')
      }
      return null
    } finally {
      if (id === accountRequest.current) { accountInFlight.current = false; setAccountBusy(false) }
    }
  }, [])

  const readJourney = useCallback(async () => {
    try {
      const [pay, recovery]: BackgroundResponse[] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'SUPPORTER_BILLING', action: 'status' }),
        chrome.runtime.sendMessage({ type: 'SUPPORTER_RESTORE', action: 'status' }),
      ])
      if (pay && 'type' in pay && pay.type === 'SUPPORTER_BILLING') setBilling(pay.billing)
      if (recovery && 'type' in recovery && recovery.type === 'SUPPORTER_RESTORE') setRestore(recovery.restore)
    } catch { /* Older workers retain the existing journey. */ }
  }, [])
  useEffect(() => { if (restore.state === 'restored') setRestoreForm(false) }, [restore.state])

  // Initial reads, and the worker's non-secret change signals.
  useEffect(() => {
    void run('status')
    void readEntitlement(false)
    void readJourney()
    const changed = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (ACCOUNT_REVISION_KEY in changes || 'backendUrl' in changes || 'localBackendOptIn' in changes) {
        // An old account's pending read must never restore access after a switch.
        entitlementRequest.current++
        entitlementInFlight.current = false
        shown.current = null
        setEntitlement(null)
        setStale(false)
        void run('status')
        void readEntitlement(false)
        void readJourney()
        return
      }
      if (SUPPORTER_REVISION_KEY in changes) { void readEntitlement(true); void readJourney() }
    }
    const storage = globalThis.chrome?.storage?.onChanged
    storage?.addListener(changed)
    return () => {
      accountRequest.current++
      accountInFlight.current = false
      entitlementRequest.current++
      entitlementInFlight.current = false
      storage?.removeListener(changed)
    }
  }, [run, readEntitlement, readJourney])

  useEffect(() => {
    if (billing.state !== 'waiting' && billing.state !== 'confirming' && restore.state !== 'pending') return
    const timer = window.setTimeout(() => { void readJourney() }, 5_000)
    return () => window.clearTimeout(timer)
  }, [billing, restore, readJourney])

  const pending = account?.state === 'pending' ? account : null
  const linked = account?.state === 'linked' ? account : null
  const status = entitlement?.state === 'ready' ? entitlement.status : null

  // The worker owns the link schedule and consumes approval when it is due.
  // This page only asks; reading while hidden is what lets an approval made in
  // the website tab finish before the user switches back.
  useEffect(() => {
    if (!pending || accountBusy) return
    const timer = window.setTimeout(() => { void run('poll') }, Math.max(5, pending.retryAfterSeconds) * 1000)
    return () => window.clearTimeout(timer)
  }, [pending, accountBusy, run])

  // After a purchase starts, or while a payment is pending, keep reading the
  // server projection on a bounded backoff while the page is visible.
  const watching = linked !== null && watchUntil > 0 && (status === null || status === 'none' || status === 'pending' || status === 'expired')
  const watchStep = useRef(0)
  const [watchTick, setWatchTick] = useState(0)
  useEffect(() => {
    if (status === 'pending' && linked) setWatchUntil(current => current > Date.now() ? current : Date.now() + MEMBERSHIP_WATCH_MS)
  }, [status, linked])
  useEffect(() => {
    if (!watching) { watchStep.current = 0; return }
    if (Date.now() >= watchUntil) { setWatchUntil(0); return }
    const delay = MEMBERSHIP_WATCH_DELAYS_MS[Math.min(watchStep.current, MEMBERSHIP_WATCH_DELAYS_MS.length - 1)]
    const timer = window.setTimeout(() => {
      watchStep.current++
      // Hidden pages skip the read but keep the schedule; focus reads at once.
      if (document.hidden) { setWatchTick(tick => tick + 1); return }
      void readEntitlement(true).finally(() => setWatchTick(tick => tick + 1))
    }, delay)
    return () => window.clearTimeout(timer)
  }, [watching, watchUntil, watchTick, readEntitlement])

  // Returning from the website is the moment the user expects an update.
  useEffect(() => {
    const wake = () => {
      if (document.hidden) return
      void readJourney()
      if (account?.state === 'pending') void run('poll')
      if (performance.now() - lastEntitlementRead.current >= MEMBERSHIP_WAKE_DEBOUNCE_MS) void readEntitlement(true)
    }
    window.addEventListener('focus', wake)
    document.addEventListener('visibilitychange', wake)
    return () => {
      window.removeEventListener('focus', wake)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [account?.state, run, readEntitlement, readJourney])

  // A link started for a purchase continues to billing on the website; once it
  // completes here, keep watching for the verified membership.
  useEffect(() => {
    if (linked && intent === 'purchase') setWatchUntil(current => current > Date.now() ? current : Date.now() + MEMBERSHIP_WATCH_MS)
  }, [linked, intent])
  useEffect(() => {
    if (status === 'active' || status === 'grace' || status === 'review') setWatchUntil(0)
    // The journey is complete: this view keeps its welcome, a reload does not.
    if (status === 'active' || status === 'grace') storeIntent(null)
  }, [status])

  async function begin(next: Exclude<Intent, null>) {
    // A second click before the first request returns must not cancel the
    // tab the first one is about to open.
    if (accountInFlight.current) return
    setIntent(next)
    pendingOpen.current = next
    const result = await run('start')
    if (pendingOpen.current !== next) return
    pendingOpen.current = null
    if (result?.state === 'pending') openPortal(deviceLinkWithCode(result.code, portalOrigin, next === 'purchase' ? 'billing' : undefined))
  }

  async function purchase() {
    if (payInFlight.current || accountInFlight.current) return
    payInFlight.current = true; setPayBusy(true); setNotice(''); setIntent('purchase')
    try {
      const response: BackgroundResponse = await chrome.runtime.sendMessage({ type: 'SUPPORTER_BILLING', action: 'checkout' })
      if (!response || !('type' in response) || response.type !== 'SUPPORTER_BILLING' || response.billing.state === 'fallback') {
        if (linked) openPortal(billingHref)
        else await begin('purchase')
        return
      }
      setBilling(response.billing)
      await run('status'); await readEntitlement(true)
      setWatchUntil(Date.now() + MEMBERSHIP_WATCH_MS)
    } catch { setBilling({ state: 'unavailable' }) }
    finally { payInFlight.current = false; setPayBusy(false) }
  }

  async function manage() {
    if (payInFlight.current) return
    if (entitlement?.state !== 'ready' || entitlement.installationAccountsEnabled !== true) { openPortal(billingHref); return }
    payInFlight.current = true; setPayBusy(true)
    try {
      const response: BackgroundResponse = await chrome.runtime.sendMessage({ type: 'SUPPORTER_BILLING', action: 'portal' })
      if (response && 'type' in response && response.type === 'SUPPORTER_BILLING' && response.billing.state === 'fallback') openPortal(billingHref)
      else if (!response || !('type' in response) || response.type !== 'SUPPORTER_BILLING' || response.billing.state === 'error' || response.billing.state === 'unavailable') setNotice('Could not open membership management. Try again when the service is available.')
    } catch { setNotice('Could not open membership management. Try again when the service is available.') }
    finally { payInFlight.current = false; setPayBusy(false) }
  }

  async function startRestore(event: React.FormEvent) {
    event.preventDefault()
    if (payInFlight.current) return
    payInFlight.current = true; setPayBusy(true); setNotice(''); setIntent(null); setWatchUntil(0)
    try {
      const response: BackgroundResponse = await chrome.runtime.sendMessage({ type: 'SUPPORTER_RESTORE', action: 'start', email: restoreEmail.trim() })
      setRestoreEmail('')
      if (!response || !('type' in response) || response.type !== 'SUPPORTER_RESTORE') throw new Error('restore unavailable')
      setRestore(response.restore)
      if (response.restore.state === 'fallback') { setRestoreForm(false); await begin('connect') }
      await run('status'); await readEntitlement(true)
    } catch { setRestore({ state: 'unavailable' }) }
    finally { payInFlight.current = false; setPayBusy(false) }
  }

  function openBilling() {
    setIntent('purchase')
    setWatchUntil(Date.now() + MEMBERSHIP_WATCH_MS)
  }

  async function checkAgain() {
    if (!linked) await run('status')
    await readEntitlement(false)
  }

  const billingHref = productLink('billing', portalOrigin)
  const isSupporter = status === 'active' || status === 'grace'
  const checkoutOpen = entitlement?.state === 'ready' && entitlement.checkoutEnabled === true
  const accessDate = entitlement?.state === 'ready' ? shortDate(entitlement.accessUntil) : null
  const periods = entitlement?.state === 'ready' ? entitlement.supportPeriods : 0
  const unlinked = account !== null && (account.state === 'signed_out' || account.state === 'denied' || account.state === 'expired' || account.state === 'relink_required')
  const linkingNotDeployed = account?.state === 'unavailable' && account.reason === 'not_deployed' && !account.linked
  const accountDown = (account?.state === 'unavailable' && !account.linked && account.reason === 'temporarily_unavailable') || (account?.state === 'error' && !account.revocationPending)
  const renewalWaiting = account?.state === 'unavailable' && account.linked === true
  const revocationPending = account?.state === 'error' && account.revocationPending === true

  let state: string
  let title: string
  let body: ReactNode = null
  let primary: ReactNode = null
  let secondary: ReactNode[] = []
  let terms = false
  let steps: [Step, Step, Step] | null = null

  if (!account) {
    state = 'loading'
    title = 'Checking your Supporter status…'
  } else if (revocationPending) {
    state = 'revocation-pending'
    title = 'Account access is stopped on this extension'
    body = <p className="pulse-supporter-detail">Server revocation is still pending. Retry when you are connected.</p>
    secondary = [<button key="retry" type="button" disabled={accountBusy} onClick={() => void run('disconnect')}>Retry disconnect</button>]
  } else if (linkingNotDeployed) {
    state = 'not-deployed'
    title = 'Supporter is not available yet'
    body = <p className="pulse-supporter-detail">Account linking is not available on the server yet. Your free tools still work.</p>
  } else if (accountDown) {
    state = 'account-unavailable'
    title = 'Account service unavailable'
    body = <p className="pulse-supporter-detail">The account service could not be reached. Your free tools still work; check again in a moment.</p>
    secondary = [<button key="check" type="button" disabled={accountBusy || checking} onClick={() => void checkAgain()}>Check again</button>]
  } else if (pending) {
    state = 'link-pending'
    steps = ['current', 'current', 'todo']
    title = 'Finish on streampulse.stream'
    body = <>
      <p>{intent === 'purchase'
        ? 'Sign in and approve this extension in the tab that opened. You then continue straight to secure checkout.'
        : 'Sign in and approve this extension in the tab that opened. This page updates by itself.'}</p>
      <p className="pulse-supporter-detail">If the website asks for a code, it is <span className="pulse-account-link-code">{pending.code}</span>. It expires at {new Date(pending.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.</p>
    </>
    primary = <a className="pulse-journey-primary" href={deviceLinkWithCode(pending.code, portalOrigin, intent === 'purchase' ? 'billing' : undefined)} target="_blank" rel="noopener noreferrer">Reopen streampulse.stream</a>
    secondary = [<button key="cancel" type="button" disabled={accountBusy} onClick={() => { setIntent(null); void run('cancel') }}>Cancel</button>]
  } else if (unlinked) {
    state = 'unlinked'
    steps = null
    title = 'Become a Pulse Supporter'
    body = <>
      {UNLINKED_NOTICE[account.state] ? <p className="pulse-journey-notice">{UNLINKED_NOTICE[account.state]}</p> : null}
      <p>Supporter funds Pulse development and adds a few original cosmetics.</p>
    </>
    terms = true
    primary = <button className="pulse-journey-primary" type="button" disabled={accountBusy || payBusy} onClick={() => void purchase()}>{payBusy ? 'Preparing checkout…' : 'Become a Supporter'}</button>
    secondary = [<button key="restore" type="button" disabled={accountBusy || payBusy} onClick={() => { setRestoreForm(true); setRestore({ state: 'idle' }) }}>Restore my Supporter</button>, <button key="connect" type="button" disabled={accountBusy || payBusy} onClick={() => void begin('connect')}>{accountBusy && intent === 'connect' ? 'Preparing…' : 'Use a StreamPulse website account'}</button>]
  } else if (renewalWaiting) {
    state = 'connection-waiting'
    title = 'Connected, but the account service is unavailable'
    body = <p className="pulse-supporter-detail">This extension is still connected. Your free tools still work; check again in a moment.</p>
    secondary = [<button key="check" type="button" disabled={accountBusy || checking} onClick={() => void checkAgain()}>Check again</button>]
  } else if (!entitlement || entitlement.state === 'not_linked') {
    state = 'membership-loading'
    title = 'Checking Supporter status…'
    steps = ['done', 'done', 'current']
  } else if (entitlement.state === 'unavailable' || entitlement.state === 'error') {
    state = 'membership-unknown'
    title = 'Supporter status unavailable'
    body = <p className="pulse-supporter-detail">{entitlement.state === 'unavailable' && 'reason' in entitlement ? UNAVAILABLE_COPY[entitlement.reason] : 'Could not reach StreamPulse to check Supporter status.'} Your free tools are unaffected.</p>
    secondary = [<button key="check" type="button" disabled={checking} onClick={() => void checkAgain()}>{checking ? 'Checking…' : 'Check again'}</button>]
  } else if (status === 'none') {
    steps = ['done', 'done', 'current']
    if (!checkoutOpen) {
      state = 'checkout-closed'
      title = 'Supporter sign-ups are not open yet'
      body = <p>Your account is connected. The offer appears here when sign-ups open.</p>
      terms = true
    } else if (entitlement.installationAccountsEnabled === true) {
      state = 'offer'; title = 'Become a Pulse Supporter'
      body = <p>Pay on Stripe. This extension updates by itself after your payment is confirmed.</p>
      primary = <button className="pulse-journey-primary" type="button" disabled={payBusy} onClick={() => void purchase()}>{payBusy ? 'Preparing checkout…' : 'Become a Supporter'}</button>
      terms = true
    } else if (intent === 'purchase') {
      state = 'purchase-continuing'
      title = 'Complete your purchase on streampulse.stream'
      body = <p>Supporter turns on here by itself after Stripe confirms your payment.</p>
      primary = <a className="pulse-journey-primary" data-supporter-action="billing" href={billingHref} target="_blank" rel="noopener noreferrer" onClick={openBilling}>Return to checkout</a>
    } else {
      state = 'offer'
      title = 'Become a Pulse Supporter'
      body = <p>Supporter funds Pulse development and adds a few original cosmetics.</p>
      terms = true
      primary = <a className="pulse-journey-primary" data-supporter-action="billing" href={billingHref} target="_blank" rel="noopener noreferrer" onClick={openBilling}>Continue to checkout</a>
    }
  } else if (status === 'pending') {
    state = 'payment-pending'
    steps = ['done', 'done', 'current']
    title = 'Confirming your payment'
    body = <p>Stripe is still confirming your payment. Supporter turns on here by itself; you do not need to pay again.</p>
    primary = <a className="pulse-journey-primary" data-supporter-action="billing" href={billingHref} target="_blank" rel="noopener noreferrer">View payment status</a>
  } else if (status === 'active') {
    state = 'active'
    title = intent === 'purchase' ? 'You are a Supporter' : 'Supporter active'
    body = <p>{intent === 'purchase' ? 'Thank you. Your Supporter finishes are unlocked below.' : 'Thank you for supporting Pulse.'}</p>
    primary = <a className="pulse-journey-secondary-link" data-supporter-action="billing" href={billingHref} target="_blank" rel="noopener noreferrer">Manage membership</a>
  } else if (status === 'grace') {
    state = 'grace'
    title = 'Payment needs attention'
    body = <p>Your last renewal did not go through. {accessDate ? `Supporter stays on until ${accessDate} while Stripe retries the payment.` : 'Supporter stays on for now while Stripe retries the payment.'}</p>
    primary = <a className="pulse-journey-primary" data-supporter-action="billing" href={billingHref} target="_blank" rel="noopener noreferrer">Update payment method</a>
  } else if (status === 'expired') {
    state = 'expired'
    title = 'Supporter ended'
    body = <p className="pulse-supporter-detail">Saved Supporter preferences are kept but inactive. Your free settings and data are untouched.</p>
    terms = checkoutOpen
    primary = <a className={checkoutOpen ? 'pulse-journey-primary' : 'pulse-journey-secondary-link'} data-supporter-action="billing" href={billingHref} target="_blank" rel="noopener noreferrer" onClick={checkoutOpen ? openBilling : undefined}>{checkoutOpen ? 'Rejoin Supporter' : 'Review membership'}</a>
  } else {
    state = 'review'
    title = 'Membership needs review'
    body = <p className="pulse-supporter-detail">Something about a payment needs checking, for example an open dispute. Nothing is lost; support can help.</p>
    primary = <a className="pulse-journey-primary" data-supporter-action="billing" href={billingHref} target="_blank" rel="noopener noreferrer">Review membership</a>
  }

  // Worker-owned uncertainty always outranks the offer, including after settings
  // closes or reloads. A failed return page is never evidence of payment.
  if (!isSupporter && billing.state !== 'idle' && billing.state !== 'fallback') {
    steps = null; terms = false; primary = null; secondary = []
    if (billing.state === 'waiting') { state = 'stripe-open'; title = 'Stripe checkout is open'; body = <p>Complete payment in the Stripe tab. This extension updates by itself; you do not need to refresh.</p>; primary = <button className="pulse-journey-primary" type="button" disabled={payBusy} onClick={() => { void chrome.runtime.sendMessage({ type: 'SUPPORTER_BILLING', action: 'resume' }).then(() => readJourney()).catch(() => setNotice('Could not reopen Stripe. Check status before trying another payment.')) }}>Return to Stripe checkout</button> }
    else if (billing.state === 'confirming' || billing.state === 'still_confirming') {
      state = billing.state === 'confirming' ? 'payment-pending' : 'still-confirming'
      title = billing.state === 'confirming' ? 'Confirming your payment' : 'Still confirming your payment'
      body = <p>Your payment status is not confirmed yet. Do not pay again. {billing.state === 'still_confirming' ? 'Check status when you return, or contact support if it stays unresolved.' : 'Supporter turns on here after the server confirms it.'}</p>
      if (billing.state === 'still_confirming') primary = <button className="pulse-journey-primary" type="button" onClick={() => { void readJourney(); void readEntitlement(false) }}>Check payment status</button>
    } else if (billing.state === 'closed') { state = 'checkout-closed'; title = 'Supporter sign-ups are not open yet'; body = <p>Your free tools still work. Return when paid sign-ups open.</p> }
    else if (billing.state === 'expired') { state = 'checkout-expired'; title = 'Checkout expired'; body = <p>The checkout session ended before completion. You can start a new checkout when ready.</p>; primary = <button className="pulse-journey-primary" type="button" disabled={payBusy} onClick={() => void purchase()}>Start checkout again</button> }
    else if (billing.state === 'review') { state = 'review'; title = 'Membership needs review'; body = <p>A payment needs checking. Do not pay again; contact support for help.</p>; primary = <a className="pulse-journey-primary" href={POLICY_LINKS.support} target="_blank" rel="noopener noreferrer">Contact support</a> }
    else if (billing.state === 'unavailable' || billing.state === 'error') { state = 'billing-unavailable'; title = 'Checkout could not be opened'; body = <p>The service is unavailable. Your free tools still work. Check your payment status before trying again.</p>; primary = <button className="pulse-journey-primary" type="button" onClick={() => { void readJourney(); void readEntitlement(false) }}>Check payment status</button> }
  }
  if (entitlement?.state === 'ready' && entitlement.installationAccountsEnabled === true && (isSupporter || status === 'expired' || status === 'review')) {
    primary = status === 'expired' && checkoutOpen ? <button className="pulse-journey-primary" type="button" disabled={payBusy} onClick={() => void purchase()}>Rejoin Supporter</button>
      : <button className={status === 'active' ? 'pulse-journey-secondary-link' : 'pulse-journey-primary'} type="button" disabled={payBusy} onClick={() => void manage()}>{status === 'grace' ? 'Update payment method' : 'Manage membership'}</button>
  }
  if ((linked && status === 'none' || unlinked && billing.state !== 'idle') && !restoreForm && restore.state !== 'pending') secondary.push(<button key="restore-linked" type="button" disabled={payBusy} onClick={() => { setRestoreForm(true); setRestore({ state: 'idle' }) }}>Restore my Supporter</button>)
  if (restore.state === 'pending' || restore.state === 'expired' || restore.state === 'conflict' || restore.state === 'unavailable' || restore.state === 'error') {
    steps = null; terms = false; primary = null; secondary = []
    state = `restore-${restore.state}`
    title = restore.state === 'pending' ? 'Check your email' : restore.state === 'expired' ? 'Restore link expired' : restore.state === 'conflict' ? 'This extension already has billing history' : 'Restore could not be started'
    body = <p>{restore.state === 'pending' ? 'If that email has a recoverable membership, we sent a link. Confirm restore in the email tab; this extension updates by itself.' : restore.state === 'conflict' ? 'Accounts with billing history cannot be combined. Contact support to choose which membership to use.' : restore.state === 'expired' ? 'Request a new link when you are ready.' : 'Try again when the account service is available.'}</p>
    if (restore.state === 'expired' || restore.state === 'unavailable' || restore.state === 'error') primary = <button className="pulse-journey-primary" type="button" onClick={() => { setRestore({ state: 'idle' }); setRestoreForm(true) }}>Try restore again</button>
    if (restore.state === 'conflict') primary = <a className="pulse-journey-primary" href={POLICY_LINKS.support} target="_blank" rel="noopener noreferrer">Contact support</a>
  }
  if (restoreForm && restore.state === 'idle') {
    state = 'restore-email'; title = 'Restore your Supporter'; steps = null; terms = false; primary = null; secondary = []
    body = <p>Use the email you gave Stripe. Confirm the restore link to connect this browser.</p>
  }

  const facts: Array<[string, string]> = []
  if (isSupporter && accessDate) facts.push([status === 'grace' ? 'Access until' : 'Access through', accessDate])
  if (status && status !== 'none' && periods > 0) facts.push(['Supported', `${periods} ${periods === 1 ? 'month' : 'months'}`])
  if (linked) facts.push(['Pulse account', accountReference(linked.accountId)])

  return (
    <PulseSectionCard title="Supporter" headingLevel={3}>
      <div className="pulse-journey" data-journey-state={state}>
        {steps ? <Progress steps={steps} /> : null}
        <div role="status" aria-live="polite" className="pulse-journey-status">
          <p className="pulse-journey-title"><strong>{title}</strong></p>
          {body}
          {stale ? <p className="pulse-supporter-detail" data-journey-stale="true">Could not refresh just now; showing the last confirmed status.</p> : null}
          {notice ? <p className="pulse-journey-notice">{notice}</p> : null}
        </div>
        {facts.length ? <dl className="pulse-journey-facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : null}
        {terms ? <OfferTerms /> : null}
        {state === 'unlinked' ? <p className="pulse-supporter-detail">Stripe asks for your email and payment details. You only verify your email if you need to restore membership later.</p> : null}
        {primary || secondary.length ? <div className="pulse-account-link-actions pulse-journey-actions">{primary}{secondary}</div> : null}
        {restoreForm && restore.state === 'idle' ? <form onSubmit={event => void startRestore(event)} className="pulse-journey-restore">
          <label htmlFor="supporter-restore-email">Email used at checkout</label>
          <input id="supporter-restore-email" type="email" autoComplete="email" required maxLength={254} value={restoreEmail} onChange={event => setRestoreEmail(event.target.value)} disabled={payBusy} />
          <div className="pulse-account-link-actions pulse-journey-actions"><button className="pulse-journey-primary" type="submit" disabled={payBusy}>{payBusy ? 'Sending…' : 'Send restore link'}</button><button type="button" disabled={payBusy} onClick={() => { setRestoreEmail(''); setRestoreForm(false) }}>Back</button></div>
        </form> : null}
        {linked ? (
          <div className="pulse-journey-connection">
            <span>This extension is connected to your Pulse account. Connecting does not link your Twitch identity.</span>
            <button type="button" disabled={accountBusy} onClick={() => { setIntent(null); void run('disconnect') }}>Disconnect extension</button>
          </div>
        ) : null}
        {renewalWaiting ? <div className="pulse-journey-connection"><span>Disconnecting stops this extension’s account access.</span><button type="button" disabled={accountBusy} onClick={() => void run('disconnect')}>Disconnect extension</button></div> : null}
      </div>

      <p className="pulse-supporter-detail">
        Core Pulse tools, your existing accent themes and ordinary clip downloading remain free.
      </p>
      <p className="pulse-supporter-detail pulse-supporter-policies">
        <a href={POLICY_LINKS.terms} target="_blank" rel="noopener noreferrer">Supporter terms</a>
        <a href={POLICY_LINKS.refunds} target="_blank" rel="noopener noreferrer">Cancellation &amp; refunds</a>
        <a href={POLICY_LINKS.privacy} target="_blank" rel="noopener noreferrer">Privacy</a>
      </p>
    </PulseSectionCard>
  )
}
