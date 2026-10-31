import { Link } from 'react-router-dom'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { FoldedSections } from '../../ui/components/FoldedSections'
import { FEEDBACK_PATH, PRIVACY_PATH, REFUNDS_PATH, SECURITY_REPORT_URL, STRIPE_CUSTOMER_PORTAL_LOGIN_URL, SUPPORTER_PATH } from '../../lib/externalLinks'
import { discordInviteUrl } from '../../lib/discord'
import { PrelaunchNotice } from './PrelaunchNotice'
import { SupporterPerkItems, supporterOnlyYou } from '../../ui/components/SupporterPerks'
import { TermsSeenInChatBullets } from '../../ui/components/SupporterChatBadgeCopy'
import { supporterChatBadgesEnabled } from '../../lib/supporterChatBadgesFlag'

/**
 * Terms of use for the portal, the browser extension and the Supporter
 * subscription. Describes current behaviour only — no clause here promises a
 * feature, entity or process that does not exist.
 */
export default function Terms() {
  const discord = discordInviteUrl()
  return (
    <PublicLayout>
      <article className="panel public-document" data-testid="terms-of-use">
        <p className="muted public-document__back">
          <Link to="/" className="text-zinc-400 hover:text-white inline-flex items-center gap-1">← StreamPulse Home</Link>
        </p>
        <header className="mb-6 border-b border-white/[0.08] pb-6">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="inline-flex items-center gap-1.5 rounded bg-emerald-500/10 px-2.5 py-1 text-xs font-bold text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Website, extension and Supporter
            </span>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-white lg:text-4xl">Terms of Use</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Last updated: October 26, 2026 · Applies to{' '}
            <code className="font-mono text-zinc-300">streampulse.stream</code>, the StreamPulse
            browser extension (Chrome, Brave, Edge and Firefox), and the Pulse Supporter subscription.
          </p>
        </header>

        <PrelaunchNotice />

        <section className="mt-8 rounded-xl border border-white/[0.08] bg-black/20 p-6">
          <h2 className="!mt-0">Summary</h2>
          <p className="text-zinc-300">
            StreamPulse is a free Twitch analytics site and browser extension. Pulse Supporter is an
            optional subscription of US$4.99 per month that funds development and adds cosmetics — it
            does not unlock analytics. Paid sign-ups are not open yet. Once they are, you will be able
            to cancel at any time and keep access until the end of the period you paid for. The
            service is provided as-is, with no uptime guarantee.
          </p>
        </section>

        {/* Each h2 below opens a section that folds under its heading (FoldedSections). */}
        <FoldedSections>
        <h2>What StreamPulse is</h2>
        <p>
          StreamPulse shows Twitch stream activity using minute-level aggregates: chat, emote and
          viewer signals, plus coverage state for live streams and VODs. It is provided through this
          website and an optional browser extension. It is a reporting tool, not a source of truth
          about any channel, and coverage gaps are reported honestly rather than filled in.
        </p>
        <p>
          StreamPulse is <strong>not affiliated with, endorsed by, or operated by Twitch</strong> or
          Amazon. "Twitch" and other names are used only to describe what the service reports on.
          Your use of Twitch stays governed by Twitch's own terms.
        </p>

        <h2>Using the service</h2>
        <p>
          You may use StreamPulse if you are at least 13 years old. To subscribe you must also be old
          enough to enter into a contract where you live, or have a parent or guardian do it for you.
        </p>
        <p>
          Core Pulse is free and does not require an account. You can connect the extension without
          Twitch or a separate StreamPulse sign-up; connecting starts no payment. Once paid sales
          open, a Supporter purchase is offered separately through Stripe and linked to that extension
          connection.
        </p>
        <p>Please do not:</p>
        <ul>
          <li>Attempt to access another person's account or a device credential you were not given.</li>
          <li>
            Scrape, resell or redistribute StreamPulse data as your own product, or run automated
            traffic that degrades the service for others.
          </li>
          <li>Probe, overload or circumvent rate limits, authentication or access controls.</li>
          <li>Use the service to harass a streamer or viewer, or to build a profile of an individual.</li>
          <li>Misrepresent StreamPulse output as official Twitch data.</li>
        </ul>
        <p>
          Security research is welcome. Report vulnerabilities privately through GitHub Private
          Vulnerability Reporting rather than in a public issue.
        </p>

        <h2>Your account</h2>
        <p data-testid="terms-your-account">
          An extension connection uses private credentials saved in your browser profile. Keep that
          profile secure, and never share a device credential, sign-in link or extension connection
          code. Invited testers may use a separate account connected by an emailed sign-in link that
          expires after 15 minutes or a tester connection code. Connecting does not automatically
          combine accounts.
        </p>
        <p>
          See the <Link to={PRIVACY_PATH}>privacy policy</Link> for what an account stores.
        </p>

        <h2 id="supporter">Pulse Supporter</h2>
        <p>
          Supporter is optional, and paid sign-ups are not open yet. Full details are on the{' '}
          <Link to={SUPPORTER_PATH}>Supporter page</Link>. Once sign-ups open, the terms of the offer
          are:
        </p>
        <ul>
          <li>
            <strong>Price:</strong> US$4.99 per month, charged in US dollars. Taxes are handled as
            stated at checkout, and Stripe checkout shows the total before you pay.
          </li>
          <li><strong>Renewal:</strong> it renews automatically each month until you cancel.</li>
          <li>
            <strong>Cancellation:</strong> you can cancel at any time in the Stripe Customer Portal,
            reachable through Manage subscription in the connected extension or through{' '}
            <a href={STRIPE_CUSTOMER_PORTAL_LOGIN_URL} target="_blank" rel="noopener noreferrer">Stripe's billing-email portal</a>.
            Cancelling stops future charges and takes effect at the
            end of the period you already paid for; your access continues until then.
          </li>
          <li data-testid="terms-supporter-benefits">
            <strong>What you get:</strong> every Supporter perk the extension gives, the same list
            as on the <Link to={SUPPORTER_PATH}>Supporter page</Link>:
            <ul>
              <SupporterPerkItems />
            </ul>
            {supporterOnlyYou()} Nothing else is promised.
          </li>
          {/* Seen in chat copy only once VITE_SUPPORTER_CHAT_BADGES is on (launch day). */}
          {supporterChatBadgesEnabled() ? <TermsSeenInChatBullets /> : (
            <li>
              <strong>What you do not get:</strong> no public Twitch chat badge — it is not included —
              and no analytics, coverage or rate-limit changes of any kind.
            </li>
          )}
        </ul>
        <p>
          Payments are processed by Stripe. Your card details go to Stripe, not to StreamPulse —
          StreamPulse stores identifiers for your customer, subscription and invoices. Entitlement
          is granted from confirmed payment records on the server, never from anything your browser or
          extension claims.
        </p>
        <p data-testid="terms-billing-email">
          Stripe uses the email you give at checkout for receipts and billing. An extension-only
          connection is saved in its browser profile; reinstalling or using another browser does not
          restore it automatically. You can still manage billing through Stripe with the email you
          paid with. Contact billing support for help with your membership. Billing changes
          do not move Supporter to another account; starting another checkout is not a recovery step.
        </p>
        <p>
          While Stripe finalizes a renewal, your membership may show as active for up to 72 hours
          after the paid period ends. If a renewal payment fails, Supporter features stay active for
          a 7-day grace period, counted from the end of the last paid period, while the payment is
          retried. If it is still unpaid after those 7 days, the features lapse. Lapsing never
          deletes your saved settings or free features.
        </p>
        <p>
          A full refund, or a payment dispute that reverses the charge, ends Supporter access for the
          period that charge paid for. A partial refund keeps that access. While a dispute is open,
          access is suspended until it is resolved. Cancellation and refunds are covered in the{' '}
          <Link to={REFUNDS_PATH}>cancellation and refund policy</Link>.
        </p>

        {/* PENDING OWNER INPUT (audit LG-1, memo L-1): the selling entity, its legal
            address, the governing law and the statutory rights are facts only the owner
            can supply, with a legal professional. Never fill them in from anywhere else.
            They must be stated here before paid sign-ups open. */}
        <h2>Selling entity and applicable law</h2>
        <p data-testid="terms-pending-owner-input">
          Paid sign-ups are not open, and no sale is offered through this site today. The selling
          entity, legal address, governing law and consumer cancellation rights will be stated here
          before paid sign-ups open.
        </p>
        <p>Nothing on this page limits rights you have under consumer law that cannot be waived.</p>

        <h2>Price and term changes</h2>
        <p>
          If the Supporter price changes after sign-ups open, members will be notified by email before
          the change takes effect and will be able to cancel before being charged the new amount. A
          price change is never applied retroactively to a month already paid for.
        </p>

        <h2>Availability</h2>
        <p>
          StreamPulse is provided <strong>as-is and as-available</strong>, with no guarantee of
          uptime, accuracy, coverage completeness or continued availability of any feature. Analytics
          depend on upstream Twitch data that can be delayed, incomplete or withdrawn. Current
          operational state is on the <Link to="/status">status page</Link>.
        </p>
        <p>
          Features may change or be withdrawn. If a feature that Supporter explicitly includes is
          withdrawn, affected members will be notified and able to cancel.
        </p>

        <h2>Ending your use</h2>
        <p>
          You can stop using StreamPulse at any time: uninstall the extension, cancel a subscription,
          or stop visiting the site. Uninstalling removes that installation's browser storage.
        </p>
        <p>
          If StreamPulse ends a Supporter membership, the current month is refunded in full and
          Supporter access ends. Your account, saved settings and free features are not affected.
        </p>

        <h2>Liability</h2>
        <p>
          StreamPulse is a small project offered without warranty. To the extent the law allows, it is
          not liable for indirect or consequential loss, for lost revenue, or for decisions made on
          the basis of its analytics. Where liability cannot be excluded, it is limited to the amount
          you paid in the twelve months before the claim — which, for a free user, is nothing. This
          does not limit liability that cannot be limited by law.
        </p>

        <h2>Changes to these terms</h2>
        <p>
          Material changes will be posted here with an updated date. If a change materially affects a
          paid subscription, members will be emailed before it takes effect.
        </p>

        <h2>Contact</h2>
        {/* OWNER CONFIRMED 2026-10-13 (D35): Aron answers billing, cancellation
            and refund requests within 7 days. Private mailbox routing is ops-owned. */}
        <p data-testid="terms-contact">
          Billing, account and legal questions:{' '}
          <a href="mailto:privacy@streampulse.stream">privacy@streampulse.stream</a>. Product
          questions and bug reports: send <Link to={FEEDBACK_PATH}>private feedback</Link>
          {discord ? <>{' '}or join the{' '}
            <a href={discord} target="_blank" rel="noopener noreferrer" aria-label="Discord (opens in a new tab)">Discord</a></> : null}.
          Security reports go privately through{' '}
          <a href={SECURITY_REPORT_URL} target="_blank" rel="noreferrer noopener">GitHub private vulnerability reporting</a>.
          There is no phone support.
        </p>
        <p>Aron answers billing, cancellation and refund requests within 7 days.</p>
        </FoldedSections>
      </article>
    </PublicLayout>
  )
}
