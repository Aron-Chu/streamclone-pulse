import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, ShieldCheck } from 'lucide-react'
import { AccountError, restoreRequest } from '../../lib/accountApi'
import { clearAccountRestore, getAccountRestore } from '../../lib/accountRestore'
import { PublicLayout } from '../../ui/components/PublicLayout'
import './account.css'

type RestoreState = 'checking' | 'ready' | 'confirming' | 'confirmed' | 'expired' | 'conflict' | 'unavailable'
function terminalError(error: unknown): RestoreState {
  if (error instanceof AccountError && error.code === 'restore_conflict') return 'conflict'
  if (error instanceof AccountError && [400, 401, 410].includes(error.status)) return 'expired'
  return 'unavailable'
}
export default function AccountRestore() {
  const [state, setState] = useState<RestoreState>('checking')
  const [label, setLabel] = useState('')
  const [expiresAt, setExpiresAt] = useState(0)
  const [inspection, setInspection] = useState(0)
  const confirming = useRef(false)
  useEffect(() => {
    let disposed = false
    const secret = getAccountRestore()
    if (!secret) { setState('expired'); return }
    setState('checking')
    void restoreRequest('/inspect', { secret }).then(data => {
      if (disposed) return
      const expiry = typeof data.expiresAt === 'string' ? Date.parse(data.expiresAt) : NaN
      if (!Number.isFinite(expiry) || typeof data.label !== 'string' || !data.label.trim() || data.label.length > 120) throw new Error('Invalid restore response')
      if (expiry <= Date.now()) { clearAccountRestore(); setState('expired'); return }
      const safeLabel = data.label.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').trim()
      if (!safeLabel) throw new Error('Invalid restore label')
      setLabel(safeLabel)
      setExpiresAt(Math.min(expiry, Date.now() + 15 * 60_000)); setState('ready')
    }).catch(error => {
      if (disposed) return
      const next = terminalError(error)
      if (next === 'expired' || next === 'conflict') clearAccountRestore()
      setState(next)
    })
    return () => { disposed = true }
  }, [inspection])
  useEffect(() => {
    if (state !== 'ready' || !expiresAt) return
    const timer = window.setTimeout(() => { clearAccountRestore(); setState('expired') }, Math.max(0, expiresAt - Date.now()))
    return () => window.clearTimeout(timer)
  }, [expiresAt, state])
  async function confirm() {
    if (confirming.current || state !== 'ready') return
    const secret = getAccountRestore()
    if (!secret || expiresAt <= Date.now()) { clearAccountRestore(); setState('expired'); return }
    confirming.current = true; setState('confirming')
    try {
      await restoreRequest('/approve', { secret, confirmed: true })
      clearAccountRestore(); setState('confirmed')
    } catch (error) {
      const next = terminalError(error)
      if (next === 'expired' || next === 'conflict') clearAccountRestore()
      setState(next)
    } finally { confirming.current = false }
  }
  return <PublicLayout><section className="pulse-account pulse-account-restore" aria-label="Restore Supporter" data-testid="supporter-restore" data-restore-state={state}>
    <p className="pulse-account-kicker"><ShieldCheck size={16} aria-hidden="true" /> Pulse Supporter</p>
    {(state === 'checking' || state === 'confirming') && <><h1>{state === 'checking' ? 'Checking your restore link' : 'Confirming your restore'}</h1><p role="status">{state === 'checking' ? 'Checking the extension that requested this link.' : 'Keep this tab open while the restore is confirmed.'}</p></>}
    {state === 'ready' && <><h1>Restore your Supporter</h1><p className="pulse-account-intro">Only continue if you requested this link in the extension below.</p>
      <div className="pulse-account-review"><h2>Extension requesting access</h2><p className="pulse-account-installation-label">{label}</p><p>This connects that extension to your membership. It does not combine accounts or start a payment.</p></div>
      <div className="pulse-account-actions"><button className="pulse-account-primary" onClick={() => void confirm()}>Confirm restore</button></div>
      <p>If you did not request this, close this tab. No restore is approved by opening the link.</p></>}
    {state === 'confirmed' && <><p className="pulse-account-kicker"><CheckCircle2 size={18} aria-hidden="true" /> Confirmed</p><h1>Restore confirmed</h1><p className="pulse-account-intro">Return to your extension. It will check your membership and update by itself.</p><p>You can close this tab.</p></>}
    {state === 'expired' && <><h1>This restore link is unavailable</h1><p className="pulse-account-intro">It may have expired or already been used. In your extension, request a new restore link.</p></>}
    {state === 'conflict' && <><h1>These memberships cannot be combined</h1><p className="pulse-account-intro">This extension already has its own billing history. Nothing has been combined. Contact billing support for help.</p><a className="pulse-account-button pulse-account-primary" href="mailto:privacy@streampulse.stream">Contact billing support</a></>}
    {state === 'unavailable' && <><h1>Restore is unavailable right now</h1><p role="alert">We could not check this restore. Try again; do not make another payment.</p><button className="pulse-account-primary" onClick={() => setInspection(value => value + 1)}>Try again</button></>}
    <footer className="pulse-account-footer"><p>Your free Pulse tools stay available.</p><nav aria-label="Restore help"><Link to="/support">Help &amp; support</Link><Link to="/privacy">Privacy</Link></nav></footer>
  </section></PublicLayout>
}
