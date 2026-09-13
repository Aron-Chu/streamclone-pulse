import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { LogOut, Trash2 } from 'lucide-react'
import { PublicLayout } from '../../ui/components/PublicLayout'
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
  return <PublicLayout><section className="pulse-account" aria-label="Account settings">
    <h1>Account &amp; devices</h1>
    {identity ? <><p>Signed in as <strong>{identity}</strong></p><button disabled={busy} onClick={() => void logout()}><LogOut size={16} aria-hidden="true" /> Sign out</button></> : null}
    {signedOut ? <Link to="/account/sign-in">Sign in to Pulse</Link> : null}
    {busy ? <p role="status">Updating account...</p> : null}
    {error ? <><p role="alert">{error}</p><button disabled={busy} onClick={() => void load()}>Retry</button></> : null}
    {identity && !signedOut ? <><h2>Linked extensions</h2>
      {!busy && !devices.length && !error ? <p>No linked extensions.</p> : null}
      <ul>{devices.map(device => <li key={device.id}><strong>{device.label}</strong>
        <p>{device.revokedAt ? 'Revoked' : `Credential expires ${new Date(device.expiresAt).toLocaleDateString()}`}</p>
        {!device.revokedAt ? <button disabled={busy} aria-label={`Revoke ${device.label}`} onClick={() => setConfirm(device.id)}><Trash2 size={16} aria-hidden="true" /> Revoke</button> : null}
      </li>)}</ul>
      {confirm ? <div role="group" aria-label="Confirm device revocation"><p>This extension will lose account access. Its local records are not deleted.</p><button disabled={busy} onClick={() => void revoke()}>Confirm revocation</button><button disabled={busy} onClick={() => setConfirm('')}>Cancel</button></div> : null}
      {cursor ? <button disabled={busy} onClick={() => { setBusy(true); void list(cursor).catch(e => setError(accountErrorText(e))).finally(() => setBusy(false)) }}>More devices</button> : null}
    </> : null}
    <p>Website saves stay in this browser. They are separate from extension bookmarks and are not moved or merged when you sign in.</p>
    <p>Signing out here ends this website session. Revoke a linked extension separately to stop its account access.</p>
    <p><Link to="/account/link-device">Link extension</Link> · <Link to="/account/billing">Membership &amp; billing</Link></p>
  </section></PublicLayout>
}
