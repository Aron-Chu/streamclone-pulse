import { useState } from 'react'
import { ThumbsDown, ThumbsUp } from 'lucide-react'
import {
  momentAtKey, ratingTallyText, setMomentRating, MomentFeedbackError,
  type MomentFeedback, type MomentVerdict,
} from '../../../../lib/momentFeedback'
import './moment-watch.css'

/**
 * "Real moment?" Yes | No, with the tally. Pressing your own choice again takes it back.
 * The pressed state shows at once; an error puts the previous one back.
 * `onNeedSignIn(needsLink)` asks the page for the prompt: `true` for the Twitch link, `false` for the sign-in.
 */
export function RealMomentRating({ feedback, onChange, onNeedSignIn, onStatus }: {
  feedback: MomentFeedback
  onChange: (next: MomentFeedback) => void
  onNeedSignIn: (needsLink: boolean) => void
  onStatus: (message: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<MomentVerdict | null | undefined>(undefined)
  const mine = pending !== undefined ? pending : feedback.you.verdict ?? null
  const press = async (choice: MomentVerdict) => {
    if (!feedback.you.signedIn) { onNeedSignIn(false); return }
    if (!feedback.you.canWrite) { onNeedSignIn(true); return }
    if (busy) return
    const verdict = mine === choice ? null : choice
    setBusy(true)
    setPending(verdict)
    try {
      const next = await setMomentRating(feedback.streamId, momentAtKey(Date.parse(feedback.momentAt)), verdict)
      onChange(next)
      onStatus(next.you.verdict === 'real' ? 'You said yes.' : next.you.verdict === 'not_real' ? 'You said no.' : 'Your rating is removed.')
    } catch (error) {
      if (error instanceof MomentFeedbackError && error.status === 401) onNeedSignIn(false)
      else if (error instanceof MomentFeedbackError && error.status === 403 && error.code === 'twitch_required') onNeedSignIn(true)
      onStatus('Your rating didn’t save. Try again.')
    } finally {
      setPending(undefined)
      setBusy(false)
    }
  }
  return (
    <div className="mw-rating">
      <span id="real-q" className="mw-rating-q">Real moment?</span>
      <span className="nc-split" role="group" aria-labelledby="real-q" aria-busy={busy}>
        <button type="button" aria-pressed={mine === 'real'} disabled={busy} onClick={() => void press('real')}>
          <ThumbsUp size={16} aria-hidden="true" />
          Yes
        </button>
        <button type="button" aria-pressed={mine === 'not_real'} disabled={busy} onClick={() => void press('not_real')}>
          <ThumbsDown size={16} aria-hidden="true" />
          No
        </button>
      </span>
      <span className="nc-muted mw-rating-tally">{ratingTallyText(feedback.ratings)}</span>
    </div>
  )
}
