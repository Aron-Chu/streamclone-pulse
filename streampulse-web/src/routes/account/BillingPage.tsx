import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { AccountError, billingRequest } from '../../lib/accountApi'
import { accountBillingReturnPath, accountBillingSignInHref } from '../../lib/accountBillingReturn'
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
  const [checkoutCancelled, setCheckoutCancelled] = useState(false)
  const requestID = useRef(0)
  const signInHref = accountBillingSignInHref(accountBillingReturnPath(location.pathname + location.search) ?? '/account/billing')
  const refresh = useCallback(async () => {
    const request = ++requestID.current
    setBusy(true); setError(''); setSnapshot(null); setAttemptState(''); setCheckoutCancelled(false); setSignIn(false)
    try {
      let checkoutState = ''
      let checkoutError = ''
      if (location.pathname.endsWith('/return')) {
        const returnPath = accountBillingReturnPath(location.pathname + location.search)
        if (!returnPath) {
          checkoutError = 'This checkout link is invalid. Your current membership is shown below.'
        } else {
          setCheckoutCancelled(new URLSearchParams(returnPath.slice(returnPath.indexOf('?'))).get('cancelled') === '1')
          const attempt = new URLSearchParams(location.search).get('attempt')
          if (attempt) {
            try {
              const result = await billingRequest(`/checkout/${attempt}`)
              checkoutState = typeof result.state === 'string' ? result.state : ''
            } catch (error) {
              if (!(error instanceof AccountError && error.status === 404)) throw error
              checkoutError = 'This checkout link is no longer available. Your current membership is shown below.'
            }
          }
        }
      }
      if (request !== requestID.current) return
      const result = await billingRequest('/supporter')
      if (request !== requestID.current) return
      if (result.schemaVersion !== 1 || !['none', 'active', 'grace', 'pending', 'expired', 'review'].includes(String(result.status))) throw new Error('Invalid membership')
      setSnapshot(result); setSignIn(false); setAttemptState(checkoutState); setError(checkoutError)
    } catch (error) {
      if (request !== requestID.current) return
      setSignIn(error instanceof AccountError && error.status === 401)
      setError(error instanceof AccountError && error.status === 401 ? 'Sign in to view your membership.' : 'Billing status is unavailable right now. Refresh status before trying another checkout.')
    } finally { if (request === requestID.current) setBusy(false) }
  }, [location.pathname, location.search])
  useEffect(() => {
    void refresh()
    return () => { requestID.current++ }
  }, [refresh])
  async function open(kind: 'checkout' | 'portal') {
    if (busy) return
    const request = ++requestID.current
    setBusy(true); setError('')
    try {
      const result = await billingRequest(kind === 'checkout' ? '/checkout' : '/portal', {})
      if (request !== requestID.current) return
      const destination = stripeDestination(result.url, kind)
      if (!destination) throw new Error('Invalid destination')
      window.location.assign(destination)
    } catch (error) {
      if (request !== requestID.current) return
      if (error instanceof AccountError && error.status === 401) {
        setSnapshot(null)
        setSignIn(true)
      }
      setError(error instanceof AccountError && error.code === 'subscription_exists' ? 'You already have a subscription. Use Manage membership to make changes.'
        : error instanceof AccountError && error.code === 'checkout_pending' ? 'A checkout is awaiting confirmation. Refresh status before trying again.'
        : error instanceof AccountError && error.code === 'checkout_expired' ? 'The previous checkout expired without a purchase. You can start a new checkout.'
        : error instanceof AccountError && error.code === 'checkout_disabled' ? 'Checkout is not open right now. Refresh status to see your current membership.'
        : error instanceof AccountError && error.status === 401 ? 'Sign in again before changing your membership.'
        : 'Billing could not open. Refresh status before trying again.')
      setBusy(false)
    }
  }
  const status = String(snapshot?.status ?? '')
  // Checkout is opt-in on the server. Older responses and disabled deployments
  // must never expose a purchase control that will only fail after a click.
  const checkoutEnabled = snapshot?.checkoutEnabled === true
  // The billing snapshot names the Stripe environment the server is configured
  // for. Only an explicit "sandbox" proves test mode; a missing or unknown value
  // shows no banner, because the page cannot tell which environment it is.
  const sandbox = snapshot?.environment === 'sandbox'
  const labels: Record<string, string> = { none: 'No subscription', active: 'Supporter active', grace: 'Payment needs attention', pending: 'Payment pending', expired: 'Supporter ended', review: 'Membership needs review' }
  return <PublicLayout><section className="pulse-account" aria-label="Supporter billing">
    <p className="pulse-account-kicker">StreamPulse account</p><h1>Supporter membership</h1>
    {sandbox ? <p className="pulse-account-sandbox" role="note" data-testid="billing-sandbox-banner"><strong>Sandbox — test mode, no real charge.</strong> This page is connected to Stripe’s test environment. No real card is charged and no real membership is created.</p> : null}
    <div role="status">{busy ? <p>Checking billing...</p> : null}{error ? <p>{error}</p> : null}</div>
    {signIn ? <Link to={signInHref}>Sign in to Pulse</Link> : null}
    {snapshot ? <>
      <h2>{labels[status]}</h2>
      {typeof snapshot.accessUntil === 'string' && Number.isFinite(Date.parse(snapshot.accessUntil)) && ['active', 'grace'].includes(status) ? <p>Access through {new Date(snapshot.accessUntil).toLocaleDateString()}.</p> : null}
      {status === 'grace' ? <p>Your last renewal payment did not go through. Supporter stays active for a 7-day grace period from the end of the paid period while the payment is retried. Update your payment method in Manage membership.</p> : null}
      {status === 'review' ? <p>Supporter access is suspended while this payment is under review, for example during an open dispute.</p> : null}
      {checkoutCancelled
        ? <p>You left Stripe checkout before it confirmed a payment. Your current membership is shown below.</p>
        : attemptState === 'pending'
          ? <p>Payment confirmation is pending. Access updates after payment confirmation.</p>
          : attemptState === 'expired'
            ? <p>This checkout expired without a confirmed payment. Your current membership is shown below.</p>
            : null}
      {['none', 'expired'].includes(status) ? checkoutEnabled
        ? <><p>US$4.99 per month, charged in US dollars, renewing automatically until you cancel. Taxes are handled as stated at checkout.</p><p>Includes a private Pulse header accent, three private finishes, and private support recognition.</p><button type="button" disabled={busy} onClick={() => void open('checkout')}>Continue to Stripe checkout</button></>
        : <p>New Supporter sign-ups are not open yet.</p>
        : null}
      {status !== 'none' ? <><button type="button" disabled={busy} onClick={() => void open('portal')}>Manage membership</button>
      <p>Manage payment details, invoices and cancellation in the Stripe Customer Portal. Cancellation takes effect at the end of the paid period, and access continues until then.</p></> : null}
    </> : null}
    <button type="button" disabled={busy} onClick={() => void refresh()}>Refresh status</button>
    <p><Link to="/account/link-device">Link your extension</Link></p>
    <p><Link to="/account/settings">Account &amp; devices</Link></p>
    <p><Link to="/terms">Supporter terms</Link> · <Link to="/refunds">Cancellation and refunds</Link> · <Link to="/support">Support</Link></p>
  </section></PublicLayout>
}
