import { stripePortalLoginUrl } from '../../lib/accountStripePortalLogin'
import { billingContactEmail, supporterSeller } from '../../lib/supporterOffer'

/**
 * Copy shared by /supporter, Terms and Refunds that comes from one config
 * (src/shared/supporter-offer.json) or one env (VITE_STRIPE_PORTAL_LOGIN_URL),
 * so Aron's answers drop in without code edits (Supporter launch spec
 * 2026-10-10 §4, §7).
 */

/** The billing and refund mailbox from the config (MERGE GATE memo T1-6: `billingContact.confirmed`). */
export function BillingContactLink() {
  const email = billingContactEmail()
  return <a href={`mailto:${email}`}>{email}</a>
}

/**
 * "Lost access to your Twitch account?" with Stripe's no-code portal login
 * when a valid link is configured; otherwise the billing mailbox, so the page
 * never promises a link that does not exist.
 */
export function LostTwitchAccess({ testId = 'supporter-lost-twitch' }: { testId?: string }) {
  const login = stripePortalLoginUrl()
  return login
    ? <p data-testid={testId}>
      Lost access to your Twitch account? You can still cancel or update billing in{' '}
      <a href={login} target="_blank" rel="noopener noreferrer" data-testid="supporter-stripe-portal-login">Stripe&rsquo;s customer portal</a>{' '}
      with the email you paid with. That changes billing only. Moving Supporter to another Twitch
      account goes through us: <BillingContactLink />.
    </p>
    : <p data-testid={testId}>
      Lost access to your Twitch account? Email <BillingContactLink /> from the email you paid with,
      and we&rsquo;ll cancel or update billing for you. Moving Supporter to another Twitch account
      also goes through us.
    </p>
}

/** One short line for Refunds: the portal login link, or the email sentence. */
export function LostTwitchShort({ testId }: { testId: string }) {
  const login = stripePortalLoginUrl()
  return login
    ? <p data-testid={testId}>Lost access to Twitch?{' '}
      <a href={login} target="_blank" rel="noopener noreferrer">Manage billing with your email</a>.</p>
    : <p data-testid={testId}>Lost access to Twitch? Email <BillingContactLink /> from the email you
      paid with, and we&rsquo;ll cancel or update billing for you.</p>
}

/** Selling entity, address, governing law and consumer rights; each null reads "Pending — not yet stated." */
export function SellerFacts() {
  const seller = supporterSeller()
  const rows: Array<[string, string]> = [
    ['Selling entity', seller.name],
    ['Legal address', seller.address],
    ['Governing law', seller.governingLaw],
    ['Consumer cancellation rights', seller.consumerRights],
  ]
  return <dl
    className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-[14rem_minmax(0,1fr)]"
    data-testid="terms-pending-owner-input"
  >
    {rows.map(([label, value]) => <div key={label} className="contents">
      <dt className="text-sm font-bold text-zinc-400">{label}</dt>
      <dd className="m-0 text-sm text-zinc-200 whitespace-pre-line">{value}</dd>
    </div>)}
  </dl>
}
