import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { formatHeatOffset } from '@streamclone/pulse-core'
import { hasMeaningfulGameSegments, normalizeGameSegments } from '@streamclone/pulse-charts'
import type { ExtensionGameSegment } from '../shared/messages.ts'
import { theme } from './theme.ts'

export interface GamesPlayedStripProps {
  games?: ExtensionGameSegment[]
  durationSeconds: number
}

const CARD_WIDTH = 104

function formatStreamDuration(durationSeconds: number): string {
  const total = Math.round(durationSeconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m`
  return `${total}s`
}

export function GamesPlayedStrip({ games, durationSeconds }: GamesPlayedStripProps) {
  const segments = useMemo(
    () => normalizeGameSegments(games ?? [], durationSeconds),
    [games, durationSeconds],
  )
  const trackRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const updateScrollState = useCallback(() => {
    const track = trackRef.current
    if (!track) return
    const maxScroll = track.scrollWidth - track.clientWidth
    setCanScrollLeft(track.scrollLeft > 2)
    setCanScrollRight(maxScroll - track.scrollLeft > 2)
  }, [])

  useEffect(() => {
    updateScrollState()
    const track = trackRef.current
    if (!track) return
    track.addEventListener('scroll', updateScrollState, { passive: true })
    const observer = new ResizeObserver(updateScrollState)
    observer.observe(track)
    return () => {
      track.removeEventListener('scroll', updateScrollState)
      observer.disconnect()
    }
  }, [segments, updateScrollState])

  if (!hasMeaningfulGameSegments(segments, durationSeconds)) return null

  function scrollGames(direction: -1 | 1): void {
    const track = trackRef.current
    if (!track) return
    const step = Math.max(CARD_WIDTH + 5, Math.floor(track.clientWidth * 0.85))
    track.scrollBy({ left: direction * step, behavior: 'smooth' })
  }

  const showNav = segments.length > 1

  return (
    <div style={styles.gamesStrip} aria-label="Games played">
      <div style={styles.headerRow}>
        <span style={styles.gamesLabel}>Games played</span>
        {showNav ? (
          <span style={styles.countBadge}>{segments.length}</span>
        ) : null}
      </div>
      <div
        style={{
          ...styles.carouselRow,
          ...(showNav ? null : { gridTemplateColumns: '1fr' }),
        }}
      >
        {showNav ? (
          <button
            type="button"
            style={{
              ...styles.navButton,
              ...(canScrollLeft ? null : styles.navButtonDisabled),
            }}
            disabled={!canScrollLeft}
            aria-label="Previous games"
            onClick={() => scrollGames(-1)}
          >
            ‹
          </button>
        ) : null}
        <div ref={trackRef} className="pulse-no-scrollbar" style={styles.track}>
          {segments.map((segment, index) => (
            <span
              key={`${segment.gameName}-${segment.offsetSeconds}-${index}`}
              style={styles.gameCard}
              title={`${segment.gameName} · ${formatHeatOffset(segment.offsetSeconds)} · ${formatStreamDuration(segment.durationSeconds)}`}
            >
              <span style={styles.gameName}>{segment.gameName}</span>
              <span style={styles.gameMeta}>
                <span style={styles.gameStart}>{formatHeatOffset(segment.offsetSeconds)}</span>
                <span style={styles.gameMetaSep} aria-hidden="true">
                  ·
                </span>
                <span style={styles.gameDuration}>
                  {formatStreamDuration(segment.durationSeconds)}
                </span>
              </span>
            </span>
          ))}
        </div>
        {showNav ? (
          <button
            type="button"
            style={{
              ...styles.navButton,
              ...(canScrollRight ? null : styles.navButtonDisabled),
            }}
            disabled={!canScrollRight}
            aria-label="Next games"
            onClick={() => scrollGames(1)}
          >
            ›
          </button>
        ) : null}
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
  carouselRow: {
    alignItems: 'stretch',
    display: 'grid',
    gap: 4,
    gridTemplateColumns: 'auto 1fr auto',
    minWidth: 0,
  },
  navButton: {
    alignSelf: 'center',
    background: 'rgba(255, 255, 255, 0.04)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: 6,
    color: theme.textPrimary,
    cursor: 'pointer',
    flexShrink: 0,
    fontSize: 14,
    fontWeight: 900,
    height: 44,
    lineHeight: 1,
    padding: 0,
    width: 18,
  },
  navButtonDisabled: {
    color: theme.textMuted,
    cursor: 'default',
    opacity: 0.35,
  },
  track: {
    display: 'flex',
    flexWrap: 'nowrap',
    gap: 5,
    minWidth: 0,
    overflowX: 'auto',
    overflowY: 'hidden',
    scrollSnapType: 'x proximity',
    WebkitOverflowScrolling: 'touch',
  },
  gameCard: {
    background: 'rgba(249, 115, 22, 0.05)',
    border: '1px solid rgba(249, 115, 22, 0.32)',
    borderRadius: 8,
    display: 'grid',
    flex: `0 0 ${CARD_WIDTH}px`,
    gap: 2,
    minHeight: 44,
    padding: '5px 8px',
    scrollSnapAlign: 'start',
    width: CARD_WIDTH,
  },
  gameName: {
    color: '#fdba74',
    fontSize: 9,
    fontWeight: 800,
    lineHeight: 1.25,
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
    gap: 3,
    minWidth: 0,
  },
  gameStart: {
    color: theme.textSecondary,
    flexShrink: 0,
    fontWeight: 700,
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
