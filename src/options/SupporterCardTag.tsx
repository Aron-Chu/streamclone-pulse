/**
 * Who sees a Supporter card, beside its heading: "Only you" for Your look,
 * "Public · {state}" for Seen in chat. The words carry the meaning; the icon
 * only repeats them.
 */
export function SupporterCardTag({ audience, tone, children }: {
  audience: 'only-you' | 'public'
  /** Public state shading: filled once on, amber while pending, dashed when unknown. */
  tone?: 'on' | 'pending' | 'unknown'
  children: string
}) {
  return (
    <span className="pulse-supporter-tag" data-audience={audience} data-tone={tone}>
      {audience === 'only-you'
        ? <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M5.5 7V5a2.5 2.5 0 015 0v2" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
        : <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="5.5" cy="5.5" r="2.3" fill="none" stroke="currentColor" strokeWidth="1.4" /><circle cx="11" cy="6" r="1.9" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M1.5 13.5c.6-2.4 2.2-3.6 4-3.6s3.4 1.2 4 3.6M10 10c1.9-.3 3.6.8 4.3 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>}
      {children}
    </span>
  )
}
