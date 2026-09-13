import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { AccountError, billingRequest } from '../../lib/accountApi'
import './account.css'

export function stripeDestination(value: unknown, kind: 'checkout' | 'portal'): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === (kind === 'checkout' ? 'checkout.stripe.com' : 'billing.stripe.com') && !url.username && !url.password && !url.port ? url.href : null
  } catch { return null }
}

export default function BillingPage() {
  const location = useLocation()
  const [snapshot, setSnapshot] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState('')
  const [signIn, setSignIn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [attemptState, setAttemptState] = useState('')
  const refresh = useCallback(async () => {
    setBusy(true); setError(''); setSnapshot(null)
    try {
      const attempt = new URLSearchParams(location.search).get('attempt')
      if (location.pathname.endsWith('/return') && attempt) {
        if (!/^[a-f0-9-]{36}$/.test(attempt)) throw new Error('Invalid attempt')
        const result = await billingRequest(`/checkout/${attempt}`)
        setAttemptState(typeof result.state === 'string' ? result.state : '')
      }
      const result = await billingRequest('/supporter')
      if (result.schemaVersion !== 1 || !['none', 'active', 'grace', 'pending', 'expired', 'review'].includes(String(result.status))) throw new Error('Invalid membership')
      setSnapshot(result); setSignIn(false)
    } catch (error) {
      setSignIn(error instanceof AccountError && error.status === 401)
      setError(error instanceof AccountError && error.status === 401 ? 'Sign in to view your membership.' : 'Billing is unavailable right now. No purchase has been started.')
    } finally { setBusy(false) }
  }, [location.pathname, location.search])
  useEffect(() => { void refresh() }, [refresh])
  async function open(kind: 'checkout' | 'portal') {
    if (busy) return
    setBusy(true); setError('')
    try {
      const result = await billingRequest(kind === 'checkout' ? '/checkout' : '/portal', {})
      const destination = stripeDestination(result.url, kind)
      if (!destination) throw new Error('Invalid destination')
      window.location.assign(destination)
    } catch (error) {
      setError(error instanceof AccountError && error.code === 'subscription_exists' ? 'You already have a subscription. Use Manage membership to make changes.'
        : error instanceof AccountError && error.code === 'checkout_pending' ? 'A checkout is awaiting confirmation. Refresh status before trying again.'
        : error instanceof AccountError && error.code === 'checkout_expired' ? 'The previous checkout expired without a purchase. You can start a new checkout.'
        : error instanceof AccountError && error.code === 'checkout_disabled' ? 'New purchases are paused. Existing members can still manage billing.'
        : error instanceof AccountError && error.status === 401 ? 'Sign in again before changing your membership.'
        : 'Billing could not open. Refresh status before trying again.')
      setBusy(false)
    }
  }
  const status = String(snapshot?.status ?? '')
  const labels: Record<string, string> = { none: 'No subscription', active: 'Supporter active', grace: 'Payment needs attention', pending: 'Payment pending', expired: 'Supporter ended', review: 'Membership needs review' }
  return <PublicLayout><section className="pulse-account" aria-label="Supporter billing">
    <p className="pulse-account-kicker">StreamPulse account</p><h1>Supporter membership</h1>
    <div role="status">{busy ? <p>Checking billing...</p> : null}{error ? <p>{error}</p> : null}</div>
    {signIn ? <Link to="/account/sign-in">Sign in to Pulse</Link> : null}
    {snapshot ? <>
      <h2>{labels[status]}</h2>
      {typeof snapshot.accessUntil === 'string' && Number.isFinite(Date.parse(snapshot.accessUntil)) && ['active', 'grace'].includes(status) ? <p>Access through {new Date(snapshot.accessUntil).toLocaleDateString()}.</p> : null}
      {attemptState && attemptState !== 'active' ? <p>Checkout status: {attemptState}. Access updates after payment confirmation.</p> : null}
      {['none', 'expired'].includes(status) ? <><p>$4.99 per month, renewing automatically until cancellation. Taxes, if any, are shown at checkout.</p><p>Includes the Pulse banner, three finishes, and private support recognition.</p><button disabled={busy} onClick={() => void open('checkout')}>Continue to Stripe checkout</button></> : null}
      <button disabled={busy} onClick={() => void open('portal')}>Manage membership</button>
      <p>Manage payment details, invoices, and cancellation through Stripe. Cancellation keeps access through the paid period.</p>
    </> : null}
    <button disabled={busy} onClick={() => void refresh()}>Refresh status</button>
    <p><Link to="/account/link-device">Link your extension</Link></p>
    <p><Link to="/account/settings">Account &amp; devices</Link></p>
    <p><Link to="/terms">Supporter terms</Link> · <Link to="/refunds">Cancellation and refunds</Link> · <Link to="/support">Support</Link></p>
  </section></PublicLayout>
}
