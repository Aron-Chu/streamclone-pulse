import { useEffect, useId, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { LogOut, Monitor, Trash2 } from 'lucide-react'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { AccountFooter } from './AccountFooter'
import { accountRequest, accountErrorText, AccountError } from '../../lib/accountApi'
import { announceAccountSignedOut } from '../../lib/accountSessionSignal'
import { knownTwitchIdentity, useAccountSession } from '../../lib/accountSession'
import { twitchSignInEnabled } from '../../lib/twitchSignInFlag'
import { beginTwitchFlow, twitchErrorCode, type TwitchErrorCode } from '../../lib/twitchSignIn'
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
  return <section className="pulse-account-twitch-row" aria-labelledby={headingId} data-testid="twitch-account-row">
    <div className="pulse-account-section-heading"><h2 id={headingId}>Twitch</h2></div>
    {known ? <div className="pulse-account-twitch-connected">
      {known.avatarUrl ? <img src={known.avatarUrl} alt="" width={32} height={32} referrerPolicy="no-referrer" /> : <span className="pulse-account-twitch-mark"><TwitchGlitch /></span>}
      <p>{name ? <>Connected as <strong>{name}</strong></> : 'Twitch is connected to this account.'}</p>
    </div> : <div className="pulse-account-twitch-link">
      <p>Link your Twitch account to sign in with Twitch. StreamPulse receives your Twitch user ID, display name and profile picture, never your Twitch password or email.</p>
      <TwitchButton busy={busy} busyLabel="Opening Twitch…" onClick={() => void link()}>Link Twitch</TwitchButton>
    </div>}
    {known && state?.twitch === 'linked' ? <p role="status">Twitch is now linked. Next time, you can use Sign in with Twitch.</p> : null}
    {error ? <TwitchErrorNotice code={error} purpose="link" current="/account/settings" /> : null}
  </section>
}

type Device = { id: string; label: string; expiresAt: string; revokedAt?: string }
export default function AccountSettings() {
  const [identity, setIdentity] = useState('')
  const [devices, setDevices] = useState<Device[]>([])
  const [cursor, setCursor] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(true)
  const [signedOut, setSignedOut] = useState(false)
  async function list(next = '') {
    const result = await accountRequest(next ? `/devices?cursor=${encodeURIComponent(next)}` : '/devices')
    if (!Array.isArray(result.devices) || result.devices.some(d => !d || typeof d.id !== 'string' || typeof d.label !== 'string' || typeof d.expiresAt !== 'string')) throw new Error('Invalid device list')
    setDevices(previous => next ? [...previous, ...result.devices as Device[]] : result.devices as Device[])
    setCursor(typeof result.nextCursor === 'string' ? result.nextCursor : '')
  }
  async function load() {
    setBusy(true); setError('')
    try {
      const me = await accountRequest('/me')
      if (typeof me.accountId !== 'string') throw new Error('Invalid account')
      setIdentity(typeof me.email === 'string' ? me.email : me.accountId)
      await list()
    } catch (e) { setError(accountErrorText(e)); setSignedOut(e instanceof AccountError && e.status === 401) }
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
  async function logout() {
    if (busy) return
    setBusy(true); setError('')
    try {
      await accountRequest('/auth/logout', {})
      // Other open account tabs re-check and stop acting for this account.
      announceAccountSignedOut()
      setIdentity(''); setDevices([]); setConfirm(''); setSignedOut(true)
      // Full navigation drops prior account queries and in-flight page state.
      window.location.assign('/account/sign-in')
    } catch (e) { setError(accountErrorText(e)) }
    finally { setBusy(false) }
  }
  return <PublicLayout><section className="pulse-account pulse-account-settings" aria-label="Account settings">
    <p className="pulse-account-kicker"><Monitor size={16} aria-hidden="true" /> StreamPulse account</p>
    <h1>Account &amp; devices</h1>
    {identity ? <div className="pulse-account-session"><p>You’re signed in to StreamPulse.</p><button disabled={busy} onClick={() => void logout()}><LogOut size={16} aria-hidden="true" /> Sign out</button></div> : null}
    {signedOut ? <Link to="/account/sign-in">Sign in to Pulse</Link> : null}
    {busy ? <p role="status">Updating account...</p> : null}
    {error ? <div className="pulse-account-error"><p role="alert">{error}</p><button disabled={busy} onClick={() => void load()}>Retry</button></div> : null}
    {identity && !signedOut && twitchSignInEnabled() ? <TwitchAccountRow /> : null}
    {identity && !signedOut ? <><div className="pulse-account-section-heading"><h2>Linked extensions</h2><Link to="/account/link-device">Link extension</Link></div>
      {!busy && !devices.length && !error ? <p className="pulse-account-empty">No linked extensions. Link your extension to use this account on Twitch.</p> : null}
      <ul className="pulse-account-devices">{devices.map(device => <li key={device.id}><div className="pulse-account-device-details"><strong>{device.label}</strong>
        <p>{device.revokedAt ? <span className="pulse-account-device-status">Revoked</span> : `Credential expires ${new Date(device.expiresAt).toLocaleDateString()}`}</p></div>
        {!device.revokedAt ? <button className="pulse-account-revoke" disabled={busy} aria-label={`Revoke ${device.label}`} onClick={() => setConfirm(device.id)}><Trash2 size={16} aria-hidden="true" /> Revoke</button> : null}
      </li>)}</ul>
      {confirm ? <div className="pulse-account-review" role="group" aria-label="Confirm device revocation"><h2>Revoke this extension?</h2><p>This extension will lose account access. Its local records are not deleted.</p><div className="pulse-account-actions"><button className="pulse-account-revoke" disabled={busy} onClick={() => void revoke()}>Confirm revocation</button><button disabled={busy} onClick={() => setConfirm('')}>Cancel</button></div></div> : null}
      {cursor ? <button disabled={busy} onClick={() => { setBusy(true); void list(cursor).catch(e => setError(accountErrorText(e))).finally(() => setBusy(false)) }}>More devices</button> : null}
    </> : null}
    <div className="pulse-account-explainer"><h2>Your account and this browser</h2><p>Website saves stay in this browser. They are separate from extension bookmarks and are not moved or merged when you sign in.</p>
    <p>Signing out here ends this website session. Revoke a linked extension separately to stop its account access.</p></div>
    <AccountFooter current="settings" />
  </section></PublicLayout>
}
