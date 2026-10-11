import { Link, useLocation } from 'react-router-dom'
import { Puzzle } from 'lucide-react'
import { PublicLayout } from '../../ui/components/PublicLayout'
import '../account/account.css'

/**
 * The extension's Checkout return. A return URL is untrusted; only the
 * extension's server projection confirms payment, so this page never says a
 * payment went through (payment audit F22, Supporter launch spec 2026-10-10 §3.4).
 */
export default function SupporterThanks() {
  const cancelled = new URLSearchParams(useLocation().search).get('cancelled') === '1'
  return <PublicLayout><section className="pulse-account" aria-label="Supporter checkout return" data-testid="supporter-checkout-return">
    <p className="pulse-account-kicker"><Puzzle size={16} aria-hidden="true" /> Pulse Supporter</p>
    <h1>Return to your extension</h1>
    {/* Conditional on purpose: this address is untrusted, so the page cannot know
        that checkout really ended without a payment. */}
    {cancelled
      ? <p className="pulse-account-intro" data-testid="supporter-thanks-copy">If you left checkout before paying, nothing was charged. You can start again from StreamPulse settings.</p>
      : <>
        <p className="pulse-account-intro" data-testid="supporter-thanks-copy">Thanks for supporting Pulse. Switch back to your StreamPulse settings: Supporter turns on there by itself once Stripe confirms, usually within a few seconds.</p>
        <p>You can close this tab.</p>
      </>}
    <p className="pulse-account-meta">This page does not confirm a payment or grant Supporter access; your extension checks with StreamPulse.</p>
    <footer className="pulse-account-footer"><p>Your free Pulse tools stay available.</p><nav aria-label="Checkout help"><Link className="pulse-account-button pulse-account-primary" to="/support">Help &amp; support</Link><a href="https://www.twitch.tv/" rel="noopener noreferrer">Back to Twitch</a><Link to="/refunds">Cancellation &amp; refunds</Link></nav></footer>
  </section></PublicLayout>
}
