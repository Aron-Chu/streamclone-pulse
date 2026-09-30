import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { LogOut, Monitor, Trash2 } from 'lucide-react'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { AccountFooter } from './AccountFooter'
import { accountRequest, accountErrorText, AccountError } from '../../lib/accountApi'
import './account.css'

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
