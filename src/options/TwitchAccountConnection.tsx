import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { SupporterAccountState } from '../shared/supporterAccount.ts'
import type { TwitchProfile, TwitchSignInMode, TwitchSignInOutcome, TwitchSignInRequest, TwitchSignInResponse, TwitchSignInStatus } from '../shared/twitchSignIn.ts'
import { deviceLinkWithCode } from '../shared/portalLinks.ts'
import { PulseSectionCard } from '../ui/PulseSectionCard.tsx'
import type { AccountConnectionModel } from './useAccountConnection.ts'
import { usePortalOrigin } from './usePortalOrigin.ts'

const SIGNED_OUT: Record<string, string> = {
  signed_out: 'Continue with Twitch to keep your saves with your StreamPulse account on every browser where you sign in. Free tools work without an account.',
  relink_required: 'You were signed out on this browser. Continue with Twitch to sign in again.',
  denied: 'The code was declined. Continue with Twitch, or start a new code under Other ways to connect (testers).',
  expired: 'That code expired. Continue with Twitch, or start a new code under Other ways to connect (testers).',
  error: 'The account service could not be reached. Check your connection and try again.',
  pending: 'Waiting for you to approve the code below. You can Continue with Twitch instead.',
}
const UNAVAILABLE: Record<Extract<SupporterAccountState, { state: 'unavailable' }>['reason'], string> = {
  not_deployed: 'Account sign-in is not available on the server yet. Your free tools still work.',
  temporarily_unavailable: 'The account service is temporarily unavailable. Your free tools still work; try again in a moment.',
}
const UNRENEWED = 'You are still signed in, but the account service is temporarily unavailable. Your free tools still work; check again in a moment.'

/**
 * Plain copy that says what to do next (account journey spec §2 E2). Success
 * needs none: the status line shows it. `revoked` shows the button only.
 */
const OUTCOME_COPY: Partial<Record<TwitchSignInOutcome, string>> = {
  cancelled: 'Sign-in was cancelled. Select Continue with Twitch to try again.',
  interaction_required: 'Select Continue with Twitch to continue.',
  state_mismatch: 'Twitch’s reply did not match this sign-in, so nothing changed. Try again.',
  token_invalid: 'Twitch’s reply could not be verified, so nothing changed. Try again.',
  flow_expired: 'The sign-in took too long. Try again and finish in the Twitch window within a few minutes.',
  pilot_only: 'Twitch sign-in is open to invited testers right now. Free tools work without an account.',
  link_required: 'Invited testers: link Twitch to your StreamPulse account on streampulse.stream first, then try again. Free tools work without an account.',
  identity_in_use: 'That Twitch account already has its own StreamPulse account. We never combine accounts. Contact us if one of them has a membership.',
  account_deleted: 'That StreamPulse account was deleted. Try again in a few minutes to start a new one.',
  signup_unavailable: 'New StreamPulse accounts are paused right now. Your free tools still work; try again later.',
  try_later: 'Too many sign-in attempts. Wait a minute, then try again.',
  surface_unavailable: 'Twitch sign-in is not set up for this browser yet. Free tools work without an account.',
  redirect_mismatch: 'Twitch sign-in is not set up for this extension build. Free tools work without an account.',
  auth_window_failed: 'The Twitch window could not finish. Try again.',
  network: 'Could not reach StreamPulse. Check your connection and try again.',
  unavailable: 'Sign-in is not available right now. Your free tools still work; try again later.',
  hosted_only: 'Sign-in works only with the hosted StreamPulse service. Reset the backend address in Developer tools, then try again.',
  revocation_pending: 'Finish signing out first: select Retry sign out.',
  busy: 'A Twitch sign-in window is already open. Finish or close it first.',
  disabled: 'Twitch sign-in is coming soon.',
  unsupported: 'This browser cannot open the Twitch sign-in window.',
  error: 'Something went wrong, so you were not signed in. Try again.',
}

export function twitchOutcomeMessage(outcome: TwitchSignInOutcome | undefined, retryAfterSeconds?: number): string {
  const copy = outcome ? OUTCOME_COPY[outcome] ?? '' : ''
  if (copy && retryAfterSeconds && retryAfterSeconds > 0 && (outcome === 'signup_unavailable' || outcome === 'try_later')) {
    const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60))
    return `${copy} You can try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`
  }
  return copy
}

/** Twitch glitch mark, per the Twitch brand guidelines (white on Twitch purple). */
export function TwitchGlitch() {
  return <svg className="pulse-twitch-glitch" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
  </svg>
}

function SignedIn({ profile, unrenewed }: { profile: TwitchProfile | null; unrenewed: boolean }) {
  return <div className="pulse-account-identity">
    {profile?.picture ? <img className="pulse-account-avatar" src={profile.picture} alt="" width={40} height={40} referrerPolicy="no-referrer" /> : null}
    <div>
      <p><strong>Signed in with Twitch</strong>{profile ? <> as <span className="pulse-account-name">{profile.displayName}</span></> : null}</p>
      <p className="pulse-supporter-detail">{unrenewed ? UNRENEWED : 'Saves you make while signed in are kept with your StreamPulse account.'}</p>
    </div>
  </div>
}

/** Twitch reachable only if the worker says so; a dead worker still leaves a working button. */
const UNKNOWN_STATUS: TwitchSignInStatus = { enabled: true, available: true, silentEligible: false, profile: null }

/**
 * Standalone "Pulse account" card with Continue with Twitch. The Account &
 * Supporter page uses SupporterJourney, which carries the same sign-in; this
 * card stays for surfaces without the Supporter card. The worker runs the auth window,
 * holds every secret, and returns only the account projection, the outcome and
 * a display-only profile; this card keeps the profile in memory only.
 */
export function TwitchAccountConnection({ connection, fallback }: { connection: AccountConnectionModel; fallback: ReactNode }) {
  const { account, busy, notice, request, apply } = connection
  const [twitch, setTwitch] = useState<TwitchSignInStatus | null>(null)
  const [signingIn, setSigningIn] = useState<TwitchSignInMode | null>(null)
  const [message, setMessage] = useState('')
  const [otherWays, setOtherWays] = useState(false)
  const silentTried = useRef(false)
  const live = useRef(true)
  const portalOrigin = usePortalOrigin()

  const send = useCallback(async (payload: TwitchSignInRequest): Promise<TwitchSignInResponse> => {
    const response = await chrome.runtime.sendMessage(payload) as TwitchSignInResponse | undefined
    if (!response || response.type !== 'TWITCH_SIGN_IN' || !response.status || !response.account) throw new Error('Account worker unavailable')
    return response
  }, [])

  const refresh = useCallback(async () => {
    try {
      const response = await send({ type: 'TWITCH_SIGN_IN', action: 'status' })
      if (live.current) setTwitch(response.status)
    } catch {
      if (live.current) setTwitch(current => current ?? UNKNOWN_STATUS)
    }
  }, [send])

  const signIn = useCallback(async (mode: TwitchSignInMode, forceVerify = false) => {
    setSigningIn(mode)
    setMessage('')
    try {
      const response = await send(forceVerify
        ? { type: 'TWITCH_SIGN_IN', action: 'sign_in', mode: 'interactive', forceVerify: true }
        : { type: 'TWITCH_SIGN_IN', action: 'sign_in', mode })
      if (!live.current) return
      setTwitch(response.status)
      apply(response.account)
      // A silent attempt that cannot finish just leaves the button; it never explains itself.
      if (mode === 'interactive') setMessage(twitchOutcomeMessage(response.outcome, response.retryAfterSeconds))
    } catch {
      if (live.current && mode === 'interactive') setMessage(OUTCOME_COPY.network!)
    } finally {
      if (live.current) setSigningIn(null)
    }
  }, [apply, send])

  useEffect(() => {
    live.current = true
    void refresh()
    const changed = (changes: Record<string, chrome.storage.StorageChange>) => {
      if ('pulseAccountRevision' in changes) void refresh()
    }
    const storage = globalThis.chrome?.storage?.onChanged
    storage?.addListener(changed)
    return () => { live.current = false; storage?.removeListener(changed) }
  }, [refresh])

  // True first install only (the worker decides): one quiet attempt, no window.
  useEffect(() => {
    if (silentTried.current || !twitch?.silentEligible || account?.state !== 'signed_out' || signingIn || busy) return
    silentTried.current = true
    void signIn('silent')
  }, [account?.state, busy, signIn, signingIn, twitch?.silentEligible])

  // Firefox for Android and other browsers without identity.launchWebAuthFlow.
  if (twitch && !twitch.available) return <>{fallback}</>

  const ready = Boolean(account && twitch)
  const unrenewed = account?.state === 'unavailable' && account.linked === true
  const signedIn = account?.state === 'linked' || unrenewed
  const revocationPending = account?.state === 'error' && account.revocationPending === true
  const pending = account?.state === 'pending' ? account : null
  const codeLinkNotDeployed = account?.state === 'unavailable' && account.reason === 'not_deployed' && !account.linked
  const disabled = busy || signingIn !== null
  const profile = signedIn ? twitch?.profile ?? null : null

  return <PulseSectionCard title="Pulse account" headingLevel={3}>
    <div role="status" aria-live="polite">
      {!account || !twitch ? <p>Checking account connection…</p>
        : signingIn === 'silent' ? <p>Checking for an earlier Twitch sign-in…</p>
          : signedIn ? <SignedIn profile={profile} unrenewed={unrenewed} />
            : revocationPending ? <p>Account access is stopped on this extension. Sign-out is not confirmed by the server yet; select Retry sign out when you are connected.</p>
              : <p>{account.state === 'unavailable' ? UNAVAILABLE[account.reason] : SIGNED_OUT[account.state]}</p>}
      {message ? <p>{message}</p> : null}
      {notice ? <p>{notice}</p> : null}
    </div>
    {ready ? <div className="pulse-account-link-actions">
      {signedIn ? <>
        <button type="button" disabled={disabled} onClick={() => { setMessage(''); void request('disconnect') }}>Sign out</button>
        <button type="button" className="pulse-account-quiet-button" disabled={disabled} onClick={() => void signIn('interactive', true)}>{profile ? 'Not you?' : 'Use a different Twitch account'}</button>
        {unrenewed ? <button type="button" disabled={disabled} onClick={() => void request('status')}>Check connection</button> : null}
      </>
        : revocationPending ? <button type="button" disabled={disabled} onClick={() => void request('disconnect')}>Retry sign out</button>
          : <button type="button" className="pulse-twitch-signin" disabled={disabled} aria-busy={signingIn === 'interactive' ? true : undefined} onClick={() => void signIn('interactive')}>
            <TwitchGlitch />{signingIn === 'interactive' ? 'Opening Twitch…' : 'Continue with Twitch'}
          </button>}
      {account?.state === 'error' && !revocationPending ? <button type="button" disabled={disabled} onClick={() => void request('status')}>Check connection</button> : null}
    </div> : null}
    {ready && !signedIn && !revocationPending ? <details className="pulse-account-other-ways" open={otherWays || pending !== null} onToggle={event => setOtherWays(event.currentTarget.open)}>
      <summary>Other ways to connect (testers)</summary>
      {pending ? <>
        <p>Open the Pulse account page with this code prepared, then choose Review extension and Approve extension. You can also enter the code yourself.</p>
        <p className="pulse-account-link-code">{pending.code}</p>
        <p className="pulse-supporter-detail">Waiting for your approval. The code expires at {new Date(pending.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.</p>
        <div className="pulse-account-link-actions">
          <a href={deviceLinkWithCode(pending.code, portalOrigin)} target="_blank" rel="noopener noreferrer">Open account page</a>
          <button type="button" disabled={disabled} onClick={() => void request('cancel')}>Cancel code</button>
        </div>
      </>
        : codeLinkNotDeployed ? <p className="pulse-supporter-detail">Linking with a code is not available on the server yet.</p>
          : <>
            <p className="pulse-supporter-detail">For invited testers with a StreamPulse account: link this extension with a one-time code from streampulse.stream instead.</p>
            <div className="pulse-account-link-actions">
              <button type="button" disabled={disabled} onClick={() => void request('start')}>{busy ? 'Connecting…' : 'Link with a code'}</button>
            </div>
          </>}
    </details> : null}
  </PulseSectionCard>
}
