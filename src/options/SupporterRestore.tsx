import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { BackgroundResponse } from '../shared/messages.ts'
import type { SupporterRestoreState } from '../shared/supporterAccount.ts'
import { POLICY_LINKS } from '../shared/portalLinks.ts'

type View = SupporterRestoreState | { state: 'loading' | 'finished' }
type Action = 'status' | 'start' | 'check' | 'cancel'

/** Email is held only in this screen; the worker owns the private restore wait. */
export function SupporterRestore({ onClose, onRestored, onCheckMembership }: { onClose: () => void; onRestored: () => void; onCheckMembership: () => void }) {
  const [view, setView] = useState<View>({ state: 'loading' })
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const mounted = useRef(false)
  const hadWaitingRequest = useRef(false)
  const restored = useRef(onRestored)
  restored.current = onRestored

  const request = useCallback(async (action: Action, address?: string) => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    try {
      const response: BackgroundResponse = await chrome.runtime.sendMessage({ type: 'SUPPORTER_RESTORE', action, ...(address ? { email: address } : {}) })
      if (!mounted.current) return
      if (!response || !('type' in response) || response.type !== 'SUPPORTER_RESTORE') throw new Error('restore unavailable')
      if (response.restore.state === 'restored') { restored.current(); return }
      if (action === 'cancel') hadWaitingRequest.current = false
      else if (response.restore.state === 'idle' && hadWaitingRequest.current) { setView({ state: 'finished' }); return }
      else if (response.restore.state === 'pending' || response.restore.state === 'uncertain') hadWaitingRequest.current = true
      setView(response.restore)
    } catch {
      if (action === 'start') hadWaitingRequest.current = true
      if (mounted.current) setView(action === 'start' ? { state: 'uncertain' } : { state: 'unavailable' })
    } finally {
      inFlight.current = false
      if (mounted.current) setBusy(false)
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    void request('status')
    return () => { mounted.current = false }
  }, [request])
  useEffect(() => {
    if (view.state !== 'pending' || busy) return
    const timer = window.setTimeout(() => void request('status'), 5_000)
    return () => window.clearTimeout(timer)
  }, [view, busy, request])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const address = email.trim()
    setEmail('')
    await request('start', address)
  }
  async function leave() {
    if (inFlight.current) return
    setEmail('')
    await request('cancel')
    onClose()
  }

  return <div className="pulse-journey-restore" data-restore-state={view.state}>
    {view.state === 'loading' ? <p role="status">Checking for an existing restore request…</p> : null}
    {view.state === 'idle' ? <form onSubmit={event => void submit(event)}>
      <p>Enter your current Stripe billing email. If you changed it recently, you may need to wait before trying again. Contact support if you cannot access it. This will not start a payment.</p>
      <label htmlFor="supporter-restore-email">Stripe billing email</label>
      <input id="supporter-restore-email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} disabled={busy} />
      <div className="pulse-account-link-actions pulse-journey-actions"><button className="pulse-journey-primary" type="submit" disabled={busy}>{busy ? 'Preparing…' : 'Send restore link'}</button></div>
    </form> : null}
    {view.state === 'pending' ? <div className="pulse-restore-wait" role="status" aria-live="polite">
      <p>If that email matches a recoverable membership, a link may arrive. Check your inbox and spam folder.</p>
      <p>Compare this code with the one on the page opened from the email. Only approve it if the codes match:</p>
      <p className="pulse-account-link-code">{view.comparisonCode}</p>
      <p>This extension checks for approval automatically. The link expires at {new Date(view.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.</p>
    </div> : null}
    {view.state === 'uncertain' ? <p role="status">The request may have sent an email. Check this request before asking for another link.</p> : null}
    {view.state === 'finished' ? <p role="status">This request is no longer waiting. Check the current Supporter status before trying again.</p> : null}
    {view.state === 'expired' ? <p role="status">This restore request expired or the billing email changed. Enter your current Stripe billing email, or contact support if no email arrived.</p> : null}
    {view.state === 'conflict' || view.state === 'ineligible' ? <p role="status">This connection cannot restore another membership. Contact support for help; accounts with payment history are not combined.</p> : null}
    {view.state === 'fallback' ? <p role="status">Supporter recovery is not available on the server yet. Your free tools still work.</p> : null}
    {view.state === 'error' ? <p role="status">The restore request could not be prepared. Enter your current Stripe billing email again, or contact support.</p> : null}
    {view.state === 'unavailable' ? <p role="status">The restore service could not be checked. Try checking again, or contact support.</p> : null}
    <div className="pulse-account-link-actions pulse-journey-actions">
      {view.state === 'pending' || view.state === 'uncertain' ? <button type="button" disabled={busy} onClick={() => void request('check')}>{view.state === 'pending' ? 'Check restore status' : 'Check restore request'}</button> : null}
      {view.state === 'finished' ? <button type="button" disabled={busy} onClick={onCheckMembership}>Check Supporter status</button> : null}
      {view.state === 'unavailable' ? <button type="button" disabled={busy} onClick={() => void request('status')}>Check again</button> : null}
      {view.state === 'expired' || view.state === 'error' ? <button type="button" disabled={busy} onClick={() => void request('cancel')}>Enter email again</button> : null}
      <button type="button" disabled={busy} onClick={() => void leave()}>Back</button>
      {view.state !== 'idle' && view.state !== 'loading' ? <a href={POLICY_LINKS.support} target="_blank" rel="noopener noreferrer">Contact support</a> : null}
    </div>
    {view.state === 'pending' || view.state === 'uncertain' ? <p className="pulse-supporter-detail">Going back stops checking this request; the email may still arrive.</p> : null}
  </div>
}
