import { useEffect, useId, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { LogOut, Monitor, Trash2 } from 'lucide-react'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { AccountFooter } from './AccountFooter'
import { accountRequest, accountErrorText, AccountError } from '../../lib/accountApi'
import { announceAccountSignedOut } from '../../lib/accountSessionSignal'
import { forgetAccountSession, knownTwitchIdentity, useAccountSession } from '../../lib/accountSession'
import { clearBillingStepUp, rememberBillingStepUp, takeBillingStepUp, type BillingStepUpCheck } from '../../lib/accountStepUp'
import { twitchSignInEnabled, twitchSignInPublic } from '../../lib/twitchSignInFlag'
import { beginTwitchFlow, TWITCH_DEFAULT_RETURN, twitchErrorCode, type TwitchErrorCode } from '../../lib/twitchSignIn'
import { TwitchButton, TwitchErrorNotice, TwitchGlitch } from './TwitchSignIn'
import './account.css'

/**
 * Twitch row (VITE_TWITCH_SIGNIN=1). /v1/account/me does not say whether an
 * account has Twitch linked, so "Connected" shows only what this tab saw: a
 * Twitch sign-in, a finished link, or an "already linked" answer. Otherwise it
 * offers Link Twitch, which the API answers with account_already_linked when
 * there is nothing to do.
 */
function TwitchAccountRow() {
  const headingId = useId()
  const state = useLocation().state as { twitch?: unknown } | null
  const session = useAccountSession()
  // This tab's sign-in carries the name and picture; /me only says a link exists.
  const known = knownTwitchIdentity() ?? (session.status === 'signed_in' && session.profile.twitchLinked ? {} : null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<TwitchErrorCode | null>(null)
  async function link() {
    if (busy) return
    setBusy(true); setError(null)
    // Linking needs a sign-in from the last 10 minutes; the API says so if not.
    try { await beginTwitchFlow({ purpose: 'link' }) }
    catch (failure) { setError(twitchErrorCode(failure)); setBusy(false) }
  }
  const name = known?.displayName
  // Only a sign-in this tab saw may say "Signed in with Twitch"; a link or /me says linked.
  const signedInWithTwitch = known?.via === 'signin'
  return <section className="pulse-account-twitch-row" aria-labelledby={headingId} data-testid="twitch-account-row">
    <div className="pulse-account-section-heading"><h2 id={headingId}>Twitch</h2></div>
    {known ? <div className="pulse-account-twitch-connected">
      {known.avatarUrl ? <img src={known.avatarUrl} alt="" width={32} height={32} referrerPolicy="no-referrer" /> : <span className="pulse-account-twitch-mark"><TwitchGlitch /></span>}
      <p>{signedInWithTwitch
        ? name ? <>Signed in with Twitch as <strong>{name}</strong></> : 'Signed in with Twitch'
        : name ? <>Twitch linked: <strong>{name}</strong></> : 'Twitch is linked to this account.'}</p>
    </div> : <div className="pulse-account-twitch-link">
      <p>Link Twitch so you can Continue with Twitch next time. Linking needs a sign-in from the last 10 minutes plus a fresh Twitch sign-in, and never combines two accounts. StreamPulse never receives your Twitch password or email.</p>
      <TwitchButton busy={busy} busyLabel="Opening Twitch…" onClick={() => void link()}>Link Twitch</TwitchButton>
    </div>}
    {known && state?.twitch === 'linked' ? <p role="status">Twitch is now linked. Next time, you can Continue with Twitch.</p> : null}
    {error ? <TwitchErrorNotice code={error} purpose="link" current="/account/settings" /> : null}
  </section>
}

/**
 * A visit with no session: how to sign in for this stage, and that free tools
 * need no account. In the public stage Continue with Twitch returns here
 * (the Twitch flow's default destination); otherwise the sign-in page is the
 * invited-tester sign-in.
 */
function SignedOutSettings() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<TwitchErrorCode | null>(null)
  async function continueWithTwitch() {
    if (busy) return
    setBusy(true); setError(null)
    // On success the page leaves for Twitch, so the button stays busy.
    try { await beginTwitchFlow({ purpose: 'signin' }) }
    catch (failure) { setError(twitchErrorCode(failure)); setBusy(false) }
  }
  return <div className="pulse-account-signed-out" data-testid="settings-signed-out">
    {twitchSignInPublic()
      ? <><p>Sign in to see your account and devices. Free tools work without an account.</p>
        <TwitchButton busy={busy} busyLabel="Opening Twitch…" onClick={() => void continueWithTwitch()}>Continue with Twitch</TwitchButton>
        {error ? <TwitchErrorNotice code={error} purpose="signin" current="/account/settings" /> : null}</>
      : <><p>Invited testers can sign in to see their account and devices. Free tools work without an account.</p>
        <Link className="pulse-account-button pulse-account-primary" to="/account/sign-in">Tester sign-in</Link></>}
  </div>
}

/** 'server': the API answered with an error; 'network': no answer reached this page. */
type RevokeAllProblem = 'step_up' | 'unavailable' | 'server' | 'network'

/**
 * Sign out everywhere (VITE_TWITCH_SIGNIN on): POST
 * /v1/account/sessions/revoke-all ends every website session and extension
 * device of this account and blocks the extension's silent sign-in. It needs a
 * sign-in from the last 10 minutes (403 recent_auth_required), which a Twitch
 * account confirms with "Confirm it's you" and an email account with a fresh
 * sign-in. That refusal comes only while this browser is still signed in, and
 * /account/sign-in shows a signed-in visitor "You're signed in" instead of the
 * email form, so the email path signs this browser out first and opens the
 * email form. Until the backend route is deployed and the website relay allows it,
 * the call answers 404, and the page says it is not available yet.
 *
 * The Twitch check is tied to the account that asked (accountStepUp.ts, purpose
 * 'revoke-all'): if Twitch returns a different account, nothing is signed out
 * and the person chooses what to do.
 */
function SignOutEverywhere({ accountId, returned, onDone, onSessionEnded, onSignOut, signOutBusy }: {
  accountId: string
  returned: BillingStepUpCheck
  onDone: () => void
  onSessionEnded: (error: unknown) => void
  /** Sign this browser out, then go to `next` (default /account/sign-in). */
  onSignOut: (next?: string) => void
  signOutBusy: boolean
}) {
  const headingId = useId()
  const session = useAccountSession()
  const [confirming, setConfirming] = useState(returned === 'same')
  const [wrongAccount, setWrongAccount] = useState(returned === 'different')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<RevokeAllProblem | null>(null)
  const [error, setError] = useState('')
  const [twitchBusy, setTwitchBusy] = useState(false)
  const [twitchError, setTwitchError] = useState<TwitchErrorCode | null>(null)
  async function revokeAll() {
    if (busy) return
    setBusy(true); setProblem(null); setError(''); setTwitchError(null)
    try {
      await accountRequest('/sessions/revoke-all', {})
      // 204: the server ended every session, including this one.
      onDone()
      return
    } catch (failure) {
      if (failure instanceof AccountError && failure.status === 403 && failure.code === 'recent_auth_required') setProblem('step_up')
      // Not deployed or not relayed yet (the edge answers 404 for routes it does not know).
      else if (failure instanceof AccountError && (failure.status === 404 || failure.status === 405)) setProblem('unavailable')
      else if (failure instanceof AccountError && failure.status === 401) { onSessionEnded(failure); return }
      else if (failure instanceof AccountError && (failure.status === 429 || failure.status === 403)) setError(accountErrorText(failure))
      // 503 request_unavailable and other server errors: the API answered, so
      // the connection is fine. A fetch failure or timeout never reached it.
      else setProblem(failure instanceof AccountError ? 'server' : 'network')
    }
    setBusy(false)
  }
  async function confirmWithTwitch() {
    if (twitchBusy) return
    setTwitchBusy(true); setTwitchError(null)
    // Back on this page, the record says whether Twitch chose the same account.
    try { await beginTwitchFlow({ purpose: 'signin', returnTo: TWITCH_DEFAULT_RETURN, beforeLeave: flowId => { rememberBillingStepUp(accountId, flowId, 'revoke-all') } }) }
    catch (failure) { clearBillingStepUp(); setTwitchError(twitchErrorCode(failure)); setTwitchBusy(false) }
  }
  const twitchAccount = session.status === 'signed_in' && (session.profile.twitchLinked === true || session.profile.via === 'signin')
  return <section className="pulse-account-signout-everywhere" aria-labelledby={headingId} data-testid="sign-out-everywhere">
    <div className="pulse-account-section-heading"><h2 id={headingId}>Sign out everywhere</h2></div>
    <p>Ends every website session and signs out every extension connected to this account, including this browser. Nothing is deleted: your account and Supporter membership stay, and you can sign in again.</p>
    {wrongAccount ? <div className="pulse-account-note" role="alert" data-testid="revoke-all-wrong-account">
      <p>Twitch signed you in to a different StreamPulse account than the one that asked to sign out everywhere. Nothing was signed out.</p>
      <div className="pulse-account-actions"><button type="button" className="pulse-account-primary" disabled={signOutBusy} onClick={() => onSignOut()}>Sign out</button><button type="button" className="pulse-account-text-button" disabled={signOutBusy} onClick={() => setWrongAccount(false)}>Stay with this account</button></div>
    </div>
    : confirming ? <div className="pulse-account-review" role="group" aria-label="Confirm sign out everywhere">
      {returned === 'same' && !problem ? <p role="status" data-testid="revoke-all-confirmed">Thanks, that’s confirmed. Choose Confirm sign out everywhere to continue.</p> : null}
      <h3>Sign out everywhere?</h3>
      <p>Every browser and extension signed in to this account will need to sign in again, including this one.</p>
      <div className="pulse-account-actions"><button className="pulse-account-revoke" disabled={busy} onClick={() => void revokeAll()}>{busy ? 'Signing out everywhere…' : 'Confirm sign out everywhere'}</button><button disabled={busy} onClick={() => { setConfirming(false); setProblem(null); setError(''); setTwitchError(null) }}>Cancel</button></div>
    </div>
    : <button className="pulse-account-revoke" onClick={() => { setConfirming(true); setProblem(null); setError('') }}><LogOut size={16} aria-hidden="true" /> Sign out everywhere</button>}
    {problem === 'step_up' ? session.status === 'checking'
      ? <p className="pulse-account-note" role="status">Checking your sign-in…</p>
      : twitchAccount
        ? <div className="pulse-account-note" role="alert" data-testid="revoke-all-confirm-twitch"><h3>Confirm it’s you</h3><p>For your security, signing out everywhere needs a Twitch check from the last 10 minutes. Nothing was signed out.</p><TwitchButton busy={twitchBusy} busyLabel="Opening Twitch…" onClick={() => void confirmWithTwitch()}>Continue with Twitch</TwitchButton></div>
        : <div className="pulse-account-note" role="alert" data-testid="revoke-all-sign-in-again"><p>For your security, signing out everywhere needs a sign-in from the last 10 minutes. Nothing was signed out yet.</p><p>To confirm, sign out of this browser and sign in again with your email. Then come back to Account &amp; devices and choose Sign out everywhere.</p><button type="button" className="pulse-account-primary" disabled={signOutBusy} onClick={() => onSignOut(EMAIL_SIGN_IN_AGAIN)}>{signOutBusy ? 'Signing out…' : 'Sign out and sign in again'}</button></div>
      : null}
    {twitchError ? <TwitchErrorNotice code={twitchError} purpose="signin" current="/account/settings" /> : null}
    {problem === 'unavailable' ? <p className="pulse-account-note" role="status" data-testid="revoke-all-unavailable">Sign out everywhere isn’t available yet. Nothing was signed out. You can still sign out here and revoke each extension above.</p> : null}
    {problem === 'server' ? <p role="alert" data-testid="revoke-all-failed">Sign out everywhere couldn’t be confirmed. Account services are unavailable right now. Please try again later.</p> : null}
    {problem === 'network' ? <p role="alert" data-testid="revoke-all-failed">Sign out everywhere couldn’t be confirmed. Check your connection and try again.</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </section>
}

/** The email form, open even when Continue with Twitch leads the sign-in page. */
const EMAIL_SIGN_IN_AGAIN = '/account/sign-in?method=email'

type Device = { id: string; label: string; expiresAt: string; revokedAt?: string }
export default function AccountSettings() {
  const [identity, setIdentity] = useState('')
  const [devices, setDevices] = useState<Device[]>([])
  const [cursor, setCursor] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(true)
  const [signedOut, setSignedOut] = useState(false)
  const [accountId, setAccountId] = useState('')
  const [revokeAllReturn, setRevokeAllReturn] = useState<BillingStepUpCheck>('none')
  const [signedOutEverywhere, setSignedOutEverywhere] = useState(false)
  const otherWaysId = useId()
  const twitch = twitchSignInEnabled()
  async function list(next = '') {
    const result = await accountRequest(next ? `/devices?cursor=${encodeURIComponent(next)}` : '/devices')
    if (!Array.isArray(result.devices) || result.devices.some(d => !d || typeof d.id !== 'string' || typeof d.label !== 'string' || typeof d.expiresAt !== 'string')) throw new Error('Invalid device list')
    setDevices(previous => next ? [...previous, ...result.devices as Device[]] : result.devices as Device[])
    setCursor(typeof result.nextCursor === 'string' ? result.nextCursor : '')
  }
  async function load() {
    setBusy(true); setError('')
    let hadSession = false
    try {
      const me = await accountRequest('/me')
      if (typeof me.accountId !== 'string') throw new Error('Invalid account')
      hadSession = true
      setAccountId(me.accountId)
      // Back from a Sign out everywhere "Confirm it's you" round trip.
      if (twitch) setRevokeAllReturn(takeBillingStepUp(me.accountId, 'revoke-all'))
      setIdentity(typeof me.email === 'string' ? me.email : me.accountId)
      await list()
    } catch (e) {
      const unauthorized = e instanceof AccountError && e.status === 401
      setSignedOut(unauthorized)
      // No session at first load is the ordinary signed-out visit, not an expired
      // one: no error and no Retry that could only repeat the 401. "Expired" stays
      // for a session this page had that ended.
      if (unauthorized) { setIdentity(''); setDevices([]); setCursor(''); setConfirm('') }
      if (!unauthorized || hadSession) setError(accountErrorText(e))
    }
    finally { setBusy(false) }
  }
  useEffect(() => { void load() }, [])
  async function revoke() {
    if (!confirm || busy) return
    setBusy(true); setError('')
    try { await accountRequest('/devices/revoke', { deviceId: confirm }); setConfirm(''); await list() }
    catch (e) { setError(accountErrorText(e)) }
    finally { setBusy(false) }
  }
  /** Sign out everywhere answered 204: this session is over too. */
  function signedOutEverywhereDone() {
    forgetAccountSession()
    // Other open account tabs re-check and stop acting for this account.
    announceAccountSignedOut()
    setIdentity(''); setAccountId(''); setDevices([]); setCursor(''); setConfirm(''); setError('')
    setSignedOut(true); setSignedOutEverywhere(true)
  }
  function sessionEnded(failure: unknown) {
    setIdentity(''); setAccountId(''); setDevices([]); setCursor(''); setConfirm('')
    setSignedOut(true); setError(accountErrorText(failure))
  }
  async function logout(next = '/account/sign-in') {
    if (busy) return
    setBusy(true); setError('')
    try {
      await accountRequest('/auth/logout', {})
      // Other open account tabs re-check and stop acting for this account.
      announceAccountSignedOut()
      setIdentity(''); setDevices([]); setConfirm(''); setSignedOut(true)
      // Full navigation drops prior account queries and in-flight page state.
      window.location.assign(next)
    } catch (e) { setError(accountErrorText(e)) }
    finally { setBusy(false) }
  }
  return <PublicLayout><section className="pulse-account pulse-account-settings" aria-label="Account settings">
    <p className="pulse-account-kicker"><Monitor size={16} aria-hidden="true" /> StreamPulse account</p>
    <h1>Account &amp; devices</h1>
    {identity ? <div className="pulse-account-session"><p>You’re signed in to StreamPulse.</p><button disabled={busy} onClick={() => void logout()}><LogOut size={16} aria-hidden="true" /> Sign out</button></div> : null}
    {busy ? <p role="status">Updating account...</p> : null}
    {/* Retry cannot help a 401; the sign-in below can. */}
    {error ? <div className="pulse-account-error"><p role="alert">{error}</p>{signedOut ? null : <button disabled={busy} onClick={() => void load()}>Retry</button>}</div> : null}
    {signedOutEverywhere ? <p className="pulse-account-note" role="status" data-testid="revoke-all-done">You’re signed out everywhere. Every browser and extension that was signed in to this account has to sign in again. Nothing was deleted.</p> : null}
    {signedOut ? <SignedOutSettings /> : null}
    {identity && !signedOut && twitch ? <TwitchAccountRow /> : null}
    {/* Every extension signed in to this account is listed here, whichever way it
        connected. With Continue with Twitch on, only the connection-code entry is
        the tester bridge, under its own heading below. */}
    {identity && !signedOut ? <><div className="pulse-account-section-heading"><h2>Linked extensions</h2>{twitch ? null : <Link to="/account/link-device">Link extension</Link>}</div>
      {!busy && !devices.length && !error ? <p className="pulse-account-empty">{twitch ? 'No extensions are signed in to this account.' : 'No linked extensions. Link your extension to use this account on Twitch.'}</p> : null}
      <ul className="pulse-account-devices">{devices.map(device => <li key={device.id}><div className="pulse-account-device-details"><strong>{device.label}</strong>
        <p>{device.revokedAt ? <span className="pulse-account-device-status">Revoked</span> : `Credential expires ${new Date(device.expiresAt).toLocaleDateString()}`}</p></div>
        {!device.revokedAt ? <button className="pulse-account-revoke" disabled={busy} aria-label={`Revoke ${device.label}`} onClick={() => setConfirm(device.id)}><Trash2 size={16} aria-hidden="true" /> Revoke</button> : null}
      </li>)}</ul>
      {confirm ? <div className="pulse-account-review" role="group" aria-label="Confirm device revocation"><h2>Revoke this extension?</h2><p>This extension will lose account access. Its local records are not deleted.</p><div className="pulse-account-actions"><button className="pulse-account-revoke" disabled={busy} onClick={() => void revoke()}>Confirm revocation</button><button disabled={busy} onClick={() => setConfirm('')}>Cancel</button></div></div> : null}
      {cursor ? <button disabled={busy} onClick={() => { setBusy(true); void list(cursor).catch(e => setError(accountErrorText(e))).finally(() => setBusy(false)) }}>More devices</button> : null}
    </> : null}
    {identity && !signedOut && twitch ? <section className="pulse-account-other-ways" data-testid="other-ways-to-connect" aria-labelledby={otherWaysId}>
      <div className="pulse-account-section-heading"><h2 id={otherWaysId}>Other ways to connect (testers)</h2></div>
      <p>Invited testers can still connect an extension with a connection code.</p>
      <Link to="/account/link-device">Link extension with a code</Link>
    </section> : null}
    {identity && !signedOut && twitch && accountId ? <SignOutEverywhere accountId={accountId} returned={revokeAllReturn} onDone={signedOutEverywhereDone} onSessionEnded={sessionEnded} onSignOut={next => void logout(next)} signOutBusy={busy} /> : null}
    <div className="pulse-account-explainer"><h2>Your account and this browser</h2><p>Website saves stay in this browser. They are separate from extension bookmarks and are not moved or merged when you sign in.</p>
    <p>{twitch ? 'Signing out here ends this website session. Revoke a linked extension separately, or use Sign out everywhere to end every session and extension at once.' : 'Signing out here ends this website session. Revoke a linked extension separately to stop its account access.'}</p></div>
    <AccountFooter current="settings" />
  </section></PublicLayout>
}
