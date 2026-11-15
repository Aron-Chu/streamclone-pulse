import { reviewDestination } from '../shared/reviewDestination.ts'
import { useFocusReturn } from './useFocusReturn.ts'

/** A one-time, nonblocking invitation. No sentiment question or rating incentive. */
export function ReviewRequest({ onDismiss }: { onDismiss: () => void }) {
  const href = reviewDestination()
  // Dismiss hands focus back to where it was when this appeared, not to the page.
  const [ref, back] = useFocusReturn<HTMLElement>()
  if (!href) return null
  return (
    <section ref={ref} className="pulse-review-request" aria-label="Review StreamPulse">
      <p>Your review helps other Twitch viewers discover StreamPulse.</p>
      <div className="pulse-review-actions">
        <a href={href} target="_blank" rel="noopener noreferrer">Write a review ↗</a>
        <button type="button" onClick={() => { back(); onDismiss() }}>Dismiss</button>
      </div>
    </section>
  )
}
