import { Link } from 'react-router-dom'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { PRIVACY_PATH, REFUNDS_PATH, STRIPE_CUSTOMER_PORTAL_LOGIN_URL, SUPPORTER_TERMS_PATH } from '../../lib/externalLinks'
import { PrelaunchNotice } from './PrelaunchNotice'
import { SUPPORTER_WITHDRAWAL_PATH, supporterWithdrawalEnabled } from '../../lib/supporterWithdrawal'
import { chromeWebStoreUrlForPage } from '../../lib/publicSiteConfig'
import { SupporterPerkItems, supporterOnlyYou } from '../../ui/components/SupporterPerks'
import { SupporterNoTwitchChatBadge, SupporterSeenInChat } from '../../ui/components/SupporterChatBadgeCopy'
import { supporterChatBadgesEnabled } from '../../lib/supporterChatBadgesFlag'

/**
 * Public Supporter offer: perks first, then the price, said once (the short
 * page Aron picked on 2026-10-22). The grace period, refunds, disputes and the
 * renewal window live in the Terms and the refund policy, which this page links.
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
 * USD only at launch: Checkout charges in US dollars, so the price says US$. Tax
 * wording stays general until Checkout calculates tax itself.
 */
const PRICE_DISPLAY = 'US$4.99 a month.'

export default function Supporter() {
  const chatBadges = supporterChatBadgesEnabled()
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
            Support StreamPulse and get four looks for your Pulse panel. All analytics stay free.
          </p>
        </header>

        <PrelaunchNotice />

        <h2>What you get</h2>
        <ul data-testid="supporter-perks">
          <SupporterPerkItems />
        </ul>
        {/* Seen in chat copy only once VITE_SUPPORTER_CHAT_BADGES is on (launch day). */}
        <p>
          {supporterOnlyYou()}
          {chatBadges ? null : <> There&rsquo;s no public chat badge.</>} That&rsquo;s everything Supporter adds.
        </p>
        {chatBadges ? <><SupporterSeenInChat /><SupporterNoTwitchChatBadge /></> : null}

        <h2>Price</h2>
        <ul data-testid="supporter-terms">
          <li><strong>{PRICE_DISPLAY}</strong> It renews monthly until you cancel.</li>
          <li>
            Cancel any time in Stripe, from the extension&rsquo;s <strong>Account &amp; Supporter</strong>{' '}
            page. You keep Supporter until the end of the month you paid for.
          </li>
          <li>Stripe handles payment and shows the total, including any tax, before you pay.</li>
          <li data-testid="supporter-reinstall">
            Your Supporter connection stays in this browser. Reinstalled or using another browser?
            Contact billing support to restore a membership.
          </li>
          <li data-testid="supporter-billing-help">
            You can still cancel or update billing in{' '}
            <a href={STRIPE_CUSTOMER_PORTAL_LOGIN_URL} target="_blank" rel="noopener noreferrer">Stripe&rsquo;s customer portal</a>{' '}
            with the email you paid with. Billing changes do not restore extension access;{' '}
            <a href="mailto:privacy@streampulse.stream">contact us</a> and we&rsquo;ll help.
          </li>
        </ul>
        <p>
          <Link to={SUPPORTER_TERMS_PATH}>Supporter terms</Link> ·{' '}
          <Link to={REFUNDS_PATH}>Cancellation &amp; refunds</Link> ·{' '}
          <Link to={PRIVACY_PATH}>Privacy</Link>
        </p>
        {supporterWithdrawalEnabled() ? <p><Link to={SUPPORTER_WITHDRAWAL_PATH}>Withdraw from contract here</Link>.</p> : null}

        <h2 id="subscribe">Try it now</h2>
        <div className="rounded-xl border border-white/[0.08] bg-black/20 p-6" data-testid="supporter-availability">
          <p className="!mt-0">Get the extension and try the looks in settings. It&rsquo;s free.</p>
          <p className="mb-0 flex flex-wrap gap-3">
            <a className="btn btn-primary" href={chromeWebStoreUrlForPage('supporter')} target="_blank" rel="noopener noreferrer">Get the extension</a>
          </p>
          <p className="mb-0">
            Joining later: choose <strong>Become a Supporter</strong> in the extension&rsquo;s{' '}
            <strong>Account &amp; Supporter</strong> page and pay on Stripe. No Twitch sign-in or
            separate StreamPulse sign-up is needed.
          </p>
        </div>

        <h2>Questions</h2>
        {/* OWNER CONFIRMED 2026-10-13 (D35): Aron answers billing, cancellation
            and refund requests within 7 days. Private mailbox routing is ops-owned. */}
        <p>
          Billing: <a href="mailto:privacy@streampulse.stream">privacy@streampulse.stream</a>. Aron
          answers billing, cancellation and refund requests within 7 days. Anything else:{' '}
          <Link to="/support">Support</Link>.
        </p>
      </article>
    </PublicLayout>
  )
}
