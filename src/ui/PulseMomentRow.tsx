import { useLayoutEffect, useRef, type CSSProperties } from 'react'
import {
  LIVE_HEAT_COLLECTING_LABEL,
  displayMomentReasonLabel,
  formatMomentClock,
  momentClockDisplay,
  reactionAnalyticalOffset,
  type LiveHeatPoint,
} from '@streampulse/pulse-core'
import { PulseEmoteImg } from './PulseEmoteImg.tsx'
import { BookmarkGlyph, useMomentBookmarks } from './momentBookmarks.tsx'
import { formatMomentMetricsLine, momentMetricsParts } from './momentActivity.ts'
import { momentPictureView, useMomentPicture } from './momentPicture.ts'
import { momentReasonLabelStyle } from './momentReasonStyles.ts'
import { liveHeatPointKey } from './mostReacted.ts'
import { MomentTime, momentEdgeLabel } from './MomentTime.tsx'

/**
 * A list row's React key. Alone in its minute bucket, a moment is keyed by the
 * bucket, which a refinement poll leaves alone. Sharing it (two refined moments
 * can), it is keyed by its full identity instead, so a poll can remount its row
 * but never hand the row and its focus to the other moment.
 */
export function momentRowKey(point: LiveHeatPoint, points: LiveHeatPoint[]): string {
  return points.filter(other => other.offsetSeconds === point.offsetSeconds)[1]
    ? liveHeatPointKey(undefined, point)
    : `${point.offsetSeconds}`
}

export interface PulseMomentRowProps {
  point: LiveHeatPoint
  backendUrl: string
  selected: boolean
  onSelect: (point: LiveHeatPoint) => void
  onHighlight: (offsetSeconds: number | null) => void
  /** Id of the card above the list that shows the moment a row picks. */
  controls?: string
  /** The row's picture is the exact frame from the VOD's video, when this tab has no frame of it. */
  exact?: boolean
}

export function PulseMomentRow({
  point,
  backendUrl,
  selected,
  onSelect,
  onHighlight,
  controls,
  exact,
}: PulseMomentRowProps) {
  const clock = momentClockDisplay(point)
  const reason = displayMomentReasonLabel(point.reason, point.reasonLabel)
  const edge = momentEdgeLabel(point)
  const analyticalOffset = reactionAnalyticalOffset(point)
  const collecting = point.collecting
  // Viewers first when known, then the rates (chat/min, emotes/min).
  const counts = momentMetricsParts(point)
  const viewers = !counts[0]!.includes('/') && counts.shift()
  const bookmarks = useMomentBookmarks()
  const saved = !collecting && bookmarks?.canSave === true && bookmarks.savedFor({ kind: 'moment', offsetSeconds: analyticalOffset }) != null
  const ref = useRef<HTMLButtonElement>(null)
  const thumbRef = useMomentPicture<HTMLSpanElement>(collecting ? undefined : momentPictureView('thumb', point, exact))
  // A row that leaves the list while focused (a poll ranks it past the fold,
  // or the pick it was listed for is cleared) hands focus on to what follows
  // the list, its Show more control, instead of dropping it.
  useLayoutEffect(() => {
    const button = ref.current
    return () => {
      if (button && (button.getRootNode() as Document).activeElement === button) {
        (button.parentElement!.nextElementSibling as HTMLElement | null)?.focus()
      }
    }
  }, [])
  const body = (
    <div
      // The selected background comes from .pulse-moment-row-selected, whose
      // !important rule always beat the old inline one.
      className={
        collecting
          ? 'pulse-mr pulse-mr-collecting'
          : `pulse-moment-row pulse-mr${selected && !collecting ? ' pulse-moment-row-selected' : ''}`
      }
    >
      {!collecting ? (
        <span
          // Colour lives in CSS so hover can ease it; an inline background here
          // would outrank the stylesheet and snap.
          className={`pulse-moment-accent pulse-mr-accent${selected ? ' pulse-moment-accent-selected' : ''}`}
          aria-hidden="true"
        />
      ) : null}
      {!collecting ? (
        // Filled by the moment-pictures script, and hidden until the list has
        // a picture to show (its stylesheet overrides this display).
        <span ref={thumbRef} className="pmf-thumb pulse-mr-thumb" aria-hidden="true" />
      ) : null}
      <div className="pulse-mr-inner">
        <div className="pulse-mr-main">
          <span className="pulse-mr-title-row">
            <span className="pulse-mr-offset"><MomentTime text={clock.text} about={clock.approximate} /></span>
            {collecting ? (
              <span className="pulse-mr-collecting-badge">{LIVE_HEAT_COLLECTING_LABEL}</span>
            ) : (
              <span style={momentReasonLabelStyle(point.reason, point.reasonLabel)}>{reason}</span>
            )}
            {edge && !collecting ? <span className="pulse-edge-tag">{edge}</span> : null}
          </span>
          {/* One line: when the figures don't fit, the viewer figure drops first (item 4), then the rate the reason doesn't name. */}
          <span className="pulse-mr-counts" data-reason={point.reason}>
            <span>{!collecting && viewers}</span>
            <span className="pulse-mr-rates">{collecting ? 'Counting this minute…' : counts.map(part => <span key={part}>{part}</span>)}</span>
          </span>
        </div>
        {point.topEmotes.length > 0 || saved ? (
          <div className="pulse-mr-emotes">
            {point.topEmotes.slice(0, 3).map(emote => (
              <span key={emote.key} className="pulse-mr-emote" aria-label={emote.name}>
                <PulseEmoteImg
                  emote={emote}
                  backendUrl={backendUrl}
                  width={20}
                  height={20}
                  style={emoteImgStyle}
                  showHoverPreview={!collecting}
                />
              </span>
            ))}
            {saved ? (
              <span className="pulse-row-bookmark" data-moment-row-saved="true" title="Bookmarked">
                <BookmarkGlyph filled size={14} />
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )

  if (collecting) {
    return body
  }

  return (
    <button
      ref={ref}
      type="button"
      className="pulse-moment-row-button pulse-mr-button"
      // Selecting a moment row pins the chart bucket, so the row belongs to the
      // chart even though it sits outside the plot boundary. Without this marker
      // the chart's document-level pointerdown clears the current inspector
      // first; removing that card shifts this row before pointer-up and the
      // browser never dispatches the click, losing the selection entirely.
      data-chart-action="true"
      // A pick by keyboard moves focus to the card's Jump; Escape there
      // brings it back to the row (J1). A pointer pick leaves focus alone.
      onClick={event => {
        onSelect(point)
        if (!event.detail && !selected) {
          requestAnimationFrame(() => ref.current?.parentElement?.parentElement?.querySelector<HTMLElement>('[data-moment-inspector-action="jump"]')?.focus())
        }
      }}
      onMouseEnter={() => onHighlight(analyticalOffset)}
      onMouseLeave={() => onHighlight(null)}
      onFocus={() => onHighlight(analyticalOffset)}
      onBlur={() => onHighlight(null)}
      aria-pressed={selected}
      aria-controls={controls}
      aria-label={`${formatMomentClock(point)}, ${reason}${edge ? `, ${edge}` : ''}, ${formatMomentMetricsLine(point)}${saved ? ', bookmarked' : ''}`}
    >
      {body}
    </button>
  )
}

/** Passed on to PulseEmoteImg, which takes a style prop. */
const emoteImgStyle: CSSProperties = { display: 'block', height: 20, objectFit: 'contain', width: 20 }
