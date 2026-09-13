import { Link } from 'react-router-dom'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { PRIVACY_PATH, PUBLIC_SUPPORT_URL, REFUNDS_PATH, SUPPORTER_PATH } from '../../lib/externalLinks'

/**
 * Terms of use for the portal, the Chrome extension and the Supporter
 * subscription. Describes current behaviour only — no clause here promises a
 * feature, entity or process that does not exist.
 */
export default function Terms() {
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
            Last updated: September 11, 2026 · Applies to{' '}
            <code className="font-mono text-zinc-300">streampulse.stream</code>, the StreamPulse
            Chrome extension, and the Pulse Supporter subscription.
          </p>
        </header>

        <section className="mt-8 rounded-xl border border-white/[0.08] bg-black/20 p-6">
          <h2 className="!mt-0">Summary</h2>
          <p className="text-zinc-300">
            StreamPulse is a free Twitch analytics site and browser extension. Pulse Supporter is an
            optional $4.99/month subscription that funds development and adds cosmetics — it does not
            unlock analytics. You can cancel at any time and keep access until the end of the month
            you paid for. The service is provided as-is, with no uptime guarantee.
          </p>
        </section>

        <h2>What StreamPulse is</h2>
        <p>
          StreamPulse shows Twitch stream activity using minute-level aggregates: chat, emote and
          viewer signals, plus coverage state for live streams and VODs. It is provided through this
          website and an optional Chrome extension. It is a reporting tool, not a source of truth
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
        <p>An account is optional and free. You need one only to link the extension or to subscribe.</p>
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
        <p>
          Sign-in is by emailed link — there is no password. Anyone who can read your email can sign
          in as you, so keep that mailbox secure and do not forward a sign-in link. A link expires 15
          minutes after it is requested and can only be confirmed in the browser that asked for it.
        </p>
        <p>
          StreamPulse will never ask you to share a sign-in link or an extension connection code. See
          the <Link to={PRIVACY_PATH}>privacy policy</Link> for what an account stores.
        </p>

        <h2>Pulse Supporter</h2>
        <p>
          Supporter is optional. Full details are on the{' '}
          <Link to={SUPPORTER_PATH}>Supporter page</Link>; the terms of the offer are:
        </p>
        <ul>
          <li><strong>Price:</strong> $4.99 per month, plus any applicable tax, shown before you pay.</li>
          <li><strong>Renewal:</strong> it renews automatically each month until you cancel.</li>
          <li>
            <strong>Cancellation:</strong> you can cancel at any time. Cancelling stops future
            charges and keeps your access until the end of the month you already paid for.
          </li>
          <li>
            <strong>What you get:</strong> an original Pulse profile banner, three decorative overlay
            finishes, and private support recognition. Nothing else is promised.
          </li>
          <li>
            <strong>What you do not get:</strong> no public Twitch chat badge (designed, not shipped),
            and no analytics, coverage or rate-limit changes of any kind.
          </li>
        </ul>
        <p>
          Payments are processed by Stripe. Your card details go to Stripe, not to StreamPulse —
          StreamPulse stores only identifiers for your customer, subscription and invoices. Entitlement
          is granted from confirmed payment records on the server, never from anything your browser or
          extension claims.
        </p>
        <p>
          If a payment fails, Supporter features stay active for a short grace period while the
          payment is retried, then lapse. Lapsing never deletes your saved settings or free features.
        </p>
        <p>
          Cancellation and refunds are covered in the{' '}
          <Link to={REFUNDS_PATH}>cancellation and refund policy</Link>.
        </p>

        <h2>Selling entity and applicable law</h2>
        <p>
          Paid sign-ups are not open. No sale is offered through this site today, and the Supporter
          page says so. The selling entity, the governing law and any consumer-specific cancellation
          rights that apply to you will be stated on this page before paid sign-ups open. Nothing on
          this page limits rights you have under consumer law that cannot be waived.
        </p>

        <h2>Price and term changes</h2>
        <p>
          If the Supporter price changes, existing members will be notified by email before the change
          takes effect and will be able to cancel before being charged the new amount. A price change
          is never applied retroactively to a month you already paid for.
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
          Access may be suspended or ended for the conduct listed under "Using the service", or where
          required by law or by a payment provider. Where a paid membership is ended for something
          other than your own conduct, the unused part of the paid month is refunded.
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
        <p data-testid="terms-contact">
          Billing, account and legal questions:{' '}
          <a href="mailto:privacy@streampulse.stream">privacy@streampulse.stream</a>. Product
          questions and bug reports:{' '}
          <a href={PUBLIC_SUPPORT_URL} target="_blank" rel="noreferrer noopener">public GitHub issues</a>{' '}
          or the <Link to="/support">support page</Link>. There is no phone support.
        </p>
      </article>
    </PublicLayout>
  )
}
