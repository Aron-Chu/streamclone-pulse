import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
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
import { isRenderableGameName } from './extensionChartAdapter.ts'

export { isRenderableGameName } from './extensionChartAdapter.ts'

export const GAMES_PLAYED_ICON_SIZE_PX = 64
export const GAMES_PLAYED_ART_WIDTH_PX = 46
export const GAMES_PLAYED_HIT_TARGET_PX = 52
export const GAMES_PLAYED_HIT_TARGET_HEIGHT_PX = 70
export const GAMES_PLAYED_CHIP_WIDTH_PX = GAMES_PLAYED_HIT_TARGET_PX
/** Compatibility name retained for existing layout tests and consumers. */
export const GAMES_PLAYED_CHIP_MIN_WIDTH_PX = GAMES_PLAYED_HIT_TARGET_PX

const CHIP_GAP_PX = 8
const CHIP_STEP_PX = GAMES_PLAYED_HIT_TARGET_PX + CHIP_GAP_PX
const SCROLL_EDGE_EPSILON_PX = 0.5
const GAME_ART_PATH = /^\/ttv-boxart\/\d+(?:_IGDB)?-\d+x\d+\.(?:jpe?g|png)$/i
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => (
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  ))

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(mediaQuery.matches)
    onChange()
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', onChange)
      return () => mediaQuery.removeEventListener('change', onChange)
    }
    mediaQuery.addListener(onChange)
    return () => mediaQuery.removeListener(onChange)
  }, [])

  return reduced
}

export interface GamesPlayedVisibleRange {
  startOffset: number
  endOffset: number
}

export interface GamesPlayedScrollState {
  maxScroll: number
  canScrollLeft: boolean
  canScrollRight: boolean
  visibleStart: number
  visibleEnd: number
}

export interface GamesPlayedStripProps {
  games?: ExtensionGameSegment[]
  activationKey?: string | null
  streamId?: string | null
  durationSeconds: number
  highlightedKey?: string | null
  onHighlightKey?: (key: string | null) => void
  onSelectKey?: (key: string | null) => void
  visibleRange?: GamesPlayedVisibleRange | null
  plotPadLeft?: number
  plotPadRight?: number
}

export const GAMES_PLAYED_HEADER_LAYOUT = {
  headerRow: { alignItems: 'center', display: 'flex', gap: 6, minWidth: 0, width: '100%' },
  gamesLabelShell: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden' },
  headerTrail: { flexShrink: 0, marginLeft: 'auto' },
} as const satisfies Record<string, CSSProperties>

export function resolveGamesPlayedActivationKey(
  activationKey: string | null | undefined,
  streamId: string | null | undefined,
): string | null {
  return activationKey === undefined ? streamId ?? null : activationKey
}

export function resolveGamesPlayedScrollState(
  scrollLeft: number,
  scrollWidth: number,
  clientWidth: number,
  totalItems: number,
): GamesPlayedScrollState {
  const maxScroll = Math.max(0, (Number.isFinite(scrollWidth) ? scrollWidth : 0) - (Number.isFinite(clientWidth) ? clientWidth : 0))
  const left = Math.max(0, Math.min(maxScroll, Number.isFinite(scrollLeft) ? scrollLeft : 0))
  const visibleApprox = Math.max(1, Math.floor((Math.max(0, clientWidth - 6) + CHIP_GAP_PX) / CHIP_STEP_PX))
  const first = Math.max(0, Math.min(Math.max(0, totalItems - 1), Math.floor(left / CHIP_STEP_PX)))
  const visibleStart = maxScroll - left <= SCROLL_EDGE_EPSILON_PX
    ? Math.max(0, totalItems - visibleApprox)
    : first
  const visibleEnd = Math.min(totalItems, visibleStart + visibleApprox)
  return {
    maxScroll,
    canScrollLeft: maxScroll > SCROLL_EDGE_EPSILON_PX && left > SCROLL_EDGE_EPSILON_PX,
    canScrollRight: maxScroll > SCROLL_EDGE_EPSILON_PX && maxScroll - left > SCROLL_EDGE_EPSILON_PX,
    visibleStart,
    visibleEnd,
  }
}

export function resolveGamesPlayedKeyboardTarget(key: string, currentIndex: number, totalItems: number): number | null {
  if (totalItems <= 0) return null
  const index = Math.max(0, Math.min(totalItems - 1, Math.trunc(currentIndex)))
  if (key === 'ArrowRight' || key === 'ArrowDown') return Math.min(totalItems - 1, index + 1)
  if (key === 'ArrowLeft' || key === 'ArrowUp') return Math.max(0, index - 1)
  if (key === 'Home') return 0
  if (key === 'End') return totalItems - 1
  return null
}

export function safeGameArtUrl(raw: string | undefined): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw)
    const hostname = url.hostname.toLowerCase()
    if (
      url.protocol !== 'https:'
      || url.host.toLowerCase() !== hostname
      || url.username
      || url.password
      || hostname !== 'static-cdn.jtvnw.net'
      || !GAME_ART_PATH.test(url.pathname)
    ) return null
    return url.toString()
  } catch {
    return null
  }
}

export function resolveGameArtCandidates(boxArtUrl: string | undefined, categoryId: string | undefined): string[] {
  const candidates: string[] = []
  const explicit = safeGameArtUrl(boxArtUrl)
  if (explicit) candidates.push(explicit)
  const id = categoryId?.trim()
  if (id && /^\d{1,20}$/.test(id)) {
    for (const suffix of ['144x192.jpg', '144x192.png']) {
      const candidate = `https://static-cdn.jtvnw.net/ttv-boxart/${id}-${suffix}`
      if (!candidates.includes(candidate)) candidates.push(candidate)
    }
    const igdb = `https://static-cdn.jtvnw.net/ttv-boxart/${id}_IGDB-144x192.jpg`
    if (!candidates.includes(igdb)) candidates.push(igdb)
  }
  return candidates
}

export function initialsForGame(gameName: string): string {
  const words = gameName.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase()
  return `${words[0]![0]}${words[words.length - 1]![0]}`.toUpperCase()
}

function formatStreamDuration(durationSeconds: number): string {
  const total = Math.max(0, Math.round(durationSeconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m`
  return `${total}s`
}

function formatWindowLabel(startOffset: number, endOffset: number): string {
  return `${formatHeatOffset(startOffset)}–${formatHeatOffset(endOffset)} · ${formatStreamDuration(endOffset - startOffset)}`
}

function GameArt({
  gameName,
  boxArtUrl,
  categoryId,
}: {
  gameName: string
  boxArtUrl?: string
  categoryId?: string
}) {
  const candidates = useMemo(() => resolveGameArtCandidates(boxArtUrl, categoryId), [boxArtUrl, categoryId])
  const [candidateIndex, setCandidateIndex] = useState(0)
  useEffect(() => setCandidateIndex(0), [candidates.join('\n')])
  const src = candidates[candidateIndex]
  if (!src) {
    return (
      <span data-game-art-fallback aria-hidden="true" style={styles.gameArtFallback}>
        {initialsForGame(gameName)}
      </span>
    )
  }
  return (
    <img
      data-game-art
      src={src}
      alt=""
      width={GAMES_PLAYED_ART_WIDTH_PX}
      height={GAMES_PLAYED_ICON_SIZE_PX}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      style={styles.gameArt}
      onError={() => setCandidateIndex(index => index + 1)}
    />
  )
}

export function GamesPlayedStrip({
  games,
  activationKey,
  streamId = null,
  durationSeconds,
  highlightedKey = null,
  onHighlightKey,
  onSelectKey,
  visibleRange = null,
  plotPadLeft = 0,
  plotPadRight = 0,
}: GamesPlayedStripProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [scrollState, setScrollState] = useState<GamesPlayedScrollState>({
    maxScroll: 0,
    canScrollLeft: false,
    canScrollRight: false,
    visibleStart: 0,
    visibleEnd: 1,
  })
  const reducedMotion = useReducedMotion()
  const resolvedActivationKey = resolveGamesPlayedActivationKey(activationKey, streamId)
  const segments = useMemo(
    () => normalizeGameSegments(
      (games ?? []).filter(game => isRenderableGameName(game.gameName)),
      durationSeconds,
    ),
    [games, durationSeconds],
  )
  const timelineRange = useMemo(
    () => resolveGamesPlayedTimelineRange(visibleRange, durationSeconds, segments),
    [durationSeconds, segments, visibleRange],
  )
  const gameSlots = useMemo(() => {
    if (!timelineRange) return []
    return buildGamesPlayedTimelineSlots(segments, timelineRange).filter(
      (slot): slot is Extract<typeof slot, { kind: 'segment' }> => slot.kind === 'segment',
    )
  }, [segments, timelineRange])

  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    let frame = 0
    const sync = () => {
      frame = 0
      const next = resolveGamesPlayedScrollState(track.scrollLeft, track.scrollWidth, track.clientWidth, gameSlots.length)
      setScrollState(current => current.maxScroll === next.maxScroll
        && current.canScrollLeft === next.canScrollLeft
        && current.canScrollRight === next.canScrollRight
        && current.visibleStart === next.visibleStart
        && current.visibleEnd === next.visibleEnd ? current : next)
    }
    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(sync)
    }
    const onWheel = (event: WheelEvent) => {
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      if (!delta || scrollState.maxScroll <= 0) return
      event.preventDefault()
      event.stopPropagation()
      track.scrollLeft = Math.max(0, Math.min(scrollState.maxScroll, track.scrollLeft + delta))
    }
    sync()
    track.addEventListener('scroll', schedule, { passive: true })
    track.addEventListener('wheel', onWheel, { passive: false })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    observer?.observe(track)
    return () => {
      track.removeEventListener('scroll', schedule)
      track.removeEventListener('wheel', onWheel)
      observer?.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [gameSlots.length, scrollState.maxScroll])

  useEffect(() => {
    trackRef.current?.scrollTo?.({ left: 0, behavior: 'auto' })
    setActiveKey(null)
    setSelectedKey(null)
    onSelectKey?.(null)
    onHighlightKey?.(null)
  }, [resolvedActivationKey])

  useEffect(() => {
    const validKeys = new Set(gameSlots.map(slot => gameSegmentKey(slot.segment)))
    if (selectedKey && !validKeys.has(selectedKey)) {
      setSelectedKey(null)
      onSelectKey?.(null)
    }
    if (activeKey && !validKeys.has(activeKey)) setActiveKey(null)
  }, [activeKey, gameSlots, onSelectKey, selectedKey])

  if (!hasMeaningfulGameSegments(segments, durationSeconds) || !timelineRange || gameSlots.length === 0) {
    return (
      <div data-games-played data-games-played-empty aria-label="Games played" style={styles.gamesEmpty}>
        <div data-games-played-header style={styles.headerRow}>
          <span data-games-played-label style={styles.gamesLabel}>Games played</span>
          <span data-games-played-count style={styles.gameCount}>Unavailable</span>
        </div>
        <p data-games-played-empty-copy style={styles.emptyCopy}>
          {segments.length > 0 ? 'Game metadata is unavailable for the visible stream.' : 'No game metadata is available for this stream yet.'}
        </p>
      </div>
    )
  }

  const displayedKey = activeKey ?? selectedKey
  const displayedSlot = displayedKey ? gameSlots.find(slot => gameSegmentKey(slot.segment) === displayedKey) : null
  const scrollBehavior = reducedMotion ? 'auto' : 'smooth'

  function scrollBy(direction: -1 | 1): void {
    const track = trackRef.current
    if (!track) return
    track.scrollTo({ left: Math.max(0, Math.min(scrollState.maxScroll, track.scrollLeft + direction * CHIP_STEP_PX)), behavior: scrollBehavior })
  }

  function focusItem(index: number): void {
    const items = Array.from(trackRef.current?.querySelectorAll<HTMLButtonElement>('[data-games-played-item]') ?? [])
    const next = items[Math.max(0, Math.min(items.length - 1, index))]
    next?.focus({ preventScroll: true })
  }

  function onItemKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    const next = resolveGamesPlayedKeyboardTarget(event.key, index, gameSlots.length)
    if (next == null) return
    event.preventDefault()
    focusItem(next)
  }

  return (
    <div
      ref={rootRef}
      data-games-played
      aria-label="Games played"
      style={styles.gamesStrip}
      onPointerLeave={() => {
        setActiveKey(null)
        onHighlightKey?.(selectedKey)
      }}
    >
      <div data-games-played-header style={styles.headerRow}>
        <span data-games-played-label style={styles.gamesLabelShell}>
          {displayedSlot ? (
            <>
              <strong style={styles.gamesLabelName}>{displayedSlot.segment.gameName}</strong>
              <span style={styles.gamesLabelMeta}>
                {formatWindowLabel(displayedSlot.visibleStart, displayedSlot.visibleEnd)}
                {selectedKey === displayedKey ? ' · pinned' : ''}
              </span>
            </>
          ) : <span style={styles.gamesLabel}>Games played</span>}
        </span>
        <span data-games-played-trail style={styles.headerTrail}>
          <span data-games-played-count style={styles.gameCount}>{gameSlots.length} {gameSlots.length === 1 ? 'game' : 'games'}</span>
          {scrollState.maxScroll > SCROLL_EDGE_EPSILON_PX ? (
            <span style={styles.headerNav} aria-label="Games played navigation">
              <button type="button" aria-label="Previous games" title="Previous games" disabled={!scrollState.canScrollLeft} style={{ ...styles.headerArrow, ...(!scrollState.canScrollLeft ? styles.disabled : null) }} onClick={() => scrollBy(-1)}>‹</button>
              <button type="button" aria-label="Next games" title="Next games" disabled={!scrollState.canScrollRight} style={{ ...styles.headerArrow, ...(!scrollState.canScrollRight ? styles.disabled : null) }} onClick={() => scrollBy(1)}>›</button>
            </span>
          ) : null}
        </span>
      </div>
      <div
        data-games-timeline
        data-timeline-start={timelineRange.startOffset}
        data-timeline-end={timelineRange.endOffset}
        style={{ ...styles.timelinePad, paddingLeft: plotPadLeft, paddingRight: plotPadRight }}
      >
        <div ref={trackRef} data-games-played-track className="pulse-no-scrollbar" role="list" tabIndex={-1} style={styles.timelineTrack}>
          {gameSlots.map((slot, index) => {
            const key = gameSegmentKey(slot.segment)
            const selected = selectedKey === key
            const highlighted = highlightedKey === key || selected
            const title = `${slot.segment.gameName} · ${formatWindowLabel(slot.visibleStart, slot.visibleEnd)}${slot.clipped ? ' · clipped to chart' : ''}`
            return (
              <div key={`${key}-${index}`} role="listitem" style={styles.item}>
                <button
                  type="button"
                  data-games-played-item
                  data-game-key={key}
                  data-game-name={slot.segment.gameName}
                  data-game-offset={slot.segment.offsetSeconds}
                  aria-label={title}
                  aria-pressed={selected}
                  title={title}
                  style={{ ...styles.gameCard, ...(slot.clipped ? styles.clipped : null), ...(highlighted ? styles.active : null) }}
                  onPointerEnter={() => {
                    setActiveKey(key)
                    onHighlightKey?.(key)
                  }}
                  onFocus={() => {
                    setActiveKey(key)
                    onHighlightKey?.(key)
                  }}
                  onPointerLeave={() => {
                    setActiveKey(current => current === key ? null : current)
                    onHighlightKey?.(selectedKey)
                  }}
                  onBlur={event => {
                    if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return
                    setActiveKey(current => current === key ? null : current)
                    onHighlightKey?.(selectedKey)
                  }}
                  onClick={() => {
                    const next = selected ? null : key
                    setSelectedKey(next)
                    onSelectKey?.(next)
                    onHighlightKey?.(next)
                  }}
                  onKeyDown={event => onItemKeyDown(event, index)}
                >
                  <GameArt gameName={slot.segment.gameName} boxArtUrl={slot.segment.boxArtUrl} categoryId={slot.segment.categoryId} />
                  {activeKey === key || selected ? <span aria-hidden="true" style={styles.gameCardName}>{slot.segment.gameName}</span> : null}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  gamesStrip: { display: 'grid', gap: 4, marginBottom: 2, minWidth: 0, width: '100%' },
  gamesEmpty: { display: 'grid', gap: 4, marginBottom: 2, minWidth: 0, width: '100%' },
  headerRow: { ...GAMES_PLAYED_HEADER_LAYOUT.headerRow },
  gamesLabelShell: { alignItems: 'baseline', display: 'flex', gap: 6, ...GAMES_PLAYED_HEADER_LAYOUT.gamesLabelShell },
  gamesLabelName: { color: theme.textPrimary, flex: '0 1 auto', fontSize: 10, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  gamesLabelMeta: { color: theme.textMuted, flexShrink: 0, fontSize: 9, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  gamesLabel: { color: theme.textMuted, fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase' },
  headerTrail: { alignItems: 'center', display: 'flex', gap: 6, minWidth: 0, ...GAMES_PLAYED_HEADER_LAYOUT.headerTrail },
  gameCount: { color: theme.textSecondary, fontSize: 10, fontVariantNumeric: 'tabular-nums', fontWeight: 800, whiteSpace: 'nowrap' },
  emptyCopy: { color: theme.textMuted, fontSize: 9, fontWeight: 600, lineHeight: 1.35, margin: 0 },
  headerNav: { display: 'flex', gap: 3 },
  headerArrow: { alignItems: 'center', background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 6, color: theme.textPrimary, cursor: 'pointer', display: 'flex', fontSize: 16, height: 24, justifyContent: 'center', lineHeight: 1, padding: 0, width: 24 },
  disabled: { cursor: 'default', opacity: 0.35 },
  timelinePad: { minWidth: 0, overflow: 'hidden' },
  timelineTrack: { alignItems: 'center', display: 'flex', gap: CHIP_GAP_PX, minHeight: GAMES_PLAYED_HIT_TARGET_HEIGHT_PX + 4, minWidth: 0, overflowX: 'auto', overflowY: 'hidden', overscrollBehaviorX: 'contain', padding: '2px 3px', scrollbarWidth: 'none', width: '100%' },
  item: { flex: `0 0 ${GAMES_PLAYED_HIT_TARGET_PX}px`, position: 'relative' },
  gameCard: { alignItems: 'center', background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 8, boxSizing: 'border-box', cursor: 'pointer', display: 'flex', height: GAMES_PLAYED_HIT_TARGET_HEIGHT_PX, justifyContent: 'center', outline: 'none', overflow: 'hidden', padding: 2, position: 'relative', textAlign: 'center', transition: 'background-color 180ms ease, border-color 180ms ease, box-shadow 180ms ease, transform 180ms ease', width: GAMES_PLAYED_HIT_TARGET_PX },
  clipped: { borderStyle: 'dashed' },
  active: { background: 'rgba(139, 92, 246, 0.14)', border: `1px solid ${theme.borderAccent}`, boxShadow: '0 0 0 2px rgba(139, 92, 246, 0.18), 0 5px 16px rgba(0,0,0,0.24)', transform: 'translateY(-2px) scale(1.02)' },
  gameArt: { borderRadius: 7, boxSizing: 'border-box', display: 'block', height: GAMES_PLAYED_ICON_SIZE_PX, objectFit: 'contain', width: GAMES_PLAYED_ART_WIDTH_PX },
  gameArtFallback: { alignItems: 'center', background: theme.bg, border: `1px dashed ${theme.border}`, borderRadius: 7, boxSizing: 'border-box', color: theme.textSecondary, display: 'flex', fontSize: 14, fontWeight: 900, height: GAMES_PLAYED_ICON_SIZE_PX, justifyContent: 'center', letterSpacing: '0.08em', width: GAMES_PLAYED_ART_WIDTH_PX },
  gameCardName: { background: 'rgba(0,0,0,0.72)', bottom: 0, color: '#fafafc', fontSize: 8, fontWeight: 800, left: 0, overflow: 'hidden', padding: '8px 3px 3px', pointerEvents: 'none', position: 'absolute', right: 0, textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
}
