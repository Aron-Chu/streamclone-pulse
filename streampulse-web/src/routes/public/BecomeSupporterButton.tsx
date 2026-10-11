import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ACCOUNT_BILLING_SUBSCRIBE_PATH } from '../../lib/accountBillingReturn'
import { hasAccountSessionHint } from '../../lib/accountSession'
import { captureAccountIssue } from '../../lib/sentry'
import { beginTwitchFlow, twitchErrorCode, twitchErrorCopy } from '../../lib/twitchSignIn'
import { useSupporterOffer } from '../../lib/supporterOffer'

/**
 * "Become a Supporter" (Supporter launch spec 2026-10-10 §3.1, mockup 01).
 *
 * Rendered only while the sales switch is open, so no closed page has a button
 * that leads to Checkout. Signed out, one click goes straight to Twitch and the
 * flow remembers the one intent (`/account/billing?intent=subscribe`); signed
 * in, it goes to that review. Stripe never opens from here: the review's
 * Continue to payment is the deliberate confirmation.
 */
export function BecomeSupporterButton({ className = 'btn btn-primary', testId = 'supporter-become' }: { className?: string; testId?: string }) {
  const offer = useSupporterOffer()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (offer.state !== 'open') return null

  async function become() {
    if (busy) return
    setError(null)
    if (hasAccountSessionHint()) {
      navigate(ACCOUNT_BILLING_SUBSCRIBE_PATH)
      return
    }
    setBusy(true)
    // On success the page leaves for Twitch, so the button stays busy.
    try { await beginTwitchFlow({ purpose: 'signin', returnTo: ACCOUNT_BILLING_SUBSCRIBE_PATH }) }
    catch (failure) {
      const copy = twitchErrorCopy(twitchErrorCode(failure), 'signin')
      setError(`${copy.title}. ${copy.body}`.replace(/\.\./g, '.'))
      setBusy(false)
      captureAccountIssue('twitch_flow_failed')
    }
  }

  return <>
    <button type="button" className={className} data-testid={testId} disabled={busy} onClick={() => void become()}>
      {busy ? 'Opening Twitch…' : 'Become a Supporter'}
    </button>
    {error ? <span role="alert" className="block w-full text-sm text-amber-200" data-testid={`${testId}-error`}>{error}</span> : null}
  </>
}
