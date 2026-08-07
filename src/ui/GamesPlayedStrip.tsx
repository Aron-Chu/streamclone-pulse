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
import { fetchTwitchDirectoryBoxArt } from './twitchGameArt.ts'

/** Twitch box-art height. Keep this exported for layout and visual regression tests. */
export const GAMES_PLAYED_ICON_SIZE_PX = 64
/** Twitch box-art is portrait (52×72), never a square avatar. */
export const GAMES_PLAYED_ART_WIDTH_PX = 46
/** Interactive width; the portrait card is intentionally taller than it is wide. */
export const GAMES_PLAYED_HIT_TARGET_PX = 52
export const GAMES_PLAYED_HIT_TARGET_HEIGHT_PX = 70
/** @deprecated Retained for consumers that imported the old chip constant. */
export const GAMES_PLAYED_CHIP_WIDTH_PX = GAMES_PLAYED_HIT_TARGET_PX
/** @deprecated use GAMES_PLAYED_ICON_SIZE_PX */
export const GAMES_PLAYED_CHIP_MIN_WIDTH_PX = GAMES_PLAYED_HIT_TARGET_PX

const CHIP_GAP_PX = 8
const CHIP_STEP_PX = GAMES_PLAYED_HIT_TARGET_PX + CHIP_GAP_PX
const SCROLL_EDGE_EPSILON_PX = 0.5

export interface GamesPlayedScrollState {
  maxScroll: number
  canScrollLeft: boolean
  canScrollRight: boolean
  hiddenAhead: number
  visibleStart: number
  visibleEnd: number
}

export interface GamesPlayedVisibleRange {
  startOffset: number
  endOffset: number
}

export interface GamesPlayedStripProps {
  games?: ExtensionGameSegment[]
  /** Reset transient rail state when the Twitch session changes. */
  streamId?: string | null
  durationSeconds: number
  highlightedKey?: string | null
  onHighlightKey?: (key: string | null) => void
  /** Notify the owner when a segment is pinned or unpinned. */
  onSelectKey?: (key: string | null) => void
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

export function resolveGamesPlayedScrollState(
  scrollLeft: number,
  scrollWidth: number,
  clientWidth: number,
  totalItems: number,
): GamesPlayedScrollState {
  const safeScrollWidth = Number.isFinite(scrollWidth) ? Math.max(0, scrollWidth) : 0
  const safeClientWidth = Number.isFinite(clientWidth) ? Math.max(0, clientWidth) : 0
  const maxScroll = Math.max(0, safeScrollWidth - safeClientWidth)
  const safeScrollLeft = Number.isFinite(scrollLeft)
    ? Math.max(0, Math.min(maxScroll, scrollLeft))
    : 0
  const overflow = maxScroll > SCROLL_EDGE_EPSILON_PX
  const scrolledPast = Math.floor(safeScrollLeft / CHIP_STEP_PX)
  const contentWidth = Math.max(0, safeClientWidth - 6)
  const visibleApprox = Math.max(1, Math.floor((contentWidth + CHIP_GAP_PX) / CHIP_STEP_PX))
  const canScrollLeft = overflow && safeScrollLeft > SCROLL_EDGE_EPSILON_PX
  const canScrollRight = overflow && maxScroll - safeScrollLeft > SCROLL_EDGE_EPSILON_PX
  const scrolledStart = Math.max(0, Math.min(Math.max(0, totalItems - 1), scrolledPast))
  const visibleStart = canScrollRight
    ? scrolledStart
    : Math.max(0, totalItems - visibleApprox)
  const visibleEnd = Math.min(totalItems, visibleStart + visibleApprox)
  return {
    maxScroll,
    canScrollLeft,
    canScrollRight,
    hiddenAhead: Math.max(0, totalItems - visibleEnd),
    visibleStart,
    visibleEnd,
  }
}

export function safeGameArtUrl(raw: string | undefined): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw)
    const host = url.hostname.toLowerCase()
    const isTwitchAsset = host === 'static-cdn.jtvnw.net' || host.endsWith('.twitch.tv')
    return url.protocol === 'https:' && isTwitchAsset ? url.toString() : null
  } catch {
    return null
  }
}

export function resolveGameArtUrl(boxArtUrl: string | undefined, categoryId: string | undefined): string | null {
  const explicit = safeGameArtUrl(boxArtUrl)
  if (explicit) return explicit
  const normalizedCategoryId = categoryId?.trim()
  if (!normalizedCategoryId || !/^\d{1,20}$/.test(normalizedCategoryId)) return null
  return `https://static-cdn.jtvnw.net/ttv-boxart/${normalizedCategoryId}-144x192.jpg`
}

export function initialsForGame(gameName: string): string {
  const words = gameName.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase()
  return `${words[0]![0]}${words[words.length - 1]![0]}`.toUpperCase()
}

function GameArt({
  gameName,
  boxArtUrl,
  categoryId,
  size = GAMES_PLAYED_ICON_SIZE_PX,
}: {
  gameName: string
  boxArtUrl?: string
  categoryId?: string
  size?: number
}) {
  const resolved = resolveGameArtUrl(boxArtUrl, categoryId)
  const [failed, setFailed] = useState(false)
  const artWidth = Math.max(24, Math.round(size * (GAMES_PLAYED_ART_WIDTH_PX / GAMES_PLAYED_ICON_SIZE_PX)))

  useEffect(() => setFailed(false), [resolved])

  if (!resolved || failed) {
    return (
      <span
        aria-hidden="true"
        style={{ ...styles.gameArtFallback, height: size, width: artWidth }}
        data-game-art-fallback
      >
        <span style={styles.gameArtFallbackInitials}>{initialsForGame(gameName)}</span>
      </span>
    )
  }

  return (
    <img
      src={resolved}
      alt=""
      width={artWidth}
      height={size}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      style={{ ...styles.gameArt, height: size, width: artWidth }}
      onError={() => setFailed(true)}
    />
  )
}

/**
 * Compact chronological game icon rail for the chart.
 *
 * Every segment remains in chronological order, including revisits to a game.
 * Icons are deliberately inert until the user hovers, focuses, or selects one;
 * this keeps the chart stable and avoids the old automatic scroll nudge.
 */
export function GamesPlayedStrip({
  games,
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
  const hoverIntentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [hasOverflow, setHasOverflow] = useState(false)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [visibleWindow, setVisibleWindow] = useState({ start: 0, end: 1 })
  const onSelectKeyRef = useRef(onSelectKey)
  onSelectKeyRef.current = onSelectKey
  const [directoryArtByGame, setDirectoryArtByGame] = useState<Record<string, string>>({})
  const segments = useMemo(
    () => normalizeGameSegments(games ?? [], durationSeconds),
    [games, durationSeconds],
  )

  const timelineRange = useMemo(
    () => resolveGamesPlayedTimelineRange(visibleRange, durationSeconds, segments),
    [durationSeconds, segments, visibleRange],
  )

  useEffect(() => {
    let cancelled = false
    const missingNames = Array.from(new Set(
      segments
        .filter(segment => !resolveGameArtUrl(segment.boxArtUrl, segment.categoryId))
        .map(segment => segment.gameName.trim())
        .filter(Boolean),
    ))
    if (missingNames.length === 0) return
    void Promise.all(missingNames.map(async gameName => ({
      gameName,
      url: await fetchTwitchDirectoryBoxArt(gameName),
    }))).then(results => {
      if (cancelled) return
      setDirectoryArtByGame(current => {
        const next = { ...current }
        let changed = false
        for (const result of results) {
          if (!result.url || next[result.gameName] === result.url) continue
          next[result.gameName] = result.url
          changed = true
        }
        return changed ? next : current
      })
    })
    return () => {
      cancelled = true
    }
  }, [segments])

  const gameSlots = useMemo(() => {
    if (!timelineRange) return []
    return buildGamesPlayedTimelineSlots(segments, timelineRange).filter(
      (slot): slot is Extract<typeof slot, { kind: 'segment' }> => slot.kind === 'segment',
    )
  }, [segments, timelineRange])

  useEffect(() => {
    const track = trackRef.current
    if (!track) return

    let animationFrame = 0

    function syncEdges(): void {
      const node = trackRef.current
      if (!node) return
      const state = resolveGamesPlayedScrollState(
        node.scrollLeft,
        node.scrollWidth,
        node.clientWidth,
        gameSlots.length,
      )
      setHasOverflow(state.maxScroll > SCROLL_EDGE_EPSILON_PX)
      setCanScrollLeft(state.canScrollLeft)
      setCanScrollRight(state.canScrollRight)
      setVisibleWindow(current => current.start === state.visibleStart && current.end === state.visibleEnd
        ? current
        : { start: state.visibleStart, end: state.visibleEnd })
    }

    function scheduleSyncEdges(): void {
      if (animationFrame) return
      animationFrame = requestAnimationFrame(() => {
        animationFrame = 0
        syncEdges()
      })
    }

    function onWheel(event: WheelEvent): void {
      const node = trackRef.current
      if (!node) return
      const state = resolveGamesPlayedScrollState(
        node.scrollLeft,
        node.scrollWidth,
        node.clientWidth,
        gameSlots.length,
      )
      if (!state.canScrollLeft && !state.canScrollRight) return
      const rawDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      const deltaUnit = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? node.clientWidth : 1
      const delta = rawDelta * deltaUnit
      if (delta === 0) return
      const next = Math.max(0, Math.min(state.maxScroll, node.scrollLeft + delta))
      if (Math.abs(next - node.scrollLeft) <= SCROLL_EDGE_EPSILON_PX) return
      event.preventDefault()
      event.stopPropagation()
      node.scrollTo({ left: next, behavior: 'auto' })
    }

    syncEdges()
    track.addEventListener('scroll', scheduleSyncEdges, { passive: true })
    track.addEventListener('wheel', onWheel, { passive: false })
    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncEdges) : null
    resizeObserver?.observe(track)

    return () => {
      track.removeEventListener('scroll', scheduleSyncEdges)
      track.removeEventListener('wheel', onWheel)
      resizeObserver?.disconnect()
      if (animationFrame) cancelAnimationFrame(animationFrame)
    }
  }, [gameSlots.length])

  useEffect(() => {
    const track = trackRef.current
    if (track && typeof track.scrollTo === 'function') {
      track.scrollTo({ left: 0, behavior: 'auto' })
    }
    if (hoverIntentTimerRef.current != null) {
      clearTimeout(hoverIntentTimerRef.current)
      hoverIntentTimerRef.current = null
    }
    setActiveKey(null)
    setSelectedKey(null)
    onSelectKeyRef.current?.(null)
  }, [streamId])

  useEffect(() => {
    const validKeys = new Set(gameSlots.map(slot => gameSegmentKey(slot.segment)))
    if (selectedKey && !validKeys.has(selectedKey)) {
      setSelectedKey(null)
      onSelectKey?.(null)
    }
    if (activeKey && !validKeys.has(activeKey)) setActiveKey(null)
  }, [activeKey, gameSlots, onSelectKey, selectedKey])

  useEffect(() => {
    return () => {
      if (hoverIntentTimerRef.current != null) {
        clearTimeout(hoverIntentTimerRef.current)
        hoverIntentTimerRef.current = null
      }
    }
  }, [])

  if (!hasMeaningfulGameSegments(segments, durationSeconds) || !timelineRange || gameSlots.length === 0) {
    return null
  }

  const displayedKey = activeKey ?? selectedKey
  const displayedSlot = displayedKey
    ? gameSlots.find(slot => gameSegmentKey(slot.segment) === displayedKey) ?? null
    : null
  const motionReduced = reducedMotion()

  function clearHoverIntentTimer(): void {
    if (hoverIntentTimerRef.current != null) {
      clearTimeout(hoverIntentTimerRef.current)
      hoverIntentTimerRef.current = null
    }
  }

  function scheduleHoverIntent(key: string): void {
    clearHoverIntentTimer()
    hoverIntentTimerRef.current = setTimeout(() => {
      hoverIntentTimerRef.current = null
      setActiveKey(key)
      onHighlightKey?.(key)
    }, 100)
  }

  function reducedMotion(): boolean {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  function handleStripLeave(): void {
    setActiveKey(null)
    onHighlightKey?.(selectedKey)
  }

  function scrollByChip(direction: -1 | 1): void {
    const node = trackRef.current
    if (!node) return
    const state = resolveGamesPlayedScrollState(
      node.scrollLeft,
      node.scrollWidth,
      node.clientWidth,
      gameSlots.length,
    )
    const target = Math.max(0, Math.min(state.maxScroll, node.scrollLeft + direction * CHIP_STEP_PX))
    if (Math.abs(target - node.scrollLeft) <= SCROLL_EDGE_EPSILON_PX) return
    node.scrollTo({ left: target, behavior: reducedMotion() ? 'auto' : 'smooth' })
  }

  function focusRelative(index: number, direction: -1 | 1 | 0): void {
    const buttons = Array.from(
      trackRef.current?.querySelectorAll<HTMLButtonElement>('[data-games-played-item]') ?? [],
    )
    if (!buttons.length) return
    const nextIndex = direction === 0
      ? index
      : Math.max(0, Math.min(buttons.length - 1, index + direction))
    const next = buttons[nextIndex]
    next?.focus({ preventScroll: true })
    const track = trackRef.current
    if (!track || !next) return
    const trackRect = track.getBoundingClientRect()
    const nextRect = next.getBoundingClientRect()
    const revealDelta = nextRect.left < trackRect.left
      ? nextRect.left - trackRect.left
      : nextRect.right > trackRect.right
        ? nextRect.right - trackRect.right
        : 0
    if (Math.abs(revealDelta) > SCROLL_EDGE_EPSILON_PX) {
      track.scrollTo({
        left: Math.max(0, Math.min(track.scrollWidth - track.clientWidth, track.scrollLeft + revealDelta)),
        behavior: reducedMotion() ? 'auto' : 'smooth',
      })
    }
  }

  function handleItemKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      focusRelative(index, 1)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      focusRelative(index, -1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusRelative(0, 0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusRelative(gameSlots.length - 1, 0)
    }
  }

  return (
    <div
      ref={rootRef}
      style={styles.gamesStrip}
      aria-label="Games played"
      onPointerLeave={handleStripLeave}
      data-games-played
    >
      <div style={styles.headerRow} data-games-played-header>
        <span style={styles.gamesLabelShell} data-games-played-label>
          {displayedSlot ? (
            <>
              <span style={styles.gamesLabelName}>{displayedSlot.segment.gameName}</span>
              <span style={styles.gamesLabelMeta}>
                {formatWindowLabel(displayedSlot.visibleStart, displayedSlot.visibleEnd)}
                {displayedSlot.clipped ? ' · clipped' : ''}
              </span>
            </>
          ) : (
            <span style={styles.gamesLabel}>Games played</span>
          )}
        </span>
        <div style={styles.headerTrail} data-games-played-trail>
          <span style={styles.gameCount} data-games-played-count>
            {gameSlots.length} {gameSlots.length === 1 ? 'game' : 'games'}
          </span>
          <span
            style={styles.rangeStatus}
            aria-label={`Showing games ${visibleWindow.start + 1} through ${visibleWindow.end} of ${gameSlots.length}`}
            data-games-played-status
          >
            {visibleWindow.start === 0 && visibleWindow.end === gameSlots.length
              ? `Showing ${gameSlots.length} of ${gameSlots.length}`
              : visibleWindow.start + 1 === visibleWindow.end
                ? `${visibleWindow.start + 1} of ${gameSlots.length}`
                : `${visibleWindow.start + 1}–${visibleWindow.end} of ${gameSlots.length}`}
          </span>
          {hasOverflow ? (
            <div style={styles.headerNav} aria-label="Games played navigation">
              <button
                type="button"
                style={{ ...styles.headerArrow, ...(!canScrollLeft ? styles.headerArrowDisabled : null) }}
                aria-label="Previous games"
                title="Previous games"
                disabled={!canScrollLeft}
                data-games-played-arrow="previous"
                onClick={() => scrollByChip(-1)}
              >
                ‹
              </button>
              <button
                type="button"
                style={{ ...styles.headerArrow, ...(!canScrollRight ? styles.headerArrowDisabled : null) }}
                aria-label="Next games"
                title="Next games"
                disabled={!canScrollRight}
                data-games-played-arrow="next"
                onClick={() => scrollByChip(1)}
              >
                ›
              </button>
            </div>
          ) : null}
        </div>
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
        <div style={styles.trackShell} data-games-played-navigation>
          <div
            ref={trackRef}
            className="pulse-no-scrollbar"
            style={styles.timelineTrack}
            role="list"
            tabIndex={-1}
            aria-label="Games played timeline"
            data-games-played-track
          >
            {gameSlots.map((slot, index) => {
              const { segment } = slot
              const key = gameSegmentKey(segment)
              const selected = selectedKey === key
              const isHighlighted = highlightedKey === key || selected
              const title = `${segment.gameName} · ${formatWindowLabel(slot.visibleStart, slot.visibleEnd)}${
                slot.clipped ? ' · clipped to chart' : ''
              }`

              return (
                <div key={`${segment.gameName}-${segment.offsetSeconds}-${index}`} role="listitem" style={styles.item}>
                  <button
                    type="button"
                    style={{
                      ...styles.gameCard,
                      ...(slot.clipped ? styles.gameCardClipped : null),
                      ...(isHighlighted
                        ? {
                            ...styles.gameCardActive,
                            ...(motionReduced ? styles.gameCardActiveReduced : null),
                          }
                        : null),
                    }}
                    aria-label={title}
                    aria-pressed={selected}
                    data-games-played-item
                    data-game-key={key}
                    onPointerEnter={() => {
                      scheduleHoverIntent(key)
                    }}
                    onFocus={() => {
                      clearHoverIntentTimer()
                      setActiveKey(key)
                      onHighlightKey?.(key)
                    }}
                    onPointerLeave={() => {
                      clearHoverIntentTimer()
                      setActiveKey(current => current === key ? null : current)
                      onHighlightKey?.(selectedKey)
                    }}
                    onBlur={event => {
                      if (typeof Node !== 'undefined' && event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return
                      clearHoverIntentTimer()
                      setActiveKey(current => current === key ? null : current)
                      onHighlightKey?.(selectedKey)
                    }}
                    onClick={() => {
                      const next = selected ? null : key
                      setSelectedKey(next)
                      onSelectKey?.(next)
                      onHighlightKey?.(next)
                    }}
                    onKeyDown={event => handleItemKeyDown(event, index)}
                  >
                    <GameArt
                      gameName={segment.gameName}
                      boxArtUrl={segment.boxArtUrl ?? directoryArtByGame[segment.gameName.trim()]}
                      categoryId={segment.categoryId}
                    />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  gamesStrip: { display: 'grid', gap: 4, marginBottom: 2, minWidth: 0 },
  headerRow: {
    alignItems: 'center',
    display: 'flex',
    gap: 6,
    justifyContent: 'space-between',
  },
  headerTrail: {
    alignItems: 'center',
    display: 'flex',
    flexShrink: 0,
    gap: 6,
    minWidth: 0,
  },
  gamesLabelShell: {
    alignItems: 'baseline',
    display: 'flex',
    gap: 6,
    minWidth: 0,
    overflow: 'hidden',
  },
  gamesLabelName: {
    color: theme.textPrimary,
    fontSize: 10,
    fontWeight: 700,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  gamesLabelMeta: {
    color: theme.textMuted,
    flexShrink: 0,
    fontSize: 9,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
  gameCount: {
    color: theme.textSecondary,
    fontSize: 10,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 800,
    whiteSpace: 'nowrap',
  },
  gamesLabel: {
    color: theme.textMuted,
    fontSize: 9,
    fontWeight: 800,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  },
  rangeStatus: {
    background: theme.hoverFill,
    border: `1px solid ${theme.borderSubtle}`,
    borderRadius: 999,
    color: theme.textSecondary,
    fontSize: 9,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 800,
    lineHeight: 1,
    padding: '4px 7px',
    whiteSpace: 'nowrap',
  },
  headerNav: {
    alignItems: 'center',
    display: 'flex',
    gap: 3,
  },
  headerArrow: {
    alignItems: 'center',
    background: theme.inputBg,
    border: `1px solid ${theme.borderSubtle}`,
    borderRadius: 6,
    color: theme.textPrimary,
    cursor: 'pointer',
    display: 'flex',
    fontSize: 16,
    fontWeight: 700,
    height: 24,
    justifyContent: 'center',
    lineHeight: 1,
    padding: 0,
    width: 24,
  },
  headerArrowDisabled: {
    color: theme.textMuted,
    cursor: 'default',
    opacity: 0.35,
  },
  timelinePad: {
    minWidth: 0,
    overflow: 'hidden',
  },
  trackShell: {
    minWidth: 0,
    width: '100%',
  },
  timelineTrack: {
    alignItems: 'center',
    display: 'flex',
    gap: CHIP_GAP_PX,
    minHeight: GAMES_PLAYED_HIT_TARGET_HEIGHT_PX + 4,
    minWidth: 0,
    msOverflowStyle: 'none',
    overflowX: 'auto',
    overflowY: 'hidden',
    overflowAnchor: 'none',
    overscrollBehaviorX: 'contain',
    padding: '2px 3px',
    scrollbarWidth: 'none',
    // Navigation is controlled by the explicit arrows/keys; native snapping can
    // drift fractional scrollLeft values and make edge cards intermittently hit-unstable.
    width: '100%',
  },
  item: {
    flex: `0 0 ${GAMES_PLAYED_HIT_TARGET_PX}px`,
    position: 'relative',
    scrollSnapAlign: 'start',
  },
  gameCard: {
    alignItems: 'center',
    background: theme.inputBg,
    border: `1px solid ${theme.borderSubtle}`,
    borderRadius: 8,
    cursor: 'pointer',
    display: 'flex',
    height: GAMES_PLAYED_HIT_TARGET_HEIGHT_PX,
    justifyContent: 'center',
    outline: 'none',
    overflow: 'hidden',
    padding: 2,
    position: 'relative',
    textAlign: 'center',
    transition: 'background-color 180ms ease, border-color 180ms ease, box-shadow 180ms ease, transform 180ms ease',
    width: GAMES_PLAYED_HIT_TARGET_PX,
  },
  gameCardClipped: { borderStyle: 'dashed' },
  gameCardActive: {
    background: theme.accentSurface,
    border: `1px solid ${theme.borderAccent}`,
    boxShadow: '0 0 0 2px rgba(139, 92, 246, 0.18), 0 5px 16px rgba(0,0,0,0.24)',
    transform: 'translateY(-2px) scale(1.02)',
  },
  gameCardActiveReduced: {
    transform: 'none',
  },
  gameArt: {
    borderRadius: 7,
    display: 'block',
    height: GAMES_PLAYED_ICON_SIZE_PX,
    objectFit: 'cover',
    width: GAMES_PLAYED_ICON_SIZE_PX,
  },
  gameArtFallback: {
    alignItems: 'center',
    background: `linear-gradient(165deg, ${theme.inputBg}, ${theme.hoverFill})`,
    border: `1px dashed ${theme.borderSubtle}`,
    borderRadius: 7,
    color: theme.textSecondary,
    display: 'grid',
    fontWeight: 800,
    height: GAMES_PLAYED_ICON_SIZE_PX,
    justifyContent: 'center',
    justifyItems: 'center',
    padding: '8px 2px 5px',
    width: GAMES_PLAYED_ICON_SIZE_PX,
  },
  gameArtFallbackInitials: {
    fontSize: 14,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 900,
    letterSpacing: '0.08em',
    opacity: 0.72,
  },
}
