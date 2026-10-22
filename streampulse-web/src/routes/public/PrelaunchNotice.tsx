/**
 * Pre-launch statement shared by the Terms, Refunds and Privacy pages, so they
 * cannot drift apart. /supporter says it once in its hero, as the same opening
 * sentence (S1 layout, 2026-10-21).
 *
 * Supporter sign-ups are closed. Nothing on these pages may read as if a membership
 * can be bought today, or as if one has already been sold. Remove this only
 * when live checkout opens, together with the owner-approved final copy.
 */
export function PrelaunchNotice() {
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
