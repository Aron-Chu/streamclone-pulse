import type { CSSProperties } from 'react'
import {
  LIVE_HEAT_COLLECTING_LABEL,
  displayMomentReasonLabel,
  formatHeatOffset,
  type LiveHeatPoint,
} from '@streampulse/pulse-core'
import { PulseEmoteImg } from './PulseEmoteImg.tsx'
import { formatMomentMetricsLine } from './momentActivity.ts'
import { momentReasonLabelStyle } from './momentReasonStyles.ts'
import { theme } from './theme.ts'

export interface PulseMomentRowProps {
  point: LiveHeatPoint
  backendUrl: string
  selected: boolean
  onSelect: (point: LiveHeatPoint) => void
  onHighlight: (offsetSeconds: number | null) => void
  scrollRef?: (node: HTMLDivElement | null) => void
}

export function PulseMomentRow({
  point,
  backendUrl,
  selected,
  onSelect,
  onHighlight,
  scrollRef,
}: PulseMomentRowProps) {
  const offsetLabel = formatHeatOffset(point.offsetSeconds)
  const collecting = point.collecting
  const body = (
    <div
      ref={scrollRef}
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
          style={{
            ...styles.momentAccent,
            ...(selected ? styles.momentAccentSelected : {}),
          }}
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
              <span key={emote.key} style={styles.emoteItem} title={emote.name}>
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

  return (
    <button
      type="button"
      className="pulse-moment-row-button"
      style={styles.momentButton}
      onClick={event => {
        onSelect(point)
        event.currentTarget.blur()
      }}
      onMouseEnter={() => onHighlight(point.offsetSeconds)}
      onMouseLeave={() => onHighlight(null)}
      onFocus={() => onHighlight(point.offsetSeconds)}
      onBlur={() => onHighlight(null)}
      aria-pressed={selected}
      aria-label={`Select ${offsetLabel}, ${formatMomentMetricsLine(point)}, ${point.reasonLabel}`}
    >
      {body}
    </button>
  )
}

const styles: Record<string, CSSProperties> = {
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
  momentRow: {
    alignItems: 'stretch',
    borderRadius: 6,
    display: 'flex',
    gap: 8,
    padding: '6px 8px',
    transition: 'background 0.15s ease',
  },
  momentRowSelected: { background: theme.hoverFill },
  momentRowCollecting: {
    background: theme.hoverFill,
    opacity: 0.6,
  },
  momentAccent: {
    background: theme.border,
    borderRadius: 999,
    flexShrink: 0,
    width: 2,
  },
  momentAccentSelected: { background: theme.accent },
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
    background: theme.statusWarnBg,
    border: `1px solid ${theme.statusWarnBorder}`,
    borderRadius: 999,
    color: theme.statusWarnText,
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
