/**
 * Pre-launch statement shared by the Terms, Refunds, Privacy and Supporter
 * pages, so the four cannot drift apart.
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
      <strong>Supporter sign-ups aren&rsquo;t open yet</strong>, so you can&rsquo;t buy it today. Billing
      details here describe how it will work once they open.
    </p>
  )
}
