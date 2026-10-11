import { useRef, type CSSProperties } from 'react'
import {
  LIVE_HEAT_COLLECTING_LABEL,
  displayMomentReasonLabel,
  momentClockDisplay,
  reactionAnalyticalOffset,
  type LiveHeatPoint,
} from '@streampulse/pulse-core'
import { MomentCardSlot } from './MomentCardSlot.tsx'
import { PulseEmoteImg } from './PulseEmoteImg.tsx'
import { SelectedMomentCard } from './SelectedMomentCard.tsx'
import { formatMomentMetricsLine } from './momentActivity.ts'
import { momentReasonLabelStyle } from './momentReasonStyles.ts'
import { liveHeatPointKey } from './mostReacted.ts'
import { prefersReducedMotion } from './motion/useSmoothedScalar.ts'
import { usePinnedCardHold } from './pinnedCardExit.ts'
import { theme } from './theme.ts'

/**
 * The selected-moment card a list opens directly under the row picked in it.
 * Rows above never move and the row stays under the pointer; only the rows
 * below slide down.
 */
export interface PulseMomentRowCard {
  open: boolean
  jumpLabel?: string
  onJump: (point: LiveHeatPoint) => void
  onAnalytics: (point: LiveHeatPoint) => void
  onClose: () => void
}

/**
 * A list row's React key. Alone in its minute bucket, a moment is keyed by the
 * bucket, which a refinement poll leaves alone. Sharing it (two refined moments
 * can), it is keyed by its full identity instead, so a poll can remount its row
 * but never hand the row, its focus and its card to the other moment.
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
  card?: PulseMomentRowCard
}

export function PulseMomentRow({
  point,
  backendUrl,
  selected,
  onSelect,
  onHighlight,
  card,
}: PulseMomentRowProps) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  // Each row holds its own card, so moving the card to another row closes
  // this one the same way the ✕ does.
  const cardHold = usePinnedCardHold(card?.open || null, prefersReducedMotion())
  const clock = momentClockDisplay(point)
  const offsetLabel = clock.text
  const analyticalOffset = reactionAnalyticalOffset(point)
  const collecting = point.collecting
  const body = (
    <div
      className={
        collecting
          ? undefined
          : `pulse-moment-row${selected && !collecting ? ' pulse-moment-row-selected' : ''}`
      }
      style={{
        ...styles.momentRow,
        ...(collecting ? styles.momentRowCollecting : {}),
        ...(selected && !collecting ? styles.momentRowSelected : {}),
      }}
    >
      {!collecting ? (
        <span
          // Colour lives in CSS so hover can ease it; an inline background here
          // would outrank the stylesheet and snap.
          className={`pulse-moment-accent${selected ? ' pulse-moment-accent-selected' : ''}`}
          style={styles.momentAccent}
          aria-hidden="true"
        />
      ) : null}
      <div style={styles.momentRowInner}>
        <div style={styles.momentMain}>
          <span style={styles.momentTitleRow}>
            <span style={styles.offsetLabel}>{offsetLabel}</span>
            {collecting ? (
              <span style={styles.collectingBadge}>{LIVE_HEAT_COLLECTING_LABEL}</span>
            ) : (
              <span style={momentReasonLabelStyle(point.reason, point.reasonLabel)}>
                {displayMomentReasonLabel(point.reason, point.reasonLabel)}
              </span>
            )}
          </span>
          <span style={styles.countsLine}>
            {collecting ? 'Collecting minute rollup…' : formatMomentMetricsLine(point)}
          </span>
        </div>
        {point.topEmotes.length > 0 ? (
          <div style={styles.emoteStack}>
            {point.topEmotes.slice(0, 3).map(emote => (
              <span key={emote.key} style={styles.emoteItem} aria-label={emote.name}>
                <PulseEmoteImg
                  emote={emote}
                  backendUrl={backendUrl}
                  width={20}
                  height={20}
                  style={styles.emoteImg}
                  showHoverPreview={!collecting}
                />
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )

  if (collecting) {
    return body
  }

  // Closing hands focus back to the row instead of dropping it with the card.
  // A row listed past the fold only for its card leaves with it; focus then
  // moves on to what follows the list, its Show more control.
  const close = (): void => {
    const row = buttonRef.current!
    const list = row.parentElement!.parentElement!
    row.focus()
    card?.onClose()
    setTimeout(() => { if (!row.isConnected) (list.nextElementSibling as HTMLElement | null)?.focus() })
  }

  // One wrapper per row keeps the card's slot out of the list's gapped grid,
  // and keeps the row button mounted (and focused) when its card opens.
  return (
    <div onKeyDown={event => { if (event.key === 'Escape' && card?.open) close() }}>
      <button
        ref={buttonRef}
        type="button"
        className="pulse-moment-row-button"
        style={styles.momentButton}
        // Selecting a moment row pins the chart bucket, so the row belongs to the
        // chart even though it sits outside the plot boundary. Without this marker
        // the chart's document-level pointerdown clears the current inspector
        // first; removing that card shifts this row before pointer-up and the
        // browser never dispatches the click, losing the selection entirely.
        data-chart-action="true"
        // Focus stays on the row, so keyboard users keep their place.
        onClick={() => onSelect(point)}
        onMouseEnter={() => onHighlight(analyticalOffset)}
        onMouseLeave={() => onHighlight(null)}
        onFocus={() => onHighlight(analyticalOffset)}
        onBlur={() => onHighlight(null)}
        aria-pressed={selected}
        aria-expanded={card?.open}
        aria-label={`Select minute bucket ${offsetLabel}, ${formatMomentMetricsLine(point)}, ${point.reasonLabel}`}
      >
        {body}
      </button>
      {card && cardHold.point ? (
        // keepPressedInPlace knows this slot by its place, right after the row.
        <MomentCardSlot exiting={cardHold.exiting}>
          <div style={styles.cardGap}>
            <SelectedMomentCard
              point={point}
              backendUrl={backendUrl}
              compact
              jumpLabel={card.jumpLabel}
              onJump={card.onJump}
              onAnalytics={card.onAnalytics}
              onClear={close}
            />
          </div>
        </MomentCardSlot>
      ) : null}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  // The list's own row gap, inside the slot so it opens and closes with the card.
  cardGap: { paddingTop: 4 },
  momentButton: {
    background: 'transparent',
    border: 0,
    color: 'inherit',
    cursor: 'pointer',
    display: 'block',
    outline: 'none',
    padding: 0,
    textAlign: 'left',
    width: '100%',
  },
  // Transitions live with the hover rule in theme.ts so background, ring and
  // accent stay on one timing.
  momentRow: {
    alignItems: 'stretch',
    borderRadius: 6,
    display: 'flex',
    gap: 8,
    padding: '6px 8px',
  },
  momentRowSelected: { background: 'rgba(255, 255, 255, 0.04)' },
  momentRowCollecting: {
    background: 'rgba(255, 255, 255, 0.02)',
    opacity: 0.6,
  },
  momentAccent: {
    borderRadius: 999,
    flexShrink: 0,
    width: 2,
  },
  momentRowInner: {
    alignItems: 'center',
    display: 'flex',
    flex: 1,
    gap: 10,
    justifyContent: 'space-between',
    minWidth: 0,
  },
  momentMain: { display: 'grid', flex: 1, gap: 2, minWidth: 0 },
  momentTitleRow: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 6 },
  offsetLabel: {
    color: theme.textPrimary,
    fontSize: 11,
    fontWeight: 800,
    fontVariantNumeric: 'tabular-nums',
  },
  countsLine: { color: theme.textMuted, fontSize: 10, fontWeight: 600 },
  collectingBadge: {
    background: 'rgba(245, 158, 11, 0.1)',
    border: '1px solid rgba(245, 158, 11, 0.3)',
    borderRadius: 999,
    color: '#fde68a',
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: '0.04em',
    padding: '2px 8px',
    textTransform: 'uppercase',
  },
  emoteStack: { alignItems: 'center', display: 'flex', flexShrink: 0, gap: 4 },
  emoteItem: { alignItems: 'center', display: 'inline-flex', lineHeight: 0 },
  emoteImg: { display: 'block', height: 20, objectFit: 'contain', width: 20 },
}
