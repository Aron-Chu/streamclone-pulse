import { lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { PRIVACY_PATH, REFUNDS_PATH, SUPPORTER_TERMS_PATH } from '../../lib/externalLinks'
import { CHROME_WEB_STORE_LISTING_URL } from '../../lib/publicSiteConfig'
import { SUPPORTER_PRICE_DISPLAY, SUPPORTER_PRICE_MONTHLY } from '../../lib/supporterOffer'
import { SupporterPerkItems, supporterOnlyYou } from '../../ui/components/SupporterPerks'
import { SupporterNoTwitchChatBadge, SupporterSeenInChat } from '../../ui/components/SupporterChatBadgeCopy'
import { supporterChatBadgesEnabled } from '../../lib/supporterChatBadgesFlag'
import './supporter-page.css'

// The pictures are the extension's own paint, crest and rain code: one chunk, loaded after the words.
const SupporterLookPreview = lazy(() => import('./SupporterLook').then(m => ({ default: m.SupporterLookPreview })))
const SupporterPerkPicture = lazy(() => import('./SupporterLook').then(m => ({ default: m.SupporterPerkPicture })))

/**
 * Public Supporter offer. One honest monthly price, stated once.
 *
 * This is the destination the extension's Supporter card links to, and the page
 * whose terms that card summarizes — so the two must agree on price, cadence and
 * cancellation. Checkout availability remains server-controlled on the
 * extension; this public page must not guess deployment state.
 *
 * Account wording follows the Continue with Twitch journey (closeout
 * 2026-10-08 spec §3-§4): no website-account or email-restore choice is offered
 * here. The benefit list is the one perk list in src/shared/supporter-perks.json
 * (owner decision 2026-10-09, Terms option a): every perk the extension gives,
 * identical to the Terms and the extension.
 *
 * Layout (Aron's S1 pick, 2026-10-21): about one screen. The hero states the
 * price and, once, that sign-ups are not open yet; a live preview sits beside
 * it; the perks are cards with pictures; the rest of the words, unchanged, are
 * in three folds.
 *
 * USD only at launch: Checkout charges in US dollars, so the price says so. Tax
 * wording stays general until Checkout calculates tax itself. The price comes
 * from the one offer file (src/shared/supporter-offer.json).
 */
export default function Supporter() {
  return (
    <PublicLayout>
      <article className="panel public-document sp-page" data-testid="supporter-offer">
        <header className="sp-hero">
          <div className="sp-hero__copy">
            <span className="sp-badge"><span aria-hidden="true" />Optional membership</span>
            <h1>Pulse Supporter</h1>
            <p className="sp-hero__sub">
              Supporter funds StreamPulse development and adds a few original cosmetics. Every
              analytics feature on this site stays free.
            </p>
            <div className="sp-price">
              <strong>{SUPPORTER_PRICE_MONTHLY}</strong>
              <span>charged in US dollars</span>
              <a className="btn btn-primary" href={CHROME_WEB_STORE_LISTING_URL} target="_blank" rel="noopener noreferrer">Get the extension</a>
            </div>
            {/* "Not open yet", said once (S1). Remove only when live checkout opens, with owner-approved copy. */}
            <div id="subscribe" className="sp-notice" data-testid="supporter-availability">
              <p role="note" data-testid="prelaunch-notice">
                <strong>Supporter sign-ups are not open yet.</strong> When they open, you&rsquo;ll
                choose <strong>Continue with Twitch</strong>, then pay on Stripe. Free tools work without
                an account.
              </p>
              <p className="sp-notice__more">
                Stripe asks for a billing email at checkout. It can be different from your Twitch email,
                and you don&rsquo;t need a separate StreamPulse sign-up.
              </p>
            </div>
          </div>
          <Suspense fallback={<div className="sp-look sp-look--waiting" aria-hidden="true" />}>
            <SupporterLookPreview />
          </Suspense>
        </header>

        <h2 className="sp-perks__title">What Supporter includes</h2>
        <ul className="sp-perks" data-testid="supporter-perks">
          <SupporterPerkItems
            picture={name => (
              <Suspense fallback={<div className="sp-perk__pic" aria-hidden="true" />}>
                <SupporterPerkPicture name={name} />
              </Suspense>
            )}
          />
        </ul>
        <p className="sp-onlyyou">{supporterOnlyYou()} Nothing else is promised.</p>
        {supporterChatBadgesEnabled() ? <SupporterSeenInChat /> : null}

        <details className="sp-fold" data-testid="supporter-terms">
          <summary><h2>The offer, once sign-ups open</h2></summary>
          <dl className="sp-terms">
            <dt>Price</dt>
            <dd className="sp-terms__price">{SUPPORTER_PRICE_DISPLAY}</dd>
            <dt>Renews</dt>
            <dd>Monthly, automatically, until you cancel</dd>
            <dt>Cancel</dt>
            <dd>
              Any time, in the Stripe Customer Portal. Cancellation takes effect at the end of the
              period you already paid for, and access continues until then.
            </dd>
            <dt>Failed payment</dt>
            <dd>A 7-day grace period while the payment is retried, then Supporter access lapses.</dd>
            <dt>Refunds</dt>
            <dd>A full refund ends access for that period; a partial refund keeps it.</dd>
            <dt>Taxes</dt>
            <dd>Handled as stated at checkout. Stripe checkout shows the total before you pay.</dd>
            <dt>Payment</dt>
            <dd>Handled by Stripe. StreamPulse never sees or stores your card number.</dd>
          </dl>
        </details>

        <details className="sp-fold">
          <summary><h2>What it does not include · What stays free</h2></summary>
          <h3>What it does not include</h3>
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
          <h3>What stays free</h3>
          <p>
            The browser extension, Pulse overlays, coverage and backfill status, the public analytics
            hub, channel and session analytics, and accent themes. None of these are behind Supporter.
          </p>
        </details>

        <details className="sp-fold">
          <summary><h2>Managing a membership · Before you subscribe</h2></summary>
          <h3>Managing a membership</h3>
          <p>
            Once sign-ups open, choose <strong>Manage subscription</strong> in the extension or on your
            account page. Stripe handles your payment method, invoices and cancellation. Cancelling
            takes effect at the end of the period you&rsquo;ve already paid for. While Stripe finalizes a
            renewal, a membership may show as active for up to 72 hours after the paid period ends. See{' '}
            <Link to={REFUNDS_PATH}>cancellation and refunds</Link> for the details.
          </p>
          <p data-testid="supporter-reinstall">
            Reinstalled or on another browser? Continue with Twitch with the same Twitch account and
            your Supporter status comes back. No code to copy, no email to confirm.
          </p>
          <p data-testid="supporter-lost-twitch">
            Lost access to your Twitch account? You can still cancel or update billing in
            Stripe&rsquo;s customer portal with the email you paid with. That changes billing only. It
            doesn&rsquo;t move your membership to another Twitch account;{' '}
            <a href="mailto:privacy@streampulse.stream">contact us</a> and we&rsquo;ll help.
          </p>
          <h3>Before you subscribe</h3>
          <p>
            Read the <Link to={SUPPORTER_TERMS_PATH}>Supporter terms</Link>, the{' '}
            <Link to={REFUNDS_PATH}>cancellation and refund policy</Link>, and the{' '}
            <Link to={PRIVACY_PATH}>privacy policy</Link> — the last one covers what an account stores
            and what Stripe receives.
          </p>
          <h3>Questions</h3>
          {/* OWNER CONFIRMED 2026-10-13 (D35): Aron answers billing, cancellation
              and refund requests within 7 days. Private mailbox routing is ops-owned. */}
          <p>
            Billing and account questions: <a href="mailto:privacy@streampulse.stream">privacy@streampulse.stream</a>.
            Product questions and bug reports belong on the <Link to="/support">support page</Link>.
          </p>
          <p>Aron answers billing, cancellation and refund requests within 7 days.</p>
        </details>
      </article>
    </PublicLayout>
  )
}
