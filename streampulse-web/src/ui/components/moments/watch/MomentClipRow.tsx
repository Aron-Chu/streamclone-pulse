import type { WindowClip } from '../../../../lib/momentFeedback'
import { formatClock } from '../../clips/NativeClipParts'
import './moment-watch.css'

/** One Twitch clip of the page's window: its length (m:ss, as on the Clips tab) and where it sits in the stream. No rating of its own. */
export function MomentClipRow({ clip, label }: {
  clip: WindowClip
  /** The page's "0:40:22" for an instant, in ms. */
  label: (ms: number) => string
}) {
  return (
    <div className="mw-clip-row">
      <span className="mw-rating-q">Twitch clip</span>
      <span className="nc-muted">{formatClock(clip.durationSeconds)} · {label(Date.parse(clip.from))} to {label(Date.parse(clip.to))}</span>
    </div>
  )
}
