import { Link } from 'react-router-dom'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { PRIVACY_PATH, REFUNDS_PATH, TERMS_PATH } from '../../lib/externalLinks'

/**
 * Public Supporter offer. One honest monthly price, stated once.
 *
 * This is the destination the extension's Supporter card links to, and the page
 * whose terms that card summarizes — so the two must agree on price, cadence and
 * cancellation. There is deliberately no checkout button: billing is not
 * deployed, and an offer page that cannot take payment must say so rather than
 * present a control that fails.
 */
const PRICE_DISPLAY = '$4.99 / month'

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

        <section className="mt-8 rounded-xl border border-violet-500/25 bg-violet-500/[0.06] p-6" data-testid="supporter-terms">
          <h2 className="!mt-0">The offer</h2>
          <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <dt className="text-sm font-bold text-zinc-400">Price</dt>
            <dd className="m-0 text-sm font-bold text-white">{PRICE_DISPLAY}</dd>
            <dt className="text-sm font-bold text-zinc-400">Renews</dt>
            <dd className="m-0 text-sm text-zinc-200">Monthly, automatically, until you cancel</dd>
            <dt className="text-sm font-bold text-zinc-400">Cancel</dt>
            <dd className="m-0 text-sm text-zinc-200">
              Any time. Access runs to the end of the month you already paid for.
            </dd>
            <dt className="text-sm font-bold text-zinc-400">Taxes</dt>
            <dd className="m-0 text-sm text-zinc-200">Any applicable tax is shown before you pay.</dd>
            <dt className="text-sm font-bold text-zinc-400">Payment</dt>
            <dd className="m-0 text-sm text-zinc-200">
              Handled by Stripe. StreamPulse never sees or stores your card number.
            </dd>
          </dl>
        </section>

        <h2>What Supporter includes</h2>
        <ul>
          <li>An original Pulse profile banner.</li>
          <li>Three decorative overlay finishes.</li>
          <li>Private support recognition in your account.</li>
        </ul>

        <h2>What it does not include</h2>
        <p>
          <strong>No public Twitch chat badge.</strong> A chat badge is designed but not shipped, and
          is not part of what you are buying. If it ever ships it will be added for existing
          Supporters at no extra cost — but do not subscribe expecting it.
        </p>
        <p>
          Supporter does not unlock analytics, change coverage, raise rate limits, or affect what the
          extension can see on Twitch. It buys cosmetics and funds the work.
        </p>

        <h2>What stays free</h2>
        <p>
          The Chrome extension, Pulse overlays, coverage and backfill status, the public analytics
          hub, channel and session analytics, accent themes, and ordinary clip downloading. None of
          these are behind Supporter, and none will be moved behind it.
        </p>

        <h2 id="subscribe">How to subscribe</h2>
        <div className="rounded-xl border border-white/[0.08] bg-black/20 p-6" data-testid="supporter-availability">
          <p className="!mt-0">
            <strong>Supporter is not yet open for sign-ups.</strong> Payment processing is built and
            tested but not deployed, so there is nothing to buy today. This page is the honest
            version of that: no checkout button that fails, and no waitlist that collects your
            details for a product that is not selling.
          </p>
          <p className="mb-0">
            When it opens, subscribing will take a StreamPulse account and a Stripe checkout on this
            site. <Link to="/account/sign-in">Account sign-in</Link> and extension linking depend on
            account services being available on this site.
          </p>
        </div>

        <h2>Managing a membership</h2>
        <p>
          Once Supporter is live, payment method, invoice history and cancellation are handled in the
          Stripe customer portal, reachable from your account. Cancelling takes effect at the end of
          the period you have already paid for, and stays available after access ends. See{' '}
          <Link to={REFUNDS_PATH}>cancellation and refunds</Link> for the details.
        </p>

        <h2>Before you subscribe</h2>
        <p>
          Read the <Link to={TERMS_PATH}>Supporter terms</Link>, the{' '}
          <Link to={REFUNDS_PATH}>cancellation and refund policy</Link>, and the{' '}
          <Link to={PRIVACY_PATH}>privacy policy</Link> — the last one covers what an account stores
          and what Stripe receives.
        </p>

        <h2>Questions</h2>
        <p>
          Billing and account questions: <a href="mailto:privacy@streampulse.stream">privacy@streampulse.stream</a>.
          Product questions and bug reports belong on the <Link to="/support">support page</Link>.
        </p>
      </article>
    </PublicLayout>
  )
}
