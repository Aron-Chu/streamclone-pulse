import { useMemo, type CSSProperties } from 'react'
import { formatHeatOffset } from '@streampulse/pulse-core'
import {
  buildGamesPlayedTimelineSlots,
  gameSegmentKey,
  hasMeaningfulGameSegments,
  normalizeGameSegments,
  resolveGamesPlayedTimelineRange,
} from '@streampulse/pulse-charts'
import type { ExtensionGameSegment } from '../shared/messages.ts'
import { theme } from './theme.ts'

export interface GamesPlayedVisibleRange {
  startOffset: number
  endOffset: number
}

export interface GamesPlayedStripProps {
  games?: ExtensionGameSegment[]
  durationSeconds: number
  highlightedKey?: string | null
  onHighlightKey?: (key: string | null) => void
  visibleRange?: GamesPlayedVisibleRange | null
  /** Match overview chart plot insets when provided. */
  plotPadLeft?: number
  plotPadRight?: number
}

function formatStreamDuration(durationSeconds: number): string {
  const total = Math.round(durationSeconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m`
  return `${total}s`
}

function formatWindowLabel(startOffset: number, endOffset: number): string {
  const span = Math.max(0, endOffset - startOffset)
  return `${formatHeatOffset(startOffset)}–${formatHeatOffset(endOffset)} · ${formatStreamDuration(span)}`
}

/** Full-width proportional Games played bar aligned to the overview chart window. */
export function GamesPlayedStrip({
  games,
  durationSeconds,
  highlightedKey = null,
  onHighlightKey,
  visibleRange = null,
  plotPadLeft = 0,
  plotPadRight = 0,
}: GamesPlayedStripProps) {
  const segments = useMemo(
    () => normalizeGameSegments(games ?? [], durationSeconds),
    [games, durationSeconds],
  )

  const timelineRange = useMemo(
    () => resolveGamesPlayedTimelineRange(visibleRange, durationSeconds, segments),
    [durationSeconds, segments, visibleRange],
  )

  const slots = useMemo(() => {
    if (!timelineRange) return []
    return buildGamesPlayedTimelineSlots(segments, timelineRange)
  }, [segments, timelineRange])

  if (!hasMeaningfulGameSegments(segments, durationSeconds) || !timelineRange || slots.length === 0) {
    return null
  }

  function handleStripLeave(): void {
    onHighlightKey?.(null)
  }

  return (
    <div
      style={styles.gamesStrip}
      aria-label="Games played"
      onPointerLeave={handleStripLeave}
    >
      <div style={styles.headerRow}>
        <span style={styles.gamesLabel}>Games played</span>
        {segments.length > 1 ? (
          <span style={styles.countBadge}>{segments.length}</span>
        ) : null}
      </div>
      <div
        style={{
          ...styles.timelinePad,
          paddingLeft: plotPadLeft,
          paddingRight: plotPadRight,
        }}
        data-games-timeline
        data-timeline-start={timelineRange.startOffset}
        data-timeline-end={timelineRange.endOffset}
      >
        <div style={styles.timelineTrack} role="list">
          {slots.map((slot, index) => {
            if (slot.kind === 'gap') {
              return (
                <div
                  key={`gap-${slot.startOffset}-${index}`}
                  role="presentation"
                  aria-hidden="true"
                  style={{ ...styles.gap, flexGrow: slot.flexGrow }}
                />
              )
            }

            const { segment } = slot
            const key = gameSegmentKey(segment)
            const isHighlighted = highlightedKey === key
            const title = `${segment.gameName} · ${formatWindowLabel(slot.visibleStart, slot.visibleEnd)}${
              slot.clipped ? ' · clipped to chart' : ''
            }`
            const cardStyle: CSSProperties = {
              ...styles.gameCard,
              flexGrow: slot.flexGrow,
              ...(slot.clipped ? styles.gameCardClipped : null),
              ...(isHighlighted ? styles.gameCardActive : null),
            }

            return (
              <button
                key={`${segment.gameName}-${segment.offsetSeconds}-${index}`}
                type="button"
                role="listitem"
                style={cardStyle}
                title={title}
                aria-label={title}
                onPointerEnter={() => onHighlightKey?.(key)}
                onFocus={() => onHighlightKey?.(key)}
                onBlur={() => onHighlightKey?.(null)}
              >
                <span style={styles.gameName}>{segment.gameName}</span>
                <span style={styles.gameMeta}>
                  <span style={styles.gameStart}>{formatHeatOffset(slot.visibleStart)}</span>
                  <span style={styles.gameMetaSep} aria-hidden="true">
                    –
                  </span>
                  <span style={styles.gameDuration}>{formatHeatOffset(slot.visibleEnd)}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  gamesStrip: { display: 'grid', gap: 3, marginBottom: 2 },
  headerRow: {
    alignItems: 'center',
    display: 'flex',
    gap: 6,
    justifyContent: 'space-between',
  },
  gamesLabel: {
    color: theme.textMuted,
    fontSize: 9,
    fontWeight: 800,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  countBadge: {
    background: 'rgba(249, 115, 22, 0.1)',
    border: '1px solid rgba(249, 115, 22, 0.22)',
    borderRadius: 999,
    color: '#fdba74',
    fontSize: 9,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 800,
    lineHeight: 1,
    padding: '3px 7px',
  },
  timelinePad: {
    minWidth: 0,
  },
  timelineTrack: {
    alignItems: 'stretch',
    display: 'flex',
    gap: 2,
    minHeight: 44,
    minWidth: 0,
    width: '100%',
  },
  gap: {
    background: 'rgba(255, 255, 255, 0.02)',
    borderRadius: 4,
    flexBasis: 0,
    minWidth: 0,
  },
  gameCard: {
    alignItems: 'center',
    background: 'rgba(249, 115, 22, 0.07)',
    border: '1px solid rgba(249, 115, 22, 0.32)',
    borderRadius: 8,
    cursor: 'pointer',
    display: 'flex',
    flexBasis: 0,
    flexDirection: 'column',
    gap: 2,
    justifyContent: 'center',
    minWidth: 0,
    outline: 'none',
    overflow: 'hidden',
    padding: '5px 6px',
    textAlign: 'center',
  },
  gameCardClipped: {
    borderStyle: 'dashed',
  },
  gameCardActive: {
    background: 'rgba(249, 115, 22, 0.22)',
    border: '1px solid rgba(249, 115, 22, 0.85)',
    boxShadow: '0 0 0 1px rgba(249, 115, 22, 0.35)',
  },
  gameName: {
    color: '#fdba74',
    fontSize: 9,
    fontWeight: 800,
    lineHeight: 1.25,
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  gameMeta: {
    alignItems: 'center',
    color: theme.textMuted,
    display: 'flex',
    fontSize: 8,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 600,
    gap: 2,
    maxWidth: '100%',
    minWidth: 0,
  },
  gameStart: {
    color: theme.textSecondary,
    flexShrink: 1,
    fontWeight: 700,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  gameMetaSep: { flexShrink: 0, opacity: 0.65 },
  gameDuration: {
    flexShrink: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
}
