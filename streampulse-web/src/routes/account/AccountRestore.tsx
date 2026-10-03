import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, ShieldCheck } from 'lucide-react'
import { AccountError, restoreRequest } from '../../lib/accountApi'
import { clearAccountRestore, getAccountRestore } from '../../lib/accountRestore'
import { PublicLayout } from '../../ui/components/PublicLayout'
import './account.css'

type RestoreState = 'checking' | 'ready' | 'confirming' | 'confirmed' | 'expired' | 'conflict' | 'unavailable' | 'uncertain'
function terminalError(error: unknown): RestoreState {
  if (error instanceof AccountError && error.code === 'restore_conflict') return 'conflict'
  if (error instanceof AccountError && [400, 401, 410].includes(error.status)) return 'expired'
  return 'unavailable'
}
export default function AccountRestore() {
  const [state, setState] = useState<RestoreState>('checking')
  const [label, setLabel] = useState('')
  const [comparisonCode, setComparisonCode] = useState('')
  const [compared, setCompared] = useState(false)
  const [expiresAt, setExpiresAt] = useState(0)
  const [inspection, setInspection] = useState(0)
  const [retrySeconds, setRetrySeconds] = useState(0)
  const confirming = useRef(false)
  useEffect(() => {
    let disposed = false
    const secret = getAccountRestore()
    if (!secret) { setState('expired'); return }
    setState('checking'); setCompared(false)
    void restoreRequest('/inspect', { secret }).then(data => {
      if (disposed) return
      const expiry = typeof data.expiresAt === 'string' ? Date.parse(data.expiresAt) : NaN
      if (!Number.isFinite(expiry) || data.label !== 'Chrome extension' || typeof data.comparisonCode !== 'string' || !/^[A-F0-9]{6}$/.test(data.comparisonCode)) throw new Error('Invalid restore response')
      if (expiry <= Date.now()) { clearAccountRestore(); setState('expired'); return }
      const safeLabel = data.label.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').trim()
      if (!safeLabel) throw new Error('Invalid restore label')
      setLabel(safeLabel)
      setComparisonCode(data.comparisonCode)
      setExpiresAt(Math.min(expiry, Date.now() + 15 * 60_000)); setState('ready')
    }).catch(error => {
      if (disposed) return
      const next = terminalError(error)
      setRetrySeconds(error instanceof AccountError && error.status === 429 ? error.retryAfterSeconds ?? 60 : 0)
      if (next === 'expired' || next === 'conflict') clearAccountRestore()
      setState(next)
    })
    return () => { disposed = true }
  }, [inspection])
  useEffect(() => {
    if (retrySeconds <= 0) return
    const timer = window.setTimeout(() => setRetrySeconds(value => Math.max(0, value - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [retrySeconds])
  useEffect(() => {
    if (state !== 'ready' || !expiresAt) return
    const timer = window.setTimeout(() => { clearAccountRestore(); setState('expired') }, Math.max(0, expiresAt - Date.now()))
    return () => window.clearTimeout(timer)
  }, [expiresAt, state])
  async function confirm() {
    if (confirming.current || state !== 'ready' || !compared) return
    const secret = getAccountRestore()
    if (!secret || expiresAt <= Date.now()) { clearAccountRestore(); setState('expired'); return }
    confirming.current = true; setState('confirming')
    try {
      await restoreRequest('/approve', { secret, comparisonCode, confirmed: true })
      clearAccountRestore(); setState('confirmed')
    } catch (error) {
      // A missing response cannot tell us whether the one-time approval ran.
      // Do not retry the mutation or tell the user their link is expired.
      const terminal = terminalError(error)
      const next = terminal === 'unavailable' ? 'uncertain' : terminal
      clearAccountRestore()
      setState(next)
    } finally { confirming.current = false }
  }
  return <PublicLayout><section className="pulse-account pulse-account-restore" aria-label="Restore Supporter" data-testid="supporter-restore" data-restore-state={state}>
    <p className="pulse-account-kicker"><ShieldCheck size={16} aria-hidden="true" /> Pulse Supporter</p>
    {(state === 'checking' || state === 'confirming') && <><h1>{state === 'checking' ? 'Checking your restore link' : 'Confirming your restore'}</h1><p role="status">{state === 'checking' ? 'Checking the extension that requested this link.' : 'Keep this tab open while the restore is confirmed.'}</p></>}
    {state === 'ready' && <><h1>Restore your Supporter</h1><p className="pulse-account-intro">Only continue if you requested this link in the extension below.</p>
      <div className="pulse-account-review"><h2>Extension requesting access</h2><p className="pulse-account-installation-label">{label}</p><p>Comparison code: <strong className="pulse-account-comparison-code">{comparisonCode}</strong></p><p>Compare this code with the code shown in the extension where you requested restore. If it differs or no code is shown, close this tab.</p><p>This connects that extension to your membership. It does not combine accounts or start a payment.</p></div>
      <label className="pulse-account-compare"><input type="checkbox" checked={compared} onChange={event => setCompared(event.target.checked)} />This code matches the extension where I requested restore.</label>
      <div className="pulse-account-actions"><button className="pulse-account-primary" disabled={!compared} onClick={() => void confirm()}>Confirm restore</button></div>
      <p>If you did not request this, close this tab. No restore is approved by opening the link.</p></>}
    {state === 'confirmed' && <><p className="pulse-account-kicker"><CheckCircle2 size={18} aria-hidden="true" /> Confirmed</p><h1>Restore confirmed</h1><p className="pulse-account-intro">Return to your extension. It will check your membership and update by itself.</p><p>You can close this tab.</p></>}
    {state === 'expired' && <><h1>This restore link is unavailable</h1><p className="pulse-account-intro">It may have expired or already been used. Check your extension first. If it is not connected, request a new restore link there.</p></>}
    {state === 'conflict' && <><h1>These memberships cannot be combined</h1><p className="pulse-account-intro">This extension cannot safely switch memberships. Nothing has been combined. Contact billing support for help.</p><a className="pulse-account-button pulse-account-primary" href="mailto:privacy@streampulse.stream">Contact billing support</a></>}
    {state === 'uncertain' && <><h1>Check your extension for the result</h1><p role="status">Your confirmation may have completed, but this page did not receive the result. Return to the extension and let it check. Do not make another payment.</p></>}
    {state === 'unavailable' && <><h1>Restore is unavailable right now</h1><p role="alert">We could not check this restore. Try again; do not make another payment.</p>{retrySeconds > 0 && <p role="status">Wait {retrySeconds} seconds before checking again.</p>}<button className="pulse-account-primary" disabled={retrySeconds > 0} onClick={() => setInspection(value => value + 1)}>Try again</button></>}
    <footer className="pulse-account-footer"><p>Your free Pulse tools stay available.</p><nav aria-label="Restore help"><Link className={['confirmed', 'expired', 'uncertain'].includes(state) ? 'pulse-account-button pulse-account-primary' : undefined} to="/support">Help &amp; support</Link><Link to="/privacy">Privacy</Link></nav></footer>
  </section></PublicLayout>
}
