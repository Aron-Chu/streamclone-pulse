import type { ReactNode } from 'react'
import { useSupporterOffer } from '../../lib/supporterOffer'

/**
 * Pre-launch statement shared by the Terms, Refunds, Privacy and Supporter
 * pages, so the four cannot drift apart.
 *
 * It follows the one server-driven sales switch (GET /v1/billing/offer, see
 * lib/supporterOffer.ts): shown while Supporter sign-ups are closed, while the
 * answer is unknown and in the prerendered HTML; gone only once the server says
 * sales are open and this build's own checks agree. No site release is needed
 * to flip it.
 */
export function PrelaunchNotice() {
  const offer = useSupporterOffer()
  if (offer.state === 'open') return null
  return (
    <p
      role="note"
      data-testid="prelaunch-notice"
      className="mt-6 rounded-xl border border-amber-400/30 bg-amber-400/[0.06] p-4 text-sm text-amber-100"
    >
      <strong>Supporter sign-ups are not open yet.</strong> Pulse Supporter cannot be bought on this
      site today. Where this page describes Supporter billing, it describes how the membership will
      work once sign-ups open.
    </p>
  )
}

/**
 * Swaps one piece of copy on the sales switch: `closed` while sign-ups are not
 * open (and before the server has answered, and when prerendered), `open` only
 * once they are.
 */
export function SalesCopy({ closed, open }: { closed: ReactNode; open: ReactNode }) {
  return <>{useSupporterOffer().state === 'open' ? open : closed}</>
}

/** True only once the server opened sales and this build agrees. */
export function useSalesOpen(): boolean {
  return useSupporterOffer().state === 'open'
}
