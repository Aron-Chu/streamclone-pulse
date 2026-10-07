import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { BackgroundResponse } from '../shared/messages.ts'
import { POLICY_LINKS, deviceLinkWithCode, productLink } from '../shared/portalLinks.ts'
import {
  ACCOUNT_REVISION_KEY,
  SUPPORTER_REVISION_KEY,
  supporterPerksAllowed,
  type SupporterAccountAction,
  type SupporterAccountState,
  type SupporterEntitlement,
  type SupporterUnavailableReason,
  type SupporterBillingState,
  type SupporterRestoreState,
  type SupporterDevicesState,
} from '../shared/supporterAccount.ts'
import { DEFAULT_SUPPORTER_PAINT, supporterTenureForMonths } from '../shared/supporterPaint.ts'
import { SAMPLE_KIT } from '../supporter/kit.ts'
import { PulseSectionCard } from '../ui/PulseSectionCard.tsx'
import { SupporterCard, type CardIdentity, type CardLook } from './SupporterCard.tsx'
import { usePortalOrigin } from './usePortalOrigin.ts'

/**
 * Account connection and Supporter membership as one journey, drawn as the
 * Account & Supporter page's "Your card" (direction B of the 2026-10-07
 * redesign): the card states who you are and your membership, its footer is
 * this journey's status and one primary action, and the Account card closes
 * the page with the connection, billing and policies. `children` sit between
 * the two.
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
      {/* The card's footer line: the price and its terms in one row. */}
      <p className="pulse-supporter-terms"><b>{PRICE_DISPLAY}</b><span>renews monthly until you cancel</span><span>cancel any time; access runs to the end of the paid month</span><span>taxes, if any, shown before you pay</span></p>
      {/* "You get" lists only shipped benefits; "Who sees what" shows the chat
          crest as a concept, so it is not restated here. */}
      <p className="pulse-supporter-detail"><b>You get</b> a private Pulse header accent, three accent finishes, emote rain behind your Pulse panel, and private support recognition.</p>
    </>
  )
}

export function SupporterJourney({ onEntitlement, look, children }: {
  onEntitlement?: (value: SupporterEntitlement | null) => void
  /** The paint the card wears; by default a Supporter's equipped one, or the sample. */
  look?: Omit<CardLook, 'perks'>
  children?: ReactNode
} = {}) {
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
  // Retry only a start that the worker proves stopped before requesting mail.
  // Keep the address in this screen's memory, never extension storage.
  const restoreRetryEmail = useRef('')
  const [confirmNewMembership, setConfirmNewMembership] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [devices, setDevices] = useState<SupporterDevicesState | null>(null)
  const [devicesBusy, setDevicesBusy] = useState(false)
  const [revokeDevice, setRevokeDevice] = useState<string | null>(null)
  const deviceRequest = useRef(0)
  const [payBusy, setPayBusy] = useState(false)
  const payInFlight = useRef(false)
  const restoreInteraction = useRef(0)
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
  const lastLinkedAccountId = useRef<string | null>(null)

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
      const previousAccount = lastAccount.current
      const previous = previousAccount?.state
      const vanished = (previous === 'linked' || previous === 'relink_required') && response.account.state === 'signed_out' && action !== 'disconnect' && action !== 'cancel'
      const next: SupporterAccountState = vanished ? { state: 'relink_required' } : response.account
      const identityChanged = next.state === 'linked' ? lastLinkedAccountId.current !== null && next.accountId !== lastLinkedAccountId.current : next.state === 'signed_out' || next.state === 'relink_required' || next.state === 'denied' || next.state === 'expired'
      if (lastLinkedAccountId.current !== null && identityChanged) {
        restoreInteraction.current++
        restoreRetryEmail.current = ''
        setRestore({ state: 'idle' }); setRestoreForm(false); setRestoreEmail('')
      }
      // An unavailable/error projection can retain the same installation while
      // refresh is retried. Only an authoritative identity change clears it.
      if (next.state === 'linked') lastLinkedAccountId.current = next.accountId
      else if (identityChanged) lastLinkedAccountId.current = null
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
    const interaction = restoreInteraction.current
    try {
      const [pay, recovery]: BackgroundResponse[] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'SUPPORTER_BILLING', action: 'status' }),
        chrome.runtime.sendMessage({ type: 'SUPPORTER_RESTORE', action: 'status' }),
      ])
      if (pay && 'type' in pay && pay.type === 'SUPPORTER_BILLING') setBilling(pay.billing)
      if (interaction === restoreInteraction.current && recovery && 'type' in recovery && recovery.type === 'SUPPORTER_RESTORE') {
        if (recovery.restore.state !== 'idle') restoreRetryEmail.current = ''
        // Preflight failures have no pending worker journey. A quiet status
        // read returning idle must not erase the error before it can be read.
        setRestore(current => recovery.restore.state === 'idle' && (current.state === 'error' || current.state === 'unavailable' || current.state === 'ineligible') ? current : recovery.restore)
      }
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
      restoreInteraction.current++
      restoreRetryEmail.current = ''
      accountRequest.current++
      accountInFlight.current = false
      entitlementRequest.current++
      entitlementInFlight.current = false
      storage?.removeListener(changed)
    }
  }, [run, readEntitlement, readJourney])

  useEffect(() => {
    if ((billing.state !== 'waiting' && billing.state !== 'confirming' || 'automaticPolling' in billing && billing.automaticPolling === false) && restore.state !== 'pending') return
    const timer = window.setTimeout(() => { void readJourney() }, 5_000)
    return () => window.clearTimeout(timer)
  }, [billing, restore, readJourney])

  const pending = account?.state === 'pending' ? account : null
  const linked = account?.state === 'linked' ? account : null
  useEffect(() => { deviceRequest.current++; setDevices(null); setRevokeDevice(null); setConfirmDisconnect(false) }, [linked?.accountId])
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
    void leaveRestore()
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
      await leaveRestore()
      const response: BackgroundResponse = await chrome.runtime.sendMessage({ type: 'SUPPORTER_BILLING', action: 'checkout' })
      if (response && 'type' in response && response.type === 'SUPPORTER_BILLING' && response.billing.state === 'fallback') {
        if (linked) openPortal(billingHref)
        else await begin('purchase')
        return
      }
      if (!response || !('type' in response) || response.type !== 'SUPPORTER_BILLING') { setBilling({ state: 'unavailable' }); return }
      setBilling(response.billing)
      await run('status'); await readEntitlement(true)
      setWatchUntil(Date.now() + MEMBERSHIP_WATCH_MS)
    } catch { setBilling({ state: 'unavailable' }) }
    finally { payInFlight.current = false; setPayBusy(false) }
  }

  async function manage() {
    if (payInFlight.current) return
    if (entitlement?.state !== 'ready' || entitlement.accountKind !== 'installation') { openPortal(billingHref); return }
    payInFlight.current = true; setPayBusy(true)
    try {
      const response: BackgroundResponse = await chrome.runtime.sendMessage({ type: 'SUPPORTER_BILLING', action: 'portal' })
      if (response && 'type' in response && response.type === 'SUPPORTER_BILLING' && response.billing.state === 'fallback') openPortal(billingHref)
      else if (!response || !('type' in response) || response.type !== 'SUPPORTER_BILLING' || response.billing.state === 'error' || response.billing.state === 'unavailable') setNotice('Could not open membership management. Try again when the service is available.')
    } catch { setNotice('Could not open membership management. Try again when the service is available.') }
    finally { payInFlight.current = false; setPayBusy(false) }
  }

  async function leaveRestore() {
    restoreInteraction.current++
    restoreRetryEmail.current = ''
    setRestoreForm(false); setRestoreEmail(''); setRestore({ state: 'idle' })
    await chrome.runtime.sendMessage({ type: 'SUPPORTER_RESTORE', action: 'cancel' }).catch(() => undefined)
  }
  function openRestoreForm() {
    restoreInteraction.current++
    restoreRetryEmail.current = ''
    setRestore({ state: 'idle' }); setRestoreEmail(''); setRestoreForm(true)
  }

  function disconnect() {
    if (status === 'active' || status === 'grace' || status === 'pending' || account?.state === 'unavailable' && account.linked === true || billing.state === 'waiting' || billing.state === 'confirming' || billing.state === 'still_confirming' || billing.state === 'reconnect_required') {
      setConfirmDisconnect(true)
      return
    }
    void confirmDisconnection()
  }

  async function confirmDisconnection() {
    await leaveRestore()
    setConfirmDisconnect(false); setIntent(null)
    await run('disconnect')
    await readJourney()
  }

  async function startRestore(event: React.FormEvent) {
    event.preventDefault()
    await submitRestore(restoreEmail)
  }

  async function retryRestore() {
    if (payInFlight.current) return
    if (restoreRetryEmail.current) await submitRestore(restoreRetryEmail.current)
    else openRestoreForm()
  }

  async function submitRestore(email: string) {
    if (payInFlight.current) return
    const submittedEmail = email.trim()
    restoreRetryEmail.current = ''
    const interaction = ++restoreInteraction.current
    payInFlight.current = true; setPayBusy(true); setRestoreEmail(''); setRestoreForm(true); setRestore({ state: 'idle' }); setNotice(''); setIntent(null); setWatchUntil(0)
    try {
      const response: BackgroundResponse = await chrome.runtime.sendMessage({ type: 'SUPPORTER_RESTORE', action: 'start', email: submittedEmail })
      if (interaction !== restoreInteraction.current) return
      if (!response || !('type' in response) || response.type !== 'SUPPORTER_RESTORE') throw new Error('restore unavailable')
      if (response.restore.state === 'unavailable' && (response.restore.reason === 'connection' || response.restore.reason === 'membership' || response.restore.reason === 'membership_invalid')) restoreRetryEmail.current = submittedEmail
      setRestore(response.restore)
      if (response.restore.state === 'fallback') { setRestoreForm(false); await begin('connect') }
      await run('status'); await readEntitlement(true)
    } catch { if (interaction === restoreInteraction.current) setRestore({ state: 'unavailable' }) }
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
  async function checkPayment() {
    if (payInFlight.current) return
    payInFlight.current = true; setPayBusy(true)
    try {
      const response: BackgroundResponse = await chrome.runtime.sendMessage({ type: 'SUPPORTER_BILLING', action: 'check' })
      if (response && 'type' in response && response.type === 'SUPPORTER_BILLING') setBilling(response.billing)
      await run('status'); await readEntitlement(false)
    } finally { payInFlight.current = false; setPayBusy(false) }
  }
  async function checkRestore() {
    if (payInFlight.current) return
    const interaction = restoreInteraction.current
    payInFlight.current = true; setPayBusy(true)
    try {
      const response: BackgroundResponse = await chrome.runtime.sendMessage({ type: 'SUPPORTER_RESTORE', action: 'check' })
      if (interaction !== restoreInteraction.current) return
      if (response && 'type' in response && response.type === 'SUPPORTER_RESTORE') setRestore(response.restore)
      await run('status'); await readEntitlement(false)
    } finally { payInFlight.current = false; setPayBusy(false) }
  }
  async function listDevices(cursor?: string) {
    if (devicesBusy) return
    setDevicesBusy(true)
    const request = ++deviceRequest.current
    try {
      const response: BackgroundResponse = await chrome.runtime.sendMessage({ type: 'SUPPORTER_DEVICES', action: 'list', ...(cursor ? { cursor } : {}) })
      if (request === deviceRequest.current) setDevices(response && 'type' in response && response.type === 'SUPPORTER_DEVICES' ? response.devices : { state: 'error' })
    } catch { if (request === deviceRequest.current) setDevices({ state: 'error' }) }
    finally { setDevicesBusy(false) }
  }
  async function confirmRevokeDevice(deviceId: string) {
    if (devicesBusy) return
    setDevicesBusy(true)
    try {
      const response: BackgroundResponse = await chrome.runtime.sendMessage({ type: 'SUPPORTER_DEVICES', action: 'revoke', deviceId })
      if (response && 'type' in response && response.type === 'SUPPORTER_DEVICES' && response.devices.state === 'revoked') {
        setDevices(null); setNotice('That extension’s connection was revoked.'); setRevokeDevice(null)
      } else setNotice('Could not revoke that connection. Try again when the service is available.')
    } catch { setNotice('Could not revoke that connection. Try again when the service is available.') }
    finally { setDevicesBusy(false) }
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
  const restoreEligible = unlinked || entitlement?.state === 'ready' && entitlement.accountKind === 'installation' && entitlement.installationAccountsEnabled === true && entitlement.restoreEligible === true

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
    primary = <button className="pulse-journey-primary" type="button" disabled={accountBusy || checking} onClick={() => void checkAgain()}>Check again</button>
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
    secondary = [<button key="restore" type="button" disabled={accountBusy || payBusy} onClick={openRestoreForm}>Restore my Supporter</button>, <button key="connect" type="button" disabled={accountBusy || payBusy} onClick={() => void begin('connect')}>{accountBusy && intent === 'connect' ? 'Preparing…' : 'Use a StreamPulse website account'}</button>]
    if (account.state === 'relink_required') {
      state = 'relink-required'; title = 'Restore this extension’s connection'; terms = false
      body = <p>This extension was disconnected from your Pulse account. Restore your existing membership or connect your website account before considering another subscription.</p>
      primary = <button className="pulse-journey-primary" type="button" disabled={accountBusy || payBusy} onClick={openRestoreForm}>Restore my Supporter</button>
      secondary = [<button key="connect" type="button" disabled={accountBusy || payBusy} onClick={() => void begin('connect')}>Use a StreamPulse website account</button>, <button key="new" type="button" disabled={accountBusy || payBusy} onClick={() => setConfirmNewMembership(true)}>Start a new membership</button>]
      if (confirmNewMembership) {
        state = 'confirm-new-membership'; title = 'Start a separate membership?'
        body = <p>This creates a separate subscription. Restore an existing membership first if you already pay for Supporter.</p>
        primary = <button className="pulse-journey-primary" type="button" disabled={accountBusy || payBusy} onClick={() => { setConfirmNewMembership(false); void purchase() }}>Continue with a new membership</button>
        secondary = [<button key="back" type="button" onClick={() => setConfirmNewMembership(false)}>Back to restore</button>]
      }
    }
  } else if (renewalWaiting) {
    state = 'connection-waiting'
    title = 'Connected, but the account service is unavailable'
    body = <p className="pulse-supporter-detail">This extension is still connected. Your free tools still work; check again in a moment.</p>
    primary = <button className="pulse-journey-primary" type="button" disabled={accountBusy || checking} onClick={() => void checkAgain()}>Check again</button>
  } else if (!entitlement || entitlement.state === 'not_linked') {
    state = 'membership-loading'
    title = 'Checking Supporter status…'
    steps = ['done', 'done', 'current']
  } else if (entitlement.state === 'unavailable' || entitlement.state === 'error') {
    state = 'membership-unknown'
    title = 'Supporter status unavailable'
    body = <p className="pulse-supporter-detail">{entitlement.state === 'unavailable' && 'reason' in entitlement ? UNAVAILABLE_COPY[entitlement.reason] : 'Could not reach StreamPulse to check Supporter status.'} Your free tools are unaffected.</p>
    primary = <button className="pulse-journey-primary" type="button" disabled={checking} onClick={() => void checkAgain()}>{checking ? 'Checking…' : 'Check again'}</button>
  } else if (status === 'none') {
    steps = ['done', 'done', 'current']
    if (!checkoutOpen) {
      state = 'checkout-closed'
      title = 'Supporter sign-ups are not open yet'
      body = <p>Your account is connected. The offer appears here when sign-ups open.</p>
      primary = <button className="pulse-journey-primary" type="button" disabled={checking} onClick={() => void checkAgain().then(readJourney)}>Check sign-up status</button>
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
    primary = entitlement?.state === 'ready' && entitlement.accountKind === 'installation'
      ? <button className="pulse-journey-primary" type="button" disabled={payBusy} onClick={() => void checkPayment()}>Check payment status</button>
      : <a className="pulse-journey-primary" data-supporter-action="billing" href={billingHref} target="_blank" rel="noopener noreferrer">View payment status</a>
  } else if (status === 'active') {
    state = 'active'
    title = intent === 'purchase' ? 'You are a Supporter' : 'Supporter active'
    body = <p>{intent === 'purchase' ? 'Thank you. Your Supporter finishes are unlocked below.' : 'Thank you for supporting Pulse.'}</p>
    primary = <a className="pulse-journey-primary" data-supporter-action="billing" href={billingHref} target="_blank" rel="noopener noreferrer">Manage membership</a>
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
    primary = <a className="pulse-journey-primary" data-supporter-action="billing" href={billingHref} target="_blank" rel="noopener noreferrer" onClick={checkoutOpen ? openBilling : undefined}>{checkoutOpen ? 'Rejoin Supporter' : 'Review membership'}</a>
  } else {
    state = 'review'
    title = 'Membership needs review'
    body = <p className="pulse-supporter-detail">Something about a payment needs checking, for example an open dispute. Nothing is lost; support can help.</p>
    primary = <a className="pulse-journey-primary" data-supporter-action="billing" href={billingHref} target="_blank" rel="noopener noreferrer">Review membership</a>
  }

  if (entitlement?.state === 'ready' && entitlement.accountKind === 'installation' && (isSupporter || status === 'expired' || status === 'review')) {
    primary = status === 'expired' && checkoutOpen && entitlement.installationAccountsEnabled === true ? <button className="pulse-journey-primary" type="button" disabled={payBusy} onClick={() => void purchase()}>Rejoin Supporter</button>
      : <button className="pulse-journey-primary" type="button" disabled={payBusy} onClick={() => void manage()}>{status === 'grace' ? 'Update payment method' : 'Manage membership'}</button>
  }

  // Worker-owned uncertainty always outranks the offer, including after settings
  // closes or reloads. A failed return page is never evidence of payment.
  if (!isSupporter && billing.state !== 'idle' && billing.state !== 'fallback') {
    steps = null; terms = false; primary = null; secondary = []
    if (billing.state === 'active') {
      state = 'membership-loading'; title = 'Checking Supporter status…'
      body = <p>Check your current membership before starting another payment. Your free tools still work.</p>
      primary = <button className="pulse-journey-primary" type="button" disabled={checking} onClick={() => void checkAgain().then(readJourney)}>Check again</button>
    } else if (billing.state === 'waiting') {
      state = 'stripe-open'; title = 'Stripe checkout is open'
      body = <p>Complete payment in the Stripe tab. {billing.automaticPolling === false ? 'Automatic checks have paused. Check payment status when you return.' : 'This extension updates by itself; you do not need to refresh.'}</p>
      primary = <button className="pulse-journey-primary" type="button" disabled={payBusy} onClick={() => { void chrome.runtime.sendMessage({ type: 'SUPPORTER_BILLING', action: 'resume' }).then(() => readJourney()).catch(() => setNotice('Could not reopen Stripe. Check status before trying another payment.')) }}>Return to Stripe checkout</button>
      if (billing.automaticPolling === false) secondary = [<button key="check" type="button" disabled={payBusy} onClick={() => void checkPayment()}>Check payment status</button>]
    }
    else if (billing.state === 'confirming' || billing.state === 'still_confirming') {
      state = billing.state === 'confirming' ? 'payment-pending' : 'still-confirming'
      title = billing.state === 'confirming' ? 'Confirming your payment' : 'Still confirming your payment'
      body = <p>Your payment status is not confirmed yet. Do not pay again. {billing.state === 'still_confirming' ? 'Check status when you return, or contact support if it stays unresolved.' : 'Supporter turns on here after the server confirms it.'}</p>
      primary = <button className="pulse-journey-primary" type="button" disabled={payBusy} onClick={() => void checkPayment()}>Check payment status</button>
    } else if (billing.state === 'closed' || (billing.state === 'expired' && entitlement?.state === 'ready' && !checkoutOpen)) { state = 'checkout-closed'; title = 'Supporter sign-ups are not open yet'; body = <p>Your free tools still work. Return when paid sign-ups open.</p>; primary = <button className="pulse-journey-primary" type="button" disabled={checking} onClick={() => void checkAgain().then(readJourney)}>Check sign-up status</button> }
    else if (billing.state === 'expired') { state = 'checkout-expired'; title = 'Checkout expired'; body = <p>The checkout session ended before completion. You can start a new checkout when ready.</p>; primary = <button className="pulse-journey-primary" type="button" disabled={payBusy} onClick={() => void purchase()}>Start checkout again</button> }
    else if (billing.state === 'review') { state = 'review'; title = 'Membership needs review'; body = <p>A payment needs checking. Do not pay again; contact support for help.</p>; primary = <a className="pulse-journey-primary" href={POLICY_LINKS.support} target="_blank" rel="noopener noreferrer">Contact support</a> }
    else if (billing.state === 'unavailable' || billing.state === 'error') { state = 'billing-unavailable'; title = 'Checkout is unavailable'; body = <p>The service could not prepare checkout. Your free tools still work.</p>; primary = <button className="pulse-journey-primary" type="button" disabled={payBusy} onClick={() => { setBilling({ state: 'idle' }); void checkAgain() }}>Try again</button> }
    else if (billing.state === 'reconnect_required') {
      state = 'previous-payment-unresolved'; title = 'Restore before another payment'; body = <p>A payment from your previous connection is still unresolved. Restore that membership or contact support. Disconnecting does not prove the payment failed.</p>
      primary = <button className="pulse-journey-primary" type="button" disabled={payBusy} onClick={openRestoreForm}>Restore my Supporter</button>
      secondary = [<button key="connect" type="button" onClick={() => void begin('connect')}>Use a StreamPulse website account</button>, <a key="help" href={POLICY_LINKS.support} target="_blank" rel="noopener noreferrer">Contact support</a>]
      if (linked) secondary.push(<button key="check" type="button" disabled={payBusy} onClick={() => void checkPayment()}>Check payment status</button>)
    }
  }
  if (entitlement?.state === 'ready' && entitlement.accountKind === 'installation' && entitlement.installationAccountsEnabled !== true) {
    if (!isSupporter && status !== 'review' && status !== 'expired') primary = <button className="pulse-journey-primary" type="button" disabled={checking} onClick={() => void checkAgain()}>Check again</button>
    secondary = []
    terms = false
    body = <><p>New Supporter sign-ups are temporarily unavailable.</p>{isSupporter ? <p>Your Supporter access and membership management still apply.</p> : null}</>
  }
  if (linked && restoreEligible && !restoreForm && restore.state === 'idle') secondary.push(<button key="restore-linked" type="button" disabled={payBusy} onClick={openRestoreForm}>Restore my Supporter</button>)
  const restoreFailed = restore.state === 'ineligible' || restore.state === 'conflict' || restore.state === 'unavailable' || restore.state === 'error'
  const restoreCanTakeFocus = entitlement?.state !== 'ready' || !isSupporter && (entitlement.restoreEligible !== false || restoreFailed)
  if (restoreCanTakeFocus && (restore.state === 'pending' || restore.state === 'uncertain' || restore.state === 'expired' || restore.state === 'conflict' || restore.state === 'ineligible' || restore.state === 'unavailable' || restore.state === 'error')) {
    steps = null; terms = false; primary = null; secondary = []
    state = `restore-${restore.state}`
    title = restore.state === 'pending' ? 'Check your email' : restore.state === 'uncertain' ? 'Checking your restore request' : restore.state === 'expired' ? 'Restore link expired' : restore.state === 'conflict' || restore.state === 'ineligible' ? 'Restore is unavailable for this connection' : 'Restore could not be prepared'
    if (restore.state === 'pending') primary = <button className="pulse-journey-primary" type="button" disabled={payBusy} onClick={() => void checkRestore()}>Check restore status</button>
    body = <>{restore.state === 'pending' ? <><p>If that email has a recoverable membership, we sent a link. Confirm only when the code on that page matches this extension:</p><p className="pulse-account-link-code">{restore.comparisonCode}</p><p>This extension updates by itself. Never confirm a restore you did not request.</p></> : <p>{restore.state === 'uncertain' ? 'The request may have reached the server and sent an email. Check this same request to collect its confirmation code; do not request another link yet.' : restore.state === 'conflict' || restore.state === 'ineligible' ? 'This connection cannot restore another membership. A website account uses its normal sign-in and extension link; a connection with payment history cannot be combined. Contact support if you are unsure.' : restore.state === 'expired' ? 'Request a new link when you are ready.' : restore.state === 'error' ? 'The restore request could not be prepared. Enter your email again to try again.' : restore.state === 'unavailable' && restore.reason === 'connection' ? 'This extension’s connection could not be prepared. Try again when the account service is available.' : restore.state === 'unavailable' && restore.reason === 'membership_invalid' ? 'The membership response could not be verified. No restore link was requested. Try again or contact support if this continues.' : restore.state === 'unavailable' && restore.reason === 'environment_mismatch' ? 'This build cannot restore membership from this billing environment. No restore link was requested.' : restore.state === 'unavailable' && restore.reason === 'membership' ? 'Your membership could not be checked. No restore link was requested. Try again when the account service is available.' : 'Try again when the account service is available.'}</p>}</>
    if (restore.state === 'expired' || restore.state === 'unavailable' || restore.state === 'error') primary = <button className="pulse-journey-primary" type="button" disabled={payBusy} onClick={() => void retryRestore()}>Try restore again</button>
    if (restore.state === 'uncertain') primary = <button className="pulse-journey-primary" type="button" disabled={payBusy} onClick={() => void checkRestore()}>Check restore request</button>
    if (restore.state === 'conflict' || restore.state === 'ineligible') primary = <a className="pulse-journey-primary" href={POLICY_LINKS.support} target="_blank" rel="noopener noreferrer">Contact support</a>
    secondary = [<button key="back" type="button" onClick={() => void leaveRestore()}>Back to membership</button>]
    if (restoreRetryEmail.current) secondary.push(<button key="email" type="button" disabled={payBusy} onClick={openRestoreForm}>Use another email</button>)
  }
  if (restoreCanTakeFocus && restoreForm && restore.state === 'idle') {
    state = 'restore-email'; title = 'Restore your Supporter'; steps = null; terms = false; primary = null; secondary = []
    body = <p>Use the email you gave Stripe. Confirm the restore link to connect this browser.</p>
    if (payBusy) {
      state = 'restore-sending'; title = 'Preparing your restore'
      body = <p>Checking this connection and requesting your restore link. This can take a few seconds.</p>
    }
  }

  // The card already names the account and the months supported.
  const facts: Array<[string, string]> = []
  if (isSupporter && accessDate) facts.push([status === 'grace' ? 'Access until' : 'Access through', accessDate])

  const identity: CardIdentity = linked ? { kind: 'pulse', reference: accountReference(linked.accountId) } : renewalWaiting ? { kind: 'pulse' } : { kind: 'none' }
  const perks = !stale && supporterPerksAllowed(entitlement)
  const equipped = perks && entitlement?.state === 'ready' && entitlement.cosmetics?.enabled ? entitlement.cosmetics.finish : null
  const cardLook: CardLook = { finish: look ? look.finish : perks ? equipped : SAMPLE_KIT.finish, paint: look?.paint ?? DEFAULT_SUPPORTER_PAINT, perks }
  const connected = linked !== null || renewalWaiting

  return (
    <>
      <SupporterCard
        identity={identity}
        membership={{ supporter: isSupporter, grace: status === 'grace', ended: status === 'expired', months: periods, tenure: supporterTenureForMonths(periods) }}
        look={cardLook}
      >
        <div className="pulse-journey" data-journey-state={state} data-tone={status === 'grace' && state === 'grace' ? 'warn' : undefined}>
          {steps ? <Progress steps={steps} /> : null}
          <div className="pulse-journey-row">
            <div className="pulse-journey-main">
              <div role="status" aria-live="polite" className="pulse-journey-status">
                <p className="pulse-journey-title"><strong>{title}</strong></p>
                {body}
                {stale ? <p className="pulse-supporter-detail" data-journey-stale="true">Could not refresh just now; showing the last confirmed status.</p> : null}
                {notice ? <p className="pulse-journey-notice">{notice}</p> : null}
              </div>
              {facts.length ? <dl className="pulse-journey-facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : null}
            </div>
            {primary ? <div className="pulse-account-link-actions pulse-journey-actions">{primary}</div> : null}
          </div>
          {terms ? <OfferTerms /> : null}
          {/* The worker decides the path at the click: without installation
              accounts on the server (production today) it falls back to the
              website link, so the website path is stated first. */}
          {state === 'unlinked' ? <p className="pulse-supporter-detail">Become a Supporter opens streampulse.stream, where you sign in and approve this extension before paying on Stripe. If the server lets this extension check out by itself, Stripe opens directly and asks for your email and payment details; you only verify that email if you restore membership later.</p> : null}
          {secondary.length ? <div className="pulse-account-link-actions pulse-journey-actions">{secondary}</div> : null}
          {restoreForm && restore.state === 'idle' && !payBusy ? <form onSubmit={event => void startRestore(event)} className="pulse-journey-restore">
            <label htmlFor="supporter-restore-email">Email used at checkout</label>
            <input id="supporter-restore-email" type="email" autoComplete="email" required maxLength={254} value={restoreEmail} onChange={event => setRestoreEmail(event.target.value)} disabled={payBusy} />
            <div className="pulse-account-link-actions pulse-journey-actions"><button className="pulse-journey-primary" type="submit" disabled={payBusy}>{payBusy ? 'Sending…' : 'Send restore link'}</button><button type="button" disabled={payBusy} onClick={() => void leaveRestore()}>Back</button></div>
          </form> : null}
        </div>
      </SupporterCard>

      {children}

      <PulseSectionCard title="Account" headingLevel={3}>
        <dl className="pulse-supporter-rows">
          <div data-row="account">
            <dt>StreamPulse</dt>
            <dd>
              {connected ? 'Connected to this extension' : 'Not signed in'}
              <small>{connected ? 'This extension is connected to your Pulse account. Connecting does not link your Twitch identity.' : 'Free tools work without it.'}</small>
            </dd>
            <dd className="pulse-account-link-actions">{connected ? <button type="button" disabled={accountBusy || payBusy} onClick={disconnect}>Disconnect extension</button> : null}</dd>
          </div>
          {isSupporter && entitlement?.state === 'ready' ? <div data-row="billing">
            <dt>Billing</dt>
            <dd>Stripe<small>Change card, get receipts, or cancel.</small></dd>
            <dd className="pulse-account-link-actions"><button type="button" disabled={payBusy} onClick={() => void manage()}>Manage billing <span className="pulse-supporter-ext" aria-hidden="true">↗</span></button></dd>
          </div> : null}
          <div data-row="new-browser">
            <dt>New browser</dt>
            <dd>Connect the same StreamPulse account there.<small>Or restore your Supporter with the email you used at checkout.</small></dd>
            <dd />
          </div>
          <div data-row="payments">
            <dt>Payments</dt>
            <dd>Handled by Stripe.<small>StreamPulse never sees or stores your card number.</small></dd>
            <dd />
          </div>
        </dl>
        {confirmDisconnect ? <div className="pulse-journey-confirm" role="group" aria-label="Confirm disconnection"><p>Disconnect this extension? This does not cancel your subscription or stop a payment already in progress. You will need email recovery to restore membership here.</p><div className="pulse-account-link-actions pulse-journey-actions"><button type="button" disabled={accountBusy || payBusy} onClick={() => void confirmDisconnection()}>Confirm disconnect</button><button type="button" onClick={() => setConfirmDisconnect(false)}>Keep connected</button></div></div> : null}
        {linked && entitlement?.state === 'ready' && entitlement.accountKind === 'installation' && entitlement.installationAccountsEnabled === true ? <details className="pulse-journey-devices" onToggle={event => { if (event.currentTarget.open && devices === null) void listDevices() }}>
          <summary>Connected extensions</summary>
          <p className="pulse-supporter-detail">Revoke an extension you no longer recognize. Use Disconnect extension above to leave this browser.</p>
          {devices?.state === 'ready' ? <ul>{devices.devices.map(device => <li key={device.id}>
            <span>{device.label} {accountReference(device.id)}{device.id === devices.currentDeviceId ? ' · This extension' : ''}{device.revokedAt ? ' · Revoked' : ''}</span><span className="pulse-supporter-detail">Connected {shortDate(device.createdAt)}</span>
            {!device.revokedAt && device.id !== devices.currentDeviceId ? <div className="pulse-account-link-actions pulse-journey-actions">{revokeDevice === device.id ? <><span>Revoke this extension’s access?</span><button type="button" disabled={devicesBusy} onClick={() => void confirmRevokeDevice(device.id)}>Confirm revoke</button><button type="button" disabled={devicesBusy} onClick={() => setRevokeDevice(null)}>Keep connection</button></> : <button type="button" disabled={devicesBusy} onClick={() => setRevokeDevice(device.id)}>Revoke connection</button>}</div> : null}
          </li>)}</ul> : <p role="status">{devicesBusy ? 'Loading connections…' : devices === null ? 'Refresh to see current connections.' : 'Connections could not be loaded.'}</p>}
          <div className="pulse-account-link-actions pulse-journey-actions"><button type="button" disabled={devicesBusy} onClick={() => void listDevices()}>Refresh connections</button>{devices?.state === 'ready' && devices.nextCursor ? <button type="button" disabled={devicesBusy} onClick={() => void listDevices(devices.nextCursor)}>Next connections</button> : null}</div>
        </details> : null}
        <p className="pulse-supporter-detail">
          Core Pulse tools, your existing accent themes, moment bookmarks, and links to Twitch clips and VODs remain free.
        </p>
        <p className="pulse-supporter-detail pulse-supporter-policies">
          <a href={POLICY_LINKS.terms} target="_blank" rel="noopener noreferrer">Supporter terms</a>
          <a href={POLICY_LINKS.refunds} target="_blank" rel="noopener noreferrer">Cancellation &amp; refunds</a>
          <a href={POLICY_LINKS.privacy} target="_blank" rel="noopener noreferrer">Privacy</a>
        </p>
      </PulseSectionCard>
    </>
  )
}
