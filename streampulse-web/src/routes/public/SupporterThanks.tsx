import { Link, useLocation } from 'react-router-dom'
import { Puzzle } from 'lucide-react'
import { PublicLayout } from '../../ui/components/PublicLayout'
import '../account/account.css'

/** A return URL is untrusted; only the extension's server projection confirms payment. */
export default function SupporterThanks() {
  const cancelled = new URLSearchParams(useLocation().search).get('cancelled') === '1'
  return <PublicLayout><section className="pulse-account" aria-label="Supporter checkout return" data-testid="supporter-checkout-return">
    <p className="pulse-account-kicker"><Puzzle size={16} aria-hidden="true" /> Pulse Supporter</p>
    <h1>Return to your extension</h1>
    <p className="pulse-account-intro">{cancelled ? 'You returned from Checkout.' : 'Checkout returned.'} Your extension will check its status and update by itself.</p>
    <p>Open StreamPulse settings to see your membership. You can close this tab.</p>
    <p>This page does not confirm a payment or grant Supporter access.</p>
    <footer className="pulse-account-footer"><p>Your free Pulse tools stay available.</p><nav aria-label="Checkout help"><Link className="pulse-account-button pulse-account-primary" to="/support">Help &amp; support</Link><Link to="/refunds">Cancellation &amp; refunds</Link></nav></footer>
  </section></PublicLayout>
}
