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
  type SupporterDevicesState,
} from '../shared/supporterAccount.ts'
import { DEFAULT_SUPPORTER_PAINT, supporterTenureForMonths } from '../shared/supporterPaint.ts'
import {
  TWITCH_SIGNIN_STAGE,
  type TwitchSignInMode,
  type TwitchSignInResponse,
  type TwitchSignInStage,
  type TwitchSignInStatus,
} from '../shared/twitchSignIn.ts'
import { SAMPLE_KIT } from '../supporter/kit.ts'
import { PulseSectionCard } from '../ui/PulseSectionCard.tsx'
import { SupporterCard, type CardIdentity, type CardLook, type CardStatus } from './SupporterCard.tsx'
import { TwitchGlitch, twitchOutcomeMessage } from './TwitchAccountConnection.tsx'
import { usePortalOrigin } from './usePortalOrigin.ts'

/**
 * Account and Supporter membership as one journey, drawn as the Account &
 * Supporter page's "Your card" (direction B of the 2026-10-07 redesign): the
 * card states who you are and your membership, its footer is this journey's
 * status and one primary action, and the Account card closes the page with the
 * sign-in, billing and policies. `children` sit between the two.
 *
 * One public account flow (account journey spec, closeout 2026-10-08b):
 * Continue with Twitch → Become a Supporter (Stripe Checkout through the
 * worker's bearer) → Manage subscription (a recent Twitch check when the
 * server asks) → Sign out. Reinstalling or another browser gets Supporter back
 * by signing in with the same Twitch account.
 *
 * With Twitch sign-in compiled off (today) a signed-out page says Supporter
 * sign-ups are not open yet and offers no purchase: no email restore, no
 * website-account choice, and no installation account. Invited testers keep a
 * closed "Connect this extension" disclosure for the existing device link.
 *
 * The worker owns credentials, polling secrets and every HTTP request; this
 * page receives safe projections and asks it to act. Nothing here asserts an
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

/** The account journey's shared vocabulary (spec §4), exact strings. */
export const ACCOUNT_COPY = {
  continueWithTwitch: 'Continue with Twitch',
  openingTwitch: 'Opening Twitch…',
  differentAccount: 'Use a different Twitch account',
  manageSubscription: 'Manage subscription',
  signOut: 'Sign out',
  signOutEverywhere: 'Sign out everywhere',
  becomeSupporter: 'Become a Supporter',
  supporterDetails: 'Supporter details',
  freeTools: 'Free tools work without an account.',
  signupsClosed: 'Supporter sign-ups are not open yet.',
  comingSoon: 'Twitch sign-in is coming soon.',
  testersOnly: 'Twitch sign-in is open to invited testers right now.',
  signedInWithTwitch: 'Signed in with Twitch',
  confirmHeading: 'Confirm it\'s you',
  confirmBody: 'For your security, managing your subscription needs a Twitch check from the last 10 minutes.',
  wrongAccount: 'This subscription belongs to a different Twitch account. Sign out, then Continue with Twitch with the account you subscribed with.',
  confirmEverywhereBody: 'For your security, signing out everywhere needs a Twitch check from the last 10 minutes. Nothing was signed out.',
  testerBridge: 'Invited tester? Connect this extension',
  otherWays: 'Other ways to connect (testers)',
  billingEmail: 'Stripe asks for a billing email at checkout. It can be different from your Twitch email, and you don\'t need a separate StreamPulse sign-up.',
  reinstall: 'Reinstalled or on another browser? Continue with Twitch with the same Twitch account and your Supporter status comes back. No code to copy, no email to confirm.',
} as const

type Intent = 'purchase' | 'connect' | null
/**
 * Where an action's outcome is reported: the card footer, or the Account card
 * that closes the page. Each action reports beside the control that started it.
 */
type NoticeAt = 'card' | 'account'
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

/** Why a signed-out page is signed out, when the user did not just choose it. */
function signedOutNotice(state: SupporterAccountState['state'], twitchOn: boolean): string | null {
  if (state === 'relink_required') return twitchOn ? 'You were signed out on this browser. Continue with Twitch to sign in again.' : 'This extension was disconnected from your StreamPulse account.'
  if (state === 'denied') return 'The last connection request was declined. You can start again when ready.'
  if (state === 'expired') return 'The last connection request expired before it was approved. Start again when ready.'
  return null
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

function OfferTerms() {
  return (
    <>
      {/* The card's footer line: the price and its terms in one row, before the action. */}
      <p className="pulse-supporter-terms"><b>{PRICE_DISPLAY}</b><span>renews monthly until you cancel</span><span>cancel any time; access runs to the end of the paid month</span><span>taxes, if any, shown before you pay</span></p>
      {/* "You get" lists only shipped benefits, and names each perk the
          settings banner sells: title paint, the tenure crest and emote rain.
          "Who sees what" shows the chat crest as a concept, so it is not
          restated here. */}
      <p className="pulse-supporter-detail"><b>You get</b> a private Pulse header accent, three accent finishes, a tenure crest beside your panel title that grows with your support (only you see it), emote rain behind your Pulse panel, and private support recognition.</p>
    </>
  )
}

/** Twitch reachable only if the worker says so; a dead worker still leaves a working button. */
const UNKNOWN_TWITCH: TwitchSignInStatus = { enabled: true, available: true, silentEligible: false, profile: null }

export function SupporterJourney({ onEntitlement, onShown, look, twitchStage = TWITCH_SIGNIN_STAGE, children }: {
  /** The membership paid controls may act on: null while a refresh has failed. */
  onEntitlement?: (value: SupporterEntitlement | null) => void
  /** The last confirmed membership on screen, kept through a failed refresh. Display only. */
  onShown?: (value: SupporterEntitlement | null) => void
  /** The paint the card wears; by default a Supporter's equipped one, or the sample. */
  look?: Omit<CardLook, 'perks'>
  /** Sign in with Twitch build stage; fixed at build time, a prop for tests only. */
  twitchStage?: TwitchSignInStage
  children?: ReactNode
} = {}) {
  const portalOrigin = usePortalOrigin()
  const twitchOn = twitchStage !== 'off'
  const [account, setAccount] = useState<SupporterAccountState | null>(null)
  const [entitlement, setEntitlement] = useState<SupporterEntitlement | null>(null)
  // A quiet re-read that failed keeps the last membership on screen, marked
  // stale, instead of blanking the card; paid controls only see fresh values.
  const [stale, setStale] = useState(false)
  const [accountBusy, setAccountBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [notice, setNoticeState] = useState<{ text: string; at: NoticeAt }>({ text: '', at: 'card' })
  const setNotice = useCallback((text: string, at: NoticeAt = 'card') => setNoticeState({ text, at }), [])
  const [billing, setBilling] = useState<SupporterBillingState>({ state: 'idle' })
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  // "Confirm it's you": the portal asked for a Twitch check a click must start.
  const [confirmIdentity, setConfirmIdentity] = useState<NoticeAt | null>(null)
  // Sign out everywhere: the question, then (if the server asks) "Confirm it's you".
  const [everywhere, setEverywhere] = useState<'ask' | 'confirm_identity' | null>(null)
  const [everywhereBusy, setEverywhereBusy] = useState(false)
  const [devices, setDevices] = useState<SupporterDevicesState | null>(null)
  const [devicesBusy, setDevicesBusy] = useState(false)
  const [revokeDevice, setRevokeDevice] = useState<string | null>(null)
  const deviceRequest = useRef(0)
  const [payBusy, setPayBusy] = useState(false)
  const payInFlight = useRef(false)
  const [intent, setIntentState] = useState<Intent>(storedIntent)
  const setIntent = useCallback((value: Intent) => { storeIntent(value); setIntentState(value) }, [])
  const [watchUntil, setWatchUntil] = useState(0)
  const [twitch, setTwitch] = useState<TwitchSignInStatus | null>(null)
  const [signingIn, setSigningIn] = useState<TwitchSignInMode | null>(null)
  const signInFlight = useRef(false)
  const silentTried = useRef(false)
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
  useEffect(() => { onShown?.(entitlement) }, [entitlement, onShown])

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

  /** Show an account projection, explaining a connection that vanished without the user asking. */
  const showAccount = useCallback((received: SupporterAccountState, deliberate: boolean): SupporterAccountState => {
    // The worker forgets why it cleared a credential, so a connection that
    // vanished without the user asking (revoked elsewhere, or rejected by the
    // server) is explained here rather than silently becoming an offer.
    const previous = lastAccount.current?.state
    const vanished = (previous === 'linked' || previous === 'relink_required') && received.state === 'signed_out' && !deliberate
    const next: SupporterAccountState = vanished ? { state: 'relink_required' } : received
    if (next.state !== 'linked') { setConfirmIdentity(null); setEverywhere(null) }
    lastAccount.current = next
    setAccount(next)
    return next
  }, [])

  const run = useCallback(async (action: SupporterAccountAction, at: NoticeAt = 'card'): Promise<SupporterAccountState | null> => {
    if (accountInFlight.current) return null
    accountInFlight.current = true
    const id = ++accountRequest.current
    const background = action === 'poll' || action === 'status'
    if (!background) { setAccountBusy(true); setNotice('') }
    try {
      const response: BackgroundResponse = await chrome.runtime.sendMessage({ type: 'SUPPORTER_ACCOUNT', action })
      if (id !== accountRequest.current) return null
      if (!response || !('type' in response) || response.type !== 'SUPPORTER_ACCOUNT') throw new Error('Account worker unavailable')
      showAccount(response.account, action === 'disconnect' || action === 'cancel')
      if (action === 'disconnect' && response.account.state === 'error') {
        setNotice('Sign out did not finish cleanly; the server could not confirm it. Check the connection before trying again.', at)
      }
      return response.account
    } catch {
      if (id === accountRequest.current) {
        lastAccount.current = { state: 'error' }
        setAccount({ state: 'error' })
        if (action === 'disconnect') setNotice('Sign out could not be confirmed. Try again when the extension is available.', at)
      }
      return null
    } finally {
      if (id === accountRequest.current) { accountInFlight.current = false; setAccountBusy(false) }
    }
  }, [setNotice, showAccount])

  // Only the worker's billing wait is read here. This page never asks for an
  // email restore, and never creates an installation account.
  const readBilling = useCallback(async () => {
    try {
      const pay: BackgroundResponse = await chrome.runtime.sendMessage({ type: 'SUPPORTER_BILLING', action: 'status' })
      if (pay && 'type' in pay && pay.type === 'SUPPORTER_BILLING') setBilling(pay.billing)
    } catch { /* Older workers retain the existing journey. */ }
  }, [])

  const readTwitch = useCallback(async () => {
    if (!twitchOn) return
    try {
      const response = await chrome.runtime.sendMessage({ type: 'TWITCH_SIGN_IN', action: 'status' }) as TwitchSignInResponse | undefined
      if (!response || response.type !== 'TWITCH_SIGN_IN' || !response.status) throw new Error('worker unavailable')
      setTwitch(response.status)
    } catch { setTwitch(current => current ?? UNKNOWN_TWITCH) }
  }, [twitchOn])

  // Initial reads, and the worker's non-secret change signals.
  useEffect(() => {
    void run('status')
    void readEntitlement(false)
    void readBilling()
    void readTwitch()
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
        void readBilling()
        void readTwitch()
        return
      }
      if (SUPPORTER_REVISION_KEY in changes) { void readEntitlement(true); void readBilling() }
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
  }, [run, readEntitlement, readBilling, readTwitch])

  useEffect(() => {
    if (billing.state !== 'waiting' && billing.state !== 'confirming' || 'automaticPolling' in billing && billing.automaticPolling === false) return
    const timer = window.setTimeout(() => { void readBilling() }, 5_000)
    return () => window.clearTimeout(timer)
  }, [billing, readBilling])

  const pending = account?.state === 'pending' ? account : null
  const linked = account?.state === 'linked' ? account : null
  useEffect(() => { deviceRequest.current++; setDevices(null); setRevokeDevice(null); setConfirmDisconnect(false); setConfirmIdentity(null) }, [linked?.accountId])
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

  // Returning from the website or Stripe is the moment the user expects an update.
  useEffect(() => {
    const wake = () => {
      if (document.hidden) return
      void readBilling()
      if (account?.state === 'pending') void run('poll')
      if (performance.now() - lastEntitlementRead.current >= MEMBERSHIP_WAKE_DEBOUNCE_MS) void readEntitlement(true)
    }
    window.addEventListener('focus', wake)
    document.addEventListener('visibilitychange', wake)
    return () => {
      window.removeEventListener('focus', wake)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [account?.state, run, readEntitlement, readBilling])

  // A website checkout started from here: once it completes, keep watching for
  // the verified membership.
  useEffect(() => {
    if (linked && intent === 'purchase') setWatchUntil(current => current > Date.now() ? current : Date.now() + MEMBERSHIP_WATCH_MS)
  }, [linked, intent])
  useEffect(() => {
    if (status === 'active' || status === 'grace' || status === 'review') setWatchUntil(0)
    // The journey is complete: this view keeps its welcome, a reload does not.
    if (status === 'active' || status === 'grace') storeIntent(null)
  }, [status])

  async function signIn(mode: TwitchSignInMode, forceVerify = false) {
    if (!twitchOn || signInFlight.current || accountInFlight.current) return
    signInFlight.current = true
    setSigningIn(mode)
    if (mode === 'interactive') setNotice('')
    try {
      const response = await chrome.runtime.sendMessage(forceVerify
        ? { type: 'TWITCH_SIGN_IN', action: 'sign_in', mode: 'interactive', forceVerify: true }
        : { type: 'TWITCH_SIGN_IN', action: 'sign_in', mode }) as TwitchSignInResponse | undefined
      if (!response || response.type !== 'TWITCH_SIGN_IN' || !response.status || !response.account) throw new Error('Account worker unavailable')
      setTwitch(response.status)
      // A different account replaces this one: forget the old membership first.
      const replaced = response.account.state !== 'linked' || response.account.accountId !== (lastAccount.current?.state === 'linked' ? lastAccount.current.accountId : null)
      if (replaced) {
        entitlementRequest.current++
        entitlementInFlight.current = false
        shown.current = null
        setEntitlement(null)
        setStale(false)
      }
      const next = showAccount(response.account, forceVerify)
      // A silent attempt that cannot finish just leaves the button; it never explains itself.
      if (mode === 'interactive') {
        const message = twitchOutcomeMessage(response.outcome, response.retryAfterSeconds)
        if (message) setNotice(message)
      }
      // Every reset is followed by a read: a sign-in that did not finish must
      // not leave membership unknown (the worker answers not_linked), or the
      // Your look controls stay on "Checking Supporter status…" until reload.
      if (replaced || next.state === 'linked') void readEntitlement(false)
      if (next.state === 'linked') void readBilling()
    } catch {
      if (mode === 'interactive') setNotice('Could not reach StreamPulse. Check your connection and try again.')
    } finally {
      signInFlight.current = false
      setSigningIn(null)
    }
  }

  // True first install only (the worker decides): one quiet attempt, no window.
  useEffect(() => {
    if (!twitchOn || silentTried.current || !twitch?.silentEligible || account?.state !== 'signed_out' || signingIn || accountBusy) return
    silentTried.current = true
    void signIn('silent')
  })

  /** Invited testers only: the existing device link, never a purchase. */
  async function connectTester() {
    // A second click before the first request returns must not cancel the
    // tab the first one is about to open.
    if (accountInFlight.current) return
    setIntent('connect')
    pendingOpen.current = 'connect'
    const result = await run('start')
    if (pendingOpen.current !== 'connect') return
    pendingOpen.current = null
    if (result?.state === 'pending') openPortal(deviceLinkWithCode(result.code, portalOrigin))
  }

  /** Checkout through the worker's bearer, for a signed-in account only. */
  async function purchase() {
    if (!linked || payInFlight.current || accountInFlight.current) return
    payInFlight.current = true; setPayBusy(true); setNotice(''); setIntent('purchase')
    try {
      const response: BackgroundResponse = await chrome.runtime.sendMessage({ type: 'SUPPORTER_BILLING', action: 'checkout' })
      if (!response || !('type' in response) || response.type !== 'SUPPORTER_BILLING') { setBilling({ state: 'unavailable' }); return }
      const result = response.billing
      // An invited tester's email account checks out on the website instead.
      if (result.state === 'fallback') { openPortal(billingHref); setWatchUntil(Date.now() + MEMBERSHIP_WATCH_MS); return }
      if (result.state === 'sign_in_required') { setNotice(twitchOn ? 'Your sign-in ended on this browser. Continue with Twitch, then try again.' : 'This extension is no longer connected.'); await run('status'); return }
      if (result.state === 'step_up_required' || result.state === 'wrong_account') { setBilling({ state: 'error' }); return }
      setBilling(result)
      await run('status'); await readEntitlement(true)
      setWatchUntil(Date.now() + MEMBERSHIP_WATCH_MS)
    } catch { setBilling({ state: 'unavailable' }) }
    finally { payInFlight.current = false; setPayBusy(false) }
  }

  /** Stripe's portal for this account: through the worker's bearer, or the website. */
  async function manage(at: NoticeAt, confirm = false) {
    if (payInFlight.current) return
    if (!workerBilling) { openPortal(billingHref); return }
    payInFlight.current = true; setPayBusy(true); setNotice('', at)
    const failed = 'Could not open subscription management. Try again when the service is available.'
    try {
      const response: BackgroundResponse = await chrome.runtime.sendMessage({ type: 'SUPPORTER_BILLING', action: confirm ? 'portal_confirm' : 'portal' })
      if (!response || !('type' in response) || response.type !== 'SUPPORTER_BILLING') { setNotice(failed, at); return }
      const result = response.billing.state
      if (result === 'step_up_required' && twitchOn) { setConfirmIdentity(at); return }
      setConfirmIdentity(null)
      if (result === 'fallback') openPortal(billingHref)
      else if (result === 'wrong_account') setNotice(ACCOUNT_COPY.wrongAccount, at)
      else if (result === 'sign_in_required') { setNotice(twitchOn ? 'Your sign-in ended on this browser. Continue with Twitch, then try again.' : 'This extension is no longer connected.', at); void run('status') }
      else if (result !== 'idle') setNotice(failed, at)
    } catch { setNotice(failed, at) }
    finally { payInFlight.current = false; setPayBusy(false) }
  }

  function disconnect() {
    setEverywhere(null)
    if (status === 'active' || status === 'grace' || status === 'pending' || account?.state === 'unavailable' && account.linked === true || billing.state === 'waiting' || billing.state === 'confirming' || billing.state === 'still_confirming' || billing.state === 'reconnect_required') {
      setConfirmDisconnect(true)
      return
    }
    void confirmDisconnection()
  }

  async function confirmDisconnection() {
    setConfirmDisconnect(false); setIntent(null)
    // Sign out lives in the Account card, so its outcome is reported there.
    await run('disconnect', 'account')
    await readBilling()
  }

  /**
   * Sign out everywhere (Twitch sign-in on): the worker posts revoke-all with
   * this device's bearer, handles a recent-auth refusal as Manage subscription
   * does, and after success forgets this device's sign-in with silent sign-in
   * kept off. Holding the account queue keeps a storage-triggered status read
   * from reporting the sign-out as an unexpected one.
   */
  async function signOutEverywhere(confirm = false) {
    if (accountInFlight.current || signInFlight.current || payInFlight.current) return
    accountInFlight.current = true
    const id = ++accountRequest.current
    setEverywhereBusy(true); setAccountBusy(true); setNotice('', 'account')
    const notAvailable = 'Sign out everywhere isn’t available yet. Nothing was signed out. Sign out here still ends this extension’s access.'
    try {
      const response = await chrome.runtime.sendMessage(confirm
        ? { type: 'TWITCH_SIGN_IN', action: 'sign_out_everywhere', confirm: true }
        : { type: 'TWITCH_SIGN_IN', action: 'sign_out_everywhere' }) as TwitchSignInResponse | undefined
      if (!response || response.type !== 'TWITCH_SIGN_IN' || !response.status || !response.account || !response.everywhere) throw new Error('Account worker unavailable')
      setTwitch(response.status)
      const result = response.everywhere
      if (result === 'signed_out_everywhere') {
        setEverywhere(null); setIntent(null)
        entitlementRequest.current++
        entitlementInFlight.current = false
        shown.current = null
        setEntitlement(null)
        setStale(false)
        showAccount(response.account, true)
        setNotice('You’re signed out everywhere. Every browser and extension that was signed in to this account has to sign in again. Nothing was deleted from your account, and your subscription is unchanged. This browser removed its signed-in watched history and notes.', 'account')
        void readEntitlement(false)
        void readBilling()
        return
      }
      if (result === 'step_up_required') { showAccount(response.account, false); setEverywhere('confirm_identity'); return }
      setEverywhere(null)
      showAccount(response.account, false)
      setNotice(result === 'wrong_account' ? 'Twitch confirmed a different Twitch account than the one signed in here. Nothing was signed out.'
        : result === 'sign_in_required' ? 'Your sign-in ended on this browser. Continue with Twitch, then try again.'
        : result === 'not_available' || result === 'disabled' ? notAvailable
        : result === 'try_later' ? 'Too many attempts. Wait a few minutes, then try again.'
        : result === 'busy' ? 'A Twitch sign-in is already open. Finish or close it, then try again. Nothing was signed out.'
        : result === 'step_up_failed' ? 'The Twitch check didn’t finish, so nothing was signed out. Try again.'
        : result === 'unavailable' ? 'Sign out everywhere couldn’t be confirmed. Account services are unavailable right now. Please try again later.'
        // Only a request that never reached the service points at the connection.
        : 'Sign out everywhere couldn’t be confirmed. Check your connection and try again.', 'account')
    } catch { setNotice('Sign out everywhere couldn’t be confirmed. Reload this page, then try again.', 'account') }
    finally {
      if (id === accountRequest.current) { accountInFlight.current = false; setAccountBusy(false) }
      setEverywhereBusy(false)
    }
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
        setDevices(null); setNotice('That extension’s connection was revoked.', 'account'); setRevokeDevice(null)
      } else setNotice('Could not revoke that connection. Try again when the service is available.', 'account')
    } catch { setNotice('Could not revoke that connection. Try again when the service is available.', 'account') }
    finally { setDevicesBusy(false) }
  }

  const billingHref = productLink('billing', portalOrigin)
  const supporterHref = productLink('supporter', portalOrigin)
  const isSupporter = status === 'active' || status === 'grace'
  const checkoutOpen = entitlement?.state === 'ready' && entitlement.checkoutEnabled === true
  const accountKind = entitlement?.state === 'ready' ? entitlement.accountKind : undefined
  // Purchase and billing through the worker's bearer: any known account with
  // Twitch sign-in on (the server sends an invited tester's email account
  // without Twitch back to the website), and installation accounts. Everyone
  // else manages billing on the website.
  const workerBilling = accountKind === 'installation' || twitchOn && accountKind !== undefined
  const workerCheckout = twitchOn ? accountKind !== undefined && accountKind !== 'installation' || accountKind === 'installation' && entitlement?.state === 'ready' && entitlement.installationAccountsEnabled === true
    : accountKind === 'installation' && entitlement?.state === 'ready' && entitlement.installationAccountsEnabled === true
  const accessDate = entitlement?.state === 'ready' ? shortDate(entitlement.accessUntil) : null
  const periods = entitlement?.state === 'ready' ? entitlement.supportPeriods : 0
  const unlinked = account !== null && (account.state === 'signed_out' || account.state === 'denied' || account.state === 'expired' || account.state === 'relink_required')
  const linkingNotDeployed = account?.state === 'unavailable' && account.reason === 'not_deployed' && !account.linked
  const accountDown = (account?.state === 'unavailable' && !account.linked && account.reason === 'temporarily_unavailable') || (account?.state === 'error' && !account.revocationPending)
  const renewalWaiting = account?.state === 'unavailable' && account.linked === true
  const revocationPending = account?.state === 'error' && account.revocationPending === true
  const twitchStatus = twitch ?? (twitchOn ? null : UNKNOWN_TWITCH)
  const twitchWindow = twitchOn && twitchStatus?.available !== false
  const profile = linked && twitchStatus?.profile ? twitchStatus.profile : null
  const signedInWithTwitch = linked !== null && (accountKind === 'twitch' || profile !== null)
  // Sign out everywhere needs this device's Twitch check, so it is offered only
  // to a Twitch sign-in where the Twitch window can open.
  const everywhereOffered = twitchOn && signedInWithTwitch && twitchWindow

  const continueWithTwitch = (key?: string) => (
    <button key={key} className="pulse-twitch-signin" data-twitch-signin="true" type="button" disabled={accountBusy || payBusy || signingIn !== null || (twitchOn && twitch === null)} aria-busy={signingIn === 'interactive' ? true : undefined} onClick={() => void signIn('interactive')}>
      <TwitchGlitch />{signingIn === 'interactive' ? ACCOUNT_COPY.openingTwitch : ACCOUNT_COPY.continueWithTwitch}
    </button>
  )
  const supporterDetails = (primaryAction: boolean) => (
    <a key="details" className={primaryAction ? 'pulse-journey-primary' : undefined} data-supporter-action="details" href={supporterHref} target="_blank" rel="noopener noreferrer">{ACCOUNT_COPY.supporterDetails}</a>
  )

  let state: string
  let title: string
  let body: ReactNode = null
  let primary: ReactNode = null
  let secondary: ReactNode[] = []
  let terms = false

  if (!account) {
    state = 'loading'
    title = 'Checking your Supporter status…'
  } else if (revocationPending) {
    state = 'revocation-pending'
    title = 'Account access is stopped on this extension'
    body = <p className="pulse-supporter-detail">The server has not confirmed the sign out yet. Retry when you are connected.</p>
    secondary = [<button key="retry" type="button" disabled={accountBusy} onClick={() => void run('disconnect')}>Retry sign out</button>]
  } else if (linkingNotDeployed) {
    state = 'not-deployed'
    title = 'Supporter is not available yet'
    body = <p className="pulse-supporter-detail">Account sign-in is not available on the server yet. Your free tools still work.</p>
  } else if (accountDown) {
    state = 'account-unavailable'
    title = 'Account service unavailable'
    body = <p className="pulse-supporter-detail">The account service could not be reached. Your free tools still work; check again in a moment.</p>
    primary = <button className="pulse-journey-primary" type="button" disabled={accountBusy || checking} onClick={() => void checkAgain()}>Check again</button>
  } else if (signingIn === 'silent') {
    state = 'twitch-checking'
    title = 'Checking for an earlier Twitch sign-in…'
  } else if (pending) {
    state = 'link-pending'
    title = 'Finish on streampulse.stream'
    body = <>
      <p>Sign in and approve this extension in the tab that opened. This page updates by itself.</p>
      <p className="pulse-supporter-detail">If the website asks for a code, it is <span className="pulse-account-link-code">{pending.code}</span>. It expires at {new Date(pending.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.</p>
    </>
    primary = <a className="pulse-journey-primary" href={deviceLinkWithCode(pending.code, portalOrigin)} target="_blank" rel="noopener noreferrer">Reopen streampulse.stream</a>
    secondary = [<button key="cancel" type="button" disabled={accountBusy} onClick={() => { setIntent(null); void run('cancel') }}>Cancel</button>]
  } else if (unlinked) {
    state = 'signed-out'
    const why = signedOutNotice(account.state, twitchOn)
    if (!twitchOn) {
      // Stage A: nothing to buy and no account to make. The one action says
      // where Supporter is described; testers connect below.
      title = 'Supporter sign-ups are not open yet'
      body = <>
        {why ? <p className="pulse-journey-notice">{why}</p> : null}
        <p>When they open, you'll choose <b>Continue with Twitch</b>, then pay on Stripe. {ACCOUNT_COPY.freeTools}</p>
      </>
      terms = true
      primary = supporterDetails(true)
    } else {
      title = 'Supporter starts with Twitch sign-in'
      body = <>
        {why ? <p className="pulse-journey-notice">{why}</p> : null}
        <p>Choose <b>Continue with Twitch</b>, then pay on Stripe. {ACCOUNT_COPY.freeTools}</p>
        {twitchStage === 'tester' ? <p className="pulse-supporter-detail">{ACCOUNT_COPY.testersOnly}</p> : null}
        {twitchWindow ? null : <p className="pulse-supporter-detail">This browser cannot open the Twitch sign-in window.</p>}
      </>
      primary = twitchWindow ? continueWithTwitch() : supporterDetails(true)
      if (twitchWindow) secondary = [supporterDetails(false)]
    }
  } else if (renewalWaiting) {
    state = 'connection-waiting'
    title = 'Signed in, but the account service is unavailable'
    body = <p className="pulse-supporter-detail">This extension is still signed in. Your free tools still work; check again in a moment.</p>
    primary = <button className="pulse-journey-primary" type="button" disabled={accountBusy || checking} onClick={() => void checkAgain()}>Check again</button>
  } else if (!entitlement || entitlement.state === 'not_linked') {
    state = 'membership-loading'
    title = 'Checking Supporter status…'
  } else if (entitlement.state === 'unavailable' || entitlement.state === 'error') {
    state = 'membership-unknown'
    title = 'Supporter status unavailable'
    body = <p className="pulse-supporter-detail">{entitlement.state === 'unavailable' && 'reason' in entitlement ? UNAVAILABLE_COPY[entitlement.reason] : 'Could not reach StreamPulse to check Supporter status.'} Your free tools are unaffected.</p>
    primary = <button className="pulse-journey-primary" type="button" disabled={checking} onClick={() => void checkAgain()}>{checking ? 'Checking…' : 'Check again'}</button>
  } else if (status === 'none') {
    if (!checkoutOpen) {
      state = 'checkout-closed'
      title = 'Supporter sign-ups are not open yet'
      body = <p>{signedInWithTwitch ? 'You’re signed in.' : 'Your account is connected.'} The offer appears here when sign-ups open.</p>
      primary = <button className="pulse-journey-primary" type="button" disabled={checking} onClick={() => void checkAgain().then(readBilling)}>Check sign-up status</button>
      terms = true
    } else if (workerCheckout) {
      state = 'offer'; title = 'Become a Pulse Supporter'
      body = <><p>Pay on Stripe. This extension updates by itself after your payment is confirmed.</p>{twitchOn ? <p className="pulse-supporter-detail">{ACCOUNT_COPY.billingEmail}</p> : null}</>
      primary = <button className="pulse-journey-primary" type="button" disabled={payBusy} onClick={() => void purchase()}>{payBusy ? 'Preparing checkout…' : ACCOUNT_COPY.becomeSupporter}</button>
      terms = true
    } else if (intent === 'purchase') {
      state = 'purchase-continuing'
      title = 'Complete your purchase on streampulse.stream'
      body = <p>Supporter turns on here by itself after Stripe confirms your payment.</p>
      primary = <a className="pulse-journey-primary" data-supporter-action="billing" href={billingHref} target="_blank" rel="noopener noreferrer" onClick={openBilling}>Return to checkout</a>
    } else {
      // An invited tester's connected account: checkout stays on the website.
      state = 'offer'
      title = 'Become a Pulse Supporter'
      body = <p>Supporter funds Pulse development and adds a few original cosmetics.</p>
      terms = true
      primary = <a className="pulse-journey-primary" data-supporter-action="billing" href={billingHref} target="_blank" rel="noopener noreferrer" onClick={openBilling}>Continue to checkout</a>
    }
  } else if (status === 'pending') {
    state = 'payment-pending'
    title = 'Confirming your payment'
    body = <p>Stripe is still confirming your payment. Supporter turns on here by itself; you do not need to pay again.</p>
    primary = workerBilling
      ? <button className="pulse-journey-primary" type="button" disabled={payBusy} onClick={() => void checkPayment()}>Check payment status</button>
      : <a className="pulse-journey-primary" data-supporter-action="billing" href={billingHref} target="_blank" rel="noopener noreferrer">View payment status</a>
  } else if (status === 'active') {
    state = 'active'
    title = intent === 'purchase' ? 'You are a Supporter' : 'Supporter active'
    body = <p>{intent === 'purchase' ? 'Thank you. Your Supporter finishes are unlocked below.' : 'Thank you for supporting Pulse.'}</p>
    primary = <a className="pulse-journey-primary" data-supporter-action="billing" href={billingHref} target="_blank" rel="noopener noreferrer">{ACCOUNT_COPY.manageSubscription}</a>
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

  if (linked && workerBilling && entitlement?.state === 'ready' && (isSupporter || status === 'expired' || status === 'review')) {
    primary = status === 'expired' && checkoutOpen && workerCheckout ? <button className="pulse-journey-primary" type="button" disabled={payBusy} onClick={() => void purchase()}>Rejoin Supporter</button>
      : <button className="pulse-journey-primary" type="button" disabled={payBusy} onClick={() => void manage('card')}>{status === 'grace' ? 'Update payment method' : ACCOUNT_COPY.manageSubscription}</button>
  }

  // Worker-owned uncertainty always outranks the offer, including after settings
  // closes or reloads. A failed return page is never evidence of payment.
  if (!isSupporter && billing.state !== 'idle' && billing.state !== 'fallback') {
    terms = false; primary = null; secondary = []
    if (billing.state === 'active') {
      state = 'membership-loading'; title = 'Checking Supporter status…'
      body = <p>Check your current membership before starting another payment. Your free tools still work.</p>
      primary = <button className="pulse-journey-primary" type="button" disabled={checking} onClick={() => void checkAgain().then(readBilling)}>Check again</button>
    } else if (billing.state === 'waiting') {
      state = 'stripe-open'; title = 'Stripe checkout is open'
      body = <p>Complete payment in the Stripe tab. {billing.automaticPolling === false ? 'Automatic checks have paused. Check payment status when you return.' : 'This extension updates by itself; you do not need to refresh.'}</p>
      primary = <button className="pulse-journey-primary" type="button" disabled={payBusy} onClick={() => { void chrome.runtime.sendMessage({ type: 'SUPPORTER_BILLING', action: 'resume' }).then(() => readBilling()).catch(() => setNotice('Could not reopen Stripe. Check status before trying another payment.')) }}>Return to Stripe checkout</button>
      if (billing.automaticPolling === false) secondary = [<button key="check" type="button" disabled={payBusy} onClick={() => void checkPayment()}>Check payment status</button>]
    }
    else if (billing.state === 'confirming' || billing.state === 'still_confirming') {
      state = billing.state === 'confirming' ? 'payment-pending' : 'still-confirming'
      title = billing.state === 'confirming' ? 'Confirming your payment' : 'Still confirming your payment'
      body = <p>Your payment status is not confirmed yet. Do not pay again. {billing.state === 'still_confirming' ? 'Check status when you return, or contact support if it stays unresolved.' : 'Supporter turns on here after the server confirms it.'}</p>
      primary = <button className="pulse-journey-primary" type="button" disabled={payBusy} onClick={() => void checkPayment()}>Check payment status</button>
    } else if (billing.state === 'closed' || (billing.state === 'expired' && entitlement?.state === 'ready' && !checkoutOpen)) { state = 'checkout-closed'; title = 'Supporter sign-ups are not open yet'; body = <p>Your free tools still work. Return when paid sign-ups open.</p>; primary = <button className="pulse-journey-primary" type="button" disabled={checking} onClick={() => void checkAgain().then(readBilling)}>Check sign-up status</button> }
    else if (billing.state === 'expired') { state = 'checkout-expired'; title = 'Checkout expired'; body = <p>The checkout session ended before completion. You can start a new checkout when ready.</p>; primary = linked ? <button className="pulse-journey-primary" type="button" disabled={payBusy} onClick={() => void purchase()}>Start checkout again</button> : null }
    else if (billing.state === 'review') { state = 'review'; title = 'Membership needs review'; body = <p>A payment needs checking. Do not pay again; contact support for help.</p>; primary = <a className="pulse-journey-primary" href={POLICY_LINKS.support} target="_blank" rel="noopener noreferrer">Contact support</a> }
    else if (billing.state === 'reconnect_required') {
      // A payment from an earlier sign-in. Never offered as a reason to pay
      // again, and never resolved by email: the same account resolves it.
      state = 'previous-payment-unresolved'; title = 'A payment from an earlier sign-in is unresolved'
      body = <p>{twitchOn
        ? 'A payment started before this extension was signed out is still unresolved. Do not pay again. Continue with Twitch with the same Twitch account to check it, or contact support.'
        : 'A payment started before this extension was disconnected is still unresolved. Do not pay again; contact support for help.'} Signing out does not prove the payment failed.</p>
      const support = <a key="help" className={twitchOn && unlinked && twitchWindow ? undefined : 'pulse-journey-primary'} href={POLICY_LINKS.support} target="_blank" rel="noopener noreferrer">Contact support</a>
      if (twitchOn && unlinked && twitchWindow) { primary = continueWithTwitch(); secondary = [support] } else primary = support
      if (linked) secondary.push(<button key="check" type="button" disabled={payBusy} onClick={() => void checkPayment()}>Check payment status</button>)
    } else { state = 'billing-unavailable'; title = 'Checkout is unavailable'; body = <p>The service could not prepare checkout. Your free tools still work.</p>; primary = <button className="pulse-journey-primary" type="button" disabled={payBusy} onClick={() => { setBilling({ state: 'idle' }); void checkAgain() }}>Try again</button> }
  }
  if (entitlement?.state === 'ready' && entitlement.accountKind === 'installation' && entitlement.installationAccountsEnabled !== true) {
    if (!isSupporter && status !== 'review' && status !== 'expired') primary = <button className="pulse-journey-primary" type="button" disabled={checking} onClick={() => void checkAgain()}>Check again</button>
    secondary = []
    terms = false
    body = <><p>New Supporter sign-ups are temporarily unavailable.</p>{isSupporter ? <p>Your Supporter access and membership management still apply.</p> : null}</>
  }
  // The portal asked for a Twitch check from the last 10 minutes: a click
  // opens the Twitch window, then the portal is tried once more.
  if (linked && confirmIdentity) {
    state = 'confirm-identity'; title = ACCOUNT_COPY.confirmHeading; terms = false
    body = <p>{ACCOUNT_COPY.confirmBody}</p>
    primary = <button className="pulse-twitch-signin" type="button" disabled={payBusy} aria-busy={payBusy || undefined} onClick={() => void manage(confirmIdentity, true)}><TwitchGlitch />{payBusy ? ACCOUNT_COPY.openingTwitch : ACCOUNT_COPY.continueWithTwitch}</button>
    secondary = [<button key="back" type="button" disabled={payBusy} onClick={() => setConfirmIdentity(null)}>Not now</button>]
  }

  // The card already names the account and the months supported.
  const facts: Array<[string, string]> = []
  if (isSupporter && accessDate) facts.push([status === 'grace' ? 'Access until' : 'Access through', accessDate])

  // Only a known account state names an account or says there is none: before
  // the worker answers, or when it cannot, the card and the Account row stay neutral.
  const identity: CardIdentity = linked ? profile ? { kind: 'twitch', displayName: profile.displayName, ...(profile.picture ? { picture: profile.picture } : {}) } : { kind: 'pulse', reference: accountReference(linked.accountId) }
    : renewalWaiting ? { kind: 'pulse' }
    : !account ? { kind: 'unknown', reason: 'checking' }
    : account.state === 'error' || accountDown ? { kind: 'unknown', reason: 'unavailable' }
    : { kind: 'none' }
  // Likewise the membership: before the server answers, or when it cannot, the
  // card says it is checking or unavailable, never "not a Supporter".
  const cardStatus: CardStatus = status ?? (identity.kind === 'none' ? 'none' : entitlement?.state === 'error' || entitlement?.state === 'unavailable' ? 'unknown' : 'checking')
  // The card is display: through a failed refresh it keeps the last confirmed
  // look, as the footer says. Only paid controls pause (see onEntitlement).
  const perks = supporterPerksAllowed(entitlement)
  const equipped = perks && entitlement?.state === 'ready' && entitlement.cosmetics?.enabled ? entitlement.cosmetics.finish : null
  const cardLook: CardLook = { finish: look ? look.finish : perks ? equipped : SAMPLE_KIT.finish, paint: look?.paint ?? DEFAULT_SUPPORTER_PAINT, perks }
  const connected = linked !== null || renewalWaiting
  const accountRow: [string, string] = signedInWithTwitch ? [profile ? `${ACCOUNT_COPY.signedInWithTwitch} as ${profile.displayName}` : ACCOUNT_COPY.signedInWithTwitch, 'Signing in stores a device credential in this extension. Sign out ends this device’s access and removes its signed-in watched history and notes.']
    : connected ? ['Connected to this extension', 'An invited tester’s StreamPulse account. Sign out ends this device’s access and removes its signed-in watched history and notes.']
    : identity.kind === 'unknown' ? [identity.reason === 'checking' ? 'Checking the connection…' : 'Connection status unavailable', 'Your free tools still work.']
    : ['Not signed in', ACCOUNT_COPY.freeTools]
  // Invited testers keep the existing device link, closed by default and
  // never a purchase: "Connect this extension" with Twitch off, "Other ways to
  // connect" beside Continue with Twitch.
  const testerBridge = unlinked && !linkingNotDeployed && billing.state !== 'reconnect_required'

  return (
    <>
      <SupporterCard
        identity={identity}
        membership={{ status: cardStatus, months: periods, tenure: supporterTenureForMonths(periods) }}
        look={cardLook}
      >
        <div className="pulse-journey" data-journey-state={state} data-twitch-stage={twitchStage} data-tone={status === 'grace' && state === 'grace' ? 'warn' : undefined}>
          <div className="pulse-journey-row">
            <div className="pulse-journey-main">
              <div role="status" aria-live="polite" className="pulse-journey-status">
                <p className="pulse-journey-title"><strong>{title}</strong></p>
                {body}
                {stale ? <p className="pulse-supporter-detail" data-journey-stale="true">Could not refresh just now; showing the last confirmed status.</p> : null}
                {notice.text && notice.at === 'card' ? <p className="pulse-journey-notice">{notice.text}</p> : null}
              </div>
              {facts.length ? <dl className="pulse-journey-facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : null}
              {/* The price and its renewal terms come before the button that
                  buys it, in reading and Tab order and above it at any width;
                  beside it when there is room, as in the redesign's footer. */}
              {terms ? <OfferTerms /> : null}
            </div>
            {primary ? <div className="pulse-account-link-actions pulse-journey-actions">{primary}</div> : null}
          </div>
          {secondary.length ? <div className="pulse-account-link-actions pulse-journey-actions">{secondary}</div> : null}
          {testerBridge ? <details className="pulse-journey-devices" data-tester-bridge="true">
            <summary>{twitchOn ? ACCOUNT_COPY.otherWays : ACCOUNT_COPY.testerBridge}</summary>
            <p className="pulse-supporter-detail">For invited testers with a StreamPulse account: connect this extension with a one-time code from streampulse.stream. This is not a purchase.</p>
            <div className="pulse-account-link-actions">
              <button type="button" disabled={accountBusy || signingIn !== null} onClick={() => void connectTester()}>{accountBusy && intent === 'connect' ? 'Preparing…' : 'Connect this extension'}</button>
            </div>
          </details> : null}
        </div>
      </SupporterCard>

      {children}

      <PulseSectionCard title="Account" headingLevel={3}>
        <div className="pulse-supporter-account-rows">
          <dl className="pulse-supporter-rows">
            <div data-row="account">
              <dt>StreamPulse</dt>
              <dd>
                {accountRow[0]}
                <small>{accountRow[1]}</small>
              </dd>
              <dd className="pulse-account-link-actions">{connected ? <>
                <button type="button" disabled={accountBusy || payBusy || signingIn !== null} onClick={disconnect}>{ACCOUNT_COPY.signOut}</button>
                {twitchOn && signedInWithTwitch && twitchWindow ? <button type="button" className="pulse-account-quiet-button" disabled={accountBusy || payBusy || signingIn !== null} onClick={() => void signIn('interactive', true)}>{ACCOUNT_COPY.differentAccount}</button> : null}
              </> : null}</dd>
            </div>
            {/* Its own row: the account row already holds Sign out and the account switch. */}
            {everywhereOffered ? <div data-row="sign-out-everywhere">
              <dt>All devices</dt>
              <dd>Every browser and extension<small>Sign out everywhere ends every website session and extension signed in to this account. Nothing is deleted from your account.</small></dd>
              <dd className="pulse-account-link-actions"><button type="button" disabled={accountBusy || payBusy || signingIn !== null} onClick={() => { setConfirmDisconnect(false); setNotice('', 'account'); setEverywhere('ask') }}>{ACCOUNT_COPY.signOutEverywhere}</button></dd>
            </div> : null}
            {isSupporter && entitlement?.state === 'ready' ? <div data-row="billing">
              <dt>Billing</dt>
              <dd>Stripe<small>Change card, get receipts, or cancel.</small></dd>
              {/* Never disabled while it works: a disabled button drops keyboard
                  focus to the page. manage() ignores a press while one is open. */}
              <dd className="pulse-account-link-actions"><button type="button" aria-busy={payBusy || undefined} onClick={() => void manage('account')}>{ACCOUNT_COPY.manageSubscription} <span className="pulse-supporter-ext" aria-hidden="true">↗</span></button></dd>
            </div> : null}
            <div data-row="new-browser">
              <dt>New browser</dt>
              {twitchOn
                ? <dd>Continue with Twitch with the same Twitch account.<small>Your Supporter status comes back after a reinstall or on another browser. No code to copy, no email to confirm.</small></dd>
                : <dd>{ACCOUNT_COPY.comingSoon}<small>You’ll use the same Twitch account on each browser, and your Supporter status follows it.</small></dd>}
              <dd />
            </div>
            <div data-row="payments">
              <dt>Payments</dt>
              <dd>Handled by Stripe.<small>Stripe asks for a billing email at checkout; it can be different from your Twitch email. StreamPulse never sees or stores your card number.</small></dd>
              <dd />
            </div>
            {twitchOn ? <div data-row="lost-twitch">
              <dt>Lost Twitch access</dt>
              <dd>Stripe’s customer portal still works with the email you paid with.<small>That changes billing only. It doesn’t move your membership to another Twitch account; contact support and we’ll help.</small></dd>
              <dd />
            </div> : null}
          </dl>
          {/* Sign out, Manage subscription and revoke report here, beside their
              rows, not in the card footer a screen above. Always present, so
              the outcome is announced when it arrives. */}
          <div role="status" aria-live="polite" className="pulse-supporter-account-status" data-account-notice>
            {notice.text && notice.at === 'account' ? <p className="pulse-journey-notice">{notice.text}</p> : null}
          </div>
        </div>
        {everywhereOffered && everywhere === 'ask' ? <div className="pulse-journey-confirm" role="group" aria-label="Confirm sign out everywhere" data-sign-out-everywhere="ask"><p>Sign out everywhere? This ends every StreamPulse website session and signs out every extension connected to this account, including this one. Nothing is deleted from your account, and it does not cancel your subscription. Each extension removes its signed-in watched history and notes. Continue with Twitch with the same Twitch account to sign in again.</p><div className="pulse-account-link-actions pulse-journey-actions"><button type="button" disabled={everywhereBusy || accountBusy || payBusy} aria-busy={everywhereBusy || undefined} onClick={() => void signOutEverywhere()}>{everywhereBusy ? 'Signing out everywhere…' : 'Confirm sign out everywhere'}</button><button type="button" disabled={everywhereBusy} onClick={() => setEverywhere(null)}>Stay signed in</button></div></div> : null}
        {everywhereOffered && everywhere === 'confirm_identity' ? <div className="pulse-journey-confirm" role="group" aria-label={ACCOUNT_COPY.confirmHeading} data-sign-out-everywhere="confirm-identity"><p><strong>{ACCOUNT_COPY.confirmHeading}</strong></p><p>{ACCOUNT_COPY.confirmEverywhereBody}</p><div className="pulse-account-link-actions pulse-journey-actions"><button className="pulse-twitch-signin" type="button" disabled={everywhereBusy} aria-busy={everywhereBusy || undefined} onClick={() => void signOutEverywhere(true)}><TwitchGlitch />{everywhereBusy ? ACCOUNT_COPY.openingTwitch : ACCOUNT_COPY.continueWithTwitch}</button><button type="button" disabled={everywhereBusy} onClick={() => setEverywhere(null)}>Not now</button></div></div> : null}
        {confirmDisconnect ? <div className="pulse-journey-confirm" role="group" aria-label="Confirm sign out"><p>Sign out of this extension? This does not cancel your subscription or stop a payment already in progress. {twitchOn ? 'Continue with Twitch with the same Twitch account to see it here again.' : 'Connect this extension again to see it here.'}</p><div className="pulse-account-link-actions pulse-journey-actions"><button type="button" disabled={accountBusy || payBusy} onClick={() => void confirmDisconnection()}>Confirm sign out</button><button type="button" onClick={() => setConfirmDisconnect(false)}>Stay signed in</button></div></div> : null}
        {linked && entitlement?.state === 'ready' && entitlement.accountKind === 'installation' && entitlement.installationAccountsEnabled === true ? <details className="pulse-journey-devices" onToggle={event => { if (event.currentTarget.open && devices === null) void listDevices() }}>
          <summary>Connected extensions</summary>
          <p className="pulse-supporter-detail">Revoke an extension you no longer recognize. Use Sign out above to leave this browser.</p>
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
