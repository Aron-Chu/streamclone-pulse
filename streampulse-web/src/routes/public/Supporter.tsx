import { Link } from 'react-router-dom'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { PRIVACY_PATH, REFUNDS_PATH, STRIPE_CUSTOMER_PORTAL_LOGIN_URL, SUPPORTER_TERMS_PATH } from '../../lib/externalLinks'
import { PrelaunchNotice } from './PrelaunchNotice'
import { CHROME_WEB_STORE_LISTING_URL } from '../../lib/publicSiteConfig'
import { SupporterPerkItems, supporterOnlyYou } from '../../ui/components/SupporterPerks'
import { SupporterNoTwitchChatBadge, SupporterSeenInChat } from '../../ui/components/SupporterChatBadgeCopy'
import { supporterChatBadgesEnabled } from '../../lib/supporterChatBadgesFlag'

/**
 * Public Supporter offer. One honest monthly price, stated once.
 *
 * This is the destination the extension's Supporter card links to, and the page
 * whose terms that card summarizes — so the two must agree on price, cadence and
 * cancellation. Checkout availability remains server-controlled on the
 * extension; this public page must not guess deployment state.
 *
 * A browser connection in the extension precedes a separate, server-gated
 * purchase. No website-account or email-restore choice is offered here.
 * The benefit list is the one perk list in src/shared/supporter-perks.json
 * (owner decision 2026-10-09, Terms option a): every perk the extension gives,
 * identical to the Terms and the extension.
 *
 * USD only at launch: Checkout charges in US dollars, so the price says so. Tax
 * wording stays general until Checkout calculates tax itself.
 */
const PRICE_DISPLAY = 'US$4.99 per month, charged in US dollars'

export default function Supporter() {
  return (
    <PublicLayout>
      <article className="panel public-document" data-testid="supporter-offer">
        <p className="muted public-document__back">
          <Link to="/" className="text-zinc-400 hover:text-white inline-flex items-center gap-1">← StreamPulse Home</Link>
        </p>
        <header className="mb-6 border-b border-white/[0.08] pb-6">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="inline-flex items-center gap-1.5 rounded bg-violet-500/10 px-2.5 py-1 text-xs font-bold text-violet-300">
              <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
              Optional membership
            </span>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-white lg:text-4xl">Pulse Supporter</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Supporter funds StreamPulse development and adds a few original cosmetics. Every
            analytics feature on this site stays free.
          </p>
        </header>

        <PrelaunchNotice />

        <section className="mt-8 rounded-xl border border-violet-500/25 bg-violet-500/[0.06] p-6" data-testid="supporter-terms">
          <h2 className="!mt-0">The offer, once sign-ups open</h2>
          <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <dt className="text-sm font-bold text-zinc-400">Price</dt>
            <dd className="m-0 text-sm font-bold text-white">{PRICE_DISPLAY}</dd>
            <dt className="text-sm font-bold text-zinc-400">Renews</dt>
            <dd className="m-0 text-sm text-zinc-200">Monthly, automatically, until you cancel</dd>
            <dt className="text-sm font-bold text-zinc-400">Cancel</dt>
            <dd className="m-0 text-sm text-zinc-200">
              Any time, in the Stripe Customer Portal. Cancellation takes effect at the end of the
              period you already paid for, and access continues until then.
            </dd>
            <dt className="text-sm font-bold text-zinc-400">Failed payment</dt>
            <dd className="m-0 text-sm text-zinc-200">
              A 7-day grace period while the payment is retried, then Supporter access lapses.
            </dd>
            <dt className="text-sm font-bold text-zinc-400">Refunds</dt>
            <dd className="m-0 text-sm text-zinc-200">
              A full refund ends access for that period; a partial refund keeps it.
            </dd>
            <dt className="text-sm font-bold text-zinc-400">Taxes</dt>
            <dd className="m-0 text-sm text-zinc-200">
              Handled as stated at checkout. Stripe checkout shows the total before you pay.
            </dd>
            <dt className="text-sm font-bold text-zinc-400">Payment</dt>
            <dd className="m-0 text-sm text-zinc-200">
              Handled by Stripe. StreamPulse never sees or stores your card number.
            </dd>
          </dl>
        </section>

        <h2>What Supporter includes</h2>
        <ul data-testid="supporter-perks">
          <SupporterPerkItems />
        </ul>
        <p>{supporterOnlyYou()} Nothing else is promised.</p>
        {supporterChatBadgesEnabled() ? <SupporterSeenInChat /> : null}

        <h2>What it does not include</h2>
        {/* Seen in chat copy only once VITE_SUPPORTER_CHAT_BADGES is on (launch day). */}
        {supporterChatBadgesEnabled() ? <SupporterNoTwitchChatBadge /> : (
          <p>
            <strong>No public Twitch chat badge.</strong> A chat badge is not included in Supporter and
            is not part of what you would be buying.
          </p>
        )}
        <p>
          Supporter does not unlock analytics, change coverage, raise rate limits, or affect what the
          extension can see on Twitch. It buys cosmetics and funds the work.
        </p>

        <h2>What stays free</h2>
        <p>
          The browser extension, Pulse overlays, coverage and backfill status, the public analytics
          hub, channel and session analytics, and accent themes. None of these are behind Supporter.
        </p>

        <h2 id="subscribe">How to subscribe</h2>
        <div className="rounded-xl border border-white/[0.08] bg-black/20 p-6" data-testid="supporter-availability">
          <p className="!mt-0">
            <strong>Supporter sign-ups are not open yet.</strong> Once available, choose{' '}
            <strong>Connect this extension</strong> in the extension&rsquo;s{' '}
            <strong>Account &amp; Supporter</strong> page. This starts no payment.
          </p>
          <p className="mb-0 flex flex-wrap gap-3">
            <a className="btn btn-primary" href={CHROME_WEB_STORE_LISTING_URL} target="_blank" rel="noopener noreferrer">Get the extension</a>
          </p>
          <p className="mb-0">
            If <strong>Become a Supporter</strong> is offered, choose it to pay on Stripe. No Twitch
            sign-in or separate StreamPulse sign-up is needed. Stripe asks for a billing email.
          </p>
        </div>

        <h2>Managing a membership</h2>
        <p>
          Once sign-ups open, choose <strong>Manage subscription</strong> in the extension.
          Stripe handles your payment method, invoices and cancellation. Cancelling
          takes effect at the end of the period you&rsquo;ve already paid for. While Stripe finalizes a
          renewal, a membership may show as active for up to 72 hours after the paid period ends. See{' '}
          <Link to={REFUNDS_PATH}>cancellation and refunds</Link> for the details.
        </p>
        <p data-testid="supporter-reinstall">
          Your Supporter connection stays in this browser. Reinstalled or using another browser?
          Contact billing support to restore a membership.
        </p>
        <p data-testid="supporter-billing-help">
          You can still cancel or update billing in{' '}
          <a href={STRIPE_CUSTOMER_PORTAL_LOGIN_URL} target="_blank" rel="noopener noreferrer">Stripe&rsquo;s customer portal</a>{' '}
          with the email you paid with. Billing changes do not restore extension access;{' '}
          <a href="mailto:privacy@streampulse.stream">contact us</a> and we&rsquo;ll help.
        </p>

        <h2>Before you subscribe</h2>
        <p>
          Read the <Link to={SUPPORTER_TERMS_PATH}>Supporter terms</Link>, the{' '}
          <Link to={REFUNDS_PATH}>cancellation and refund policy</Link>, and the{' '}
          <Link to={PRIVACY_PATH}>privacy policy</Link> — the last one covers what an account stores
          and what Stripe receives.
        </p>

        <h2>Questions</h2>
        {/* OWNER CONFIRMED 2026-10-13 (D35): Aron answers billing, cancellation
            and refund requests within 7 days. Private mailbox routing is ops-owned. */}
        <p>
          Billing and account questions: <a href="mailto:privacy@streampulse.stream">privacy@streampulse.stream</a>.
          Product questions and bug reports belong on the <Link to="/support">support page</Link>.
        </p>
        <p>Aron answers billing, cancellation and refund requests within 7 days.</p>
      </article>
    </PublicLayout>
  )
}
