import { Link } from 'react-router-dom'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { STRIPE_CUSTOMER_PORTAL_LOGIN_URL, SUPPORTER_PATH, TERMS_PATH } from '../../lib/externalLinks'
import { SUPPORTER_WITHDRAWAL_PATH, supporterWithdrawalEnabled } from '../../lib/supporterWithdrawal'

/**
 * Cancellation and refund policy for Pulse Supporter.
 *
 * Every mechanism described here matches the verified Stripe customer-portal
 * configuration: invoice history, payment-method update and period-end
 * cancellation are enabled; plan switching and pausing are not. Nothing on this
 * page describes a control that the portal does not actually offer.
 *
 * What a refund or dispute does to access mirrors the backend entitlement rules:
 * a completed full refund or a lost dispute expires that period, a partial
 * refund keeps it, and an open dispute sends the membership to review, which
 * grants no access.
 */
export default function Refunds() {
  return (
    <PublicLayout>
      <article className="panel public-document" data-testid="refund-policy">
        <p className="muted public-document__back">
          <Link to="/" className="text-zinc-400 hover:text-white inline-flex items-center gap-1">← StreamPulse Home</Link>
        </p>
        <header className="mb-6 border-b border-white/[0.08] pb-6">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="inline-flex items-center gap-1.5 rounded bg-emerald-500/10 px-2.5 py-1 text-xs font-bold text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Pulse Supporter billing
            </span>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-white lg:text-4xl">Cancellation &amp; Refunds</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Last updated: October 28, 2026 · Applies to the Pulse Supporter subscription.
          </p>
        </header>


        <section className="mt-8 rounded-xl border border-white/[0.08] bg-black/20 p-6">
          <h2 className="!mt-0">Summary</h2>
          <p className="text-zinc-300">
            You can cancel whenever you like and keep
            access until the end of the period you already paid for. No cancellation fee, no minimum
            term, and no need to ask anyone. If something went wrong — a duplicate charge, a charge
            you did not intend, or a feature that did not work — email and it gets refunded.
          </p>
        </section>

        <h2>Cancelling</h2>
        {/* OWNER CONFIRMED 2026-10-13 (D35): Aron answers billing, cancellation
            and refund requests within 7 days. Private mailbox routing is ops-owned. */}
        <p>
          Cancellation is self-service in the Stripe Customer Portal, reachable through Manage
          subscription in the connected extension or through{' '}
          <a href={STRIPE_CUSTOMER_PORTAL_LOGIN_URL} target="_blank" rel="noopener noreferrer">Stripe's billing-email portal</a>.
          You can also ask to cancel by emailing{' '}
          <a href="mailto:privacy@streampulse.stream">privacy@streampulse.stream</a>. If possible,
          use your current Stripe billing email so we can find your subscription.
        </p>
        <ul>
          <li>Cancelling takes effect at the end of the period you have already paid for.</li>
          <li>Supporter cosmetics stay active until then; nothing is switched off early.</li>
          <li>There is no cancellation fee and no minimum term.</li>
          <li>
            Cancellation stays available after access has already ended, so a lapsed membership can
            still be closed out.
          </li>
          <li>
            Your settings, saved preferences and free features are untouched. Supporter preferences
            are kept but inactive, so resubscribing restores them.
          </li>
        </ul>
        <p>
          The Customer Portal also lets you update your payment method and download past invoices. It
          deliberately does not offer plan switching or pausing — there is only one plan.
        </p>

        <h2>Renewals and failed payments</h2>
        <ul>
          <li>
            While Stripe finalizes a renewal, your membership may show as active for up to 72 hours
            after the paid period ends.
          </li>
          <li>
            If a renewal payment fails, Supporter cosmetics stay active for a 7-day grace period,
            counted from the end of the last paid period, while the payment is retried.
          </li>
          <li>If the payment is still unpaid after those 7 days, Supporter access lapses.</li>
        </ul>

        <h2>Refunds</h2>
        <p>
          Supporter is a monthly subscription to cosmetics and project funding, so the default is that
          a month already used is not refunded — you cancel and keep access to the end of it. Inside
          that default, these are refunded on request, without argument:
        </p>
        <ul>
          <li><strong>A duplicate or double charge.</strong> Refunded in full.</li>
          <li>
            <strong>A charge you did not intend</strong> — for example a renewal you meant to cancel,
            raised within 14 days of the charge and with the month largely unused. Refunded in full.
          </li>
          <li>
            <strong>A Supporter feature that did not work</strong> for a meaningful part of the period.
            Refunded in full or pro-rated, whichever is fairer to you.
          </li>
          <li>
            <strong>A membership ended by StreamPulse.</strong> The current month is refunded in full,
            and Supporter access ends.
          </li>
          <li>
            <strong>A charge on an account that was not yours to authorise.</strong> Refunded in full,
            and the payment method is unlinked.
          </li>
        </ul>

        <h2>What a refund does to your access</h2>
        <ul>
          <li>
            <strong>A full refund</strong> ends Supporter access for the period that charge paid for,
            once the refund has gone through.
          </li>
          <li>
            <strong>A partial refund</strong> keeps your access for the rest of that period.
          </li>
          <li>Either way, your account, saved settings and free features are untouched.</li>
        </ul>
        <p>
          Refunds go back to the original payment method through Stripe, normally within five to ten
          business days depending on your bank. StreamPulse cannot refund to a different card or
          account.
        </p>
        <p>
          Outside those cases refunds are discretionary. If your situation is not listed, ask — the
          answer is a real answer, not a form.
        </p>

        <h2>Consumer cancellation rights</h2>
        {supporterWithdrawalEnabled() ? <p><Link to={SUPPORTER_WITHDRAWAL_PATH}>Withdraw from contract here</Link>.</p> : null}
        <p>
          If you live in the EU, the wider European Economic Area or the UK, you can withdraw from a
          new Supporter subscription within 14 days after you subscribe, without giving a reason,
          and get a full refund. To withdraw, email within that period as described under How to ask
          {supporterWithdrawalEnabled() ? <>{' '}or use the <Link to={SUPPORTER_WITHDRAWAL_PATH}>withdrawal form</Link></> : null}.
          This is on top of the refunds above. Other places may give you a statutory right to cancel
          too, and nothing here removes a right you have under consumer law that cannot be waived.
          Who sells Supporter, and which law applies, is in the <Link to={TERMS_PATH}>terms of use</Link>.
        </p>

        <h2>How to ask</h2>
        <p>
          Email <a href="mailto:privacy@streampulse.stream">privacy@streampulse.stream</a> and include
          the date and amount of the charge or the invoice number from your Stripe receipt. If possible,
          use your current Stripe billing email. If you cannot access it, contact us anyway; we may
          ask for other information to verify your request. Please do not include your full card number —
          it is not needed and StreamPulse cannot use it.
        </p>
        <p>
          Aron answers billing, cancellation and refund requests within 7 days. There is no
          automated refund line and no phone support.
        </p>

        <h2>Disputes and chargebacks</h2>
        <p>
          You are free to dispute a charge with your bank, but emailing first is almost always faster:
          a refund can be issued immediately, whereas a bank dispute takes weeks to resolve.
        </p>
        <ul>
          <li>
            <strong>While a dispute is open,</strong> Supporter access for the disputed period is
            suspended while it is under review.
          </li>
          <li>
            <strong>If the dispute reverses the charge,</strong> access for that period ends, as with a
            full refund.
          </li>
          <li>
            <strong>If the dispute closes without reversing the charge,</strong> access for the rest of
            that period is restored.
          </li>
        </ul>
        <p>
          StreamPulse does not use your viewing history, saved moments or searched channels as dispute
          evidence — only payment records and delivery state.
        </p>

        <h2>Questions before subscribing</h2>
        <p>
          The full offer, including what is and is not included, is on the{' '}
          <Link to={SUPPORTER_PATH}>Supporter page</Link>. If anything there is unclear, ask before
          you pay rather than after.
        </p>
      </article>
    </PublicLayout>
  )
}
