import { reviewDestination } from '../shared/reviewDestination.ts'

/** A one-time, nonblocking invitation. No sentiment question or rating incentive. */
export function ReviewRequest({ onDismiss }: { onDismiss: () => void }) {
  const href = reviewDestination()
  if (!href) return null
  return (
    <section className="pulse-review-request" aria-label="Review StreamPulse">
      <p>Your review helps other Twitch viewers discover StreamPulse.</p>
      <div className="pulse-review-actions">
        <a href={href} target="_blank" rel="noopener noreferrer">Write a review ↗</a>
        <button type="button" onClick={onDismiss}>Dismiss</button>
      </div>
    </section>
  )
}
