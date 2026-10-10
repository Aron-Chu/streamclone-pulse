import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { useReducedMotion } from './motion/useReducedMotion.ts'
import { formatHeatOffset } from '@streampulse/pulse-core'
import {
  buildGamesPlayedTimelineSlots,
  gameSegmentKey,
  hasMeaningfulGameSegments,
  normalizeGameSegments,
  resolveGamesPlayedTimelineRange,
} from '@streampulse/pulse-charts'
import type { ExtensionGameSegment } from '../shared/messages.ts'
import { onOutsidePointerDown, usePulsePortalRoot } from './pulsePortalContext.ts'
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

// Static layout lives in shadow.css (.pulse-games-*); keep these in step with it.
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
    const igdb = `https://static-cdn.jtvnw.net/ttv-boxart/${id}_IGDB-144x192.jpg`
    if (id === '14842174') candidates.unshift(igdb)
    for (const suffix of ['144x192.jpg', '144x192.png']) {
      const candidate = `https://static-cdn.jtvnw.net/ttv-boxart/${id}-${suffix}`
      if (!candidates.includes(candidate)) candidates.push(candidate)
    }
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
  return (
    <span aria-hidden="true" className="pulse-games-art">
      <span data-game-art-fallback className="pulse-games-art-fallback">
        {initialsForGame(gameName)}
      </span>
      {src ? (
        <img
          data-game-art
          src={src}
          alt=""
          width={GAMES_PLAYED_ART_WIDTH_PX}
          height={GAMES_PLAYED_ICON_SIZE_PX}
          loading="eager"
          decoding="async"
          referrerPolicy="no-referrer"
          className="pulse-games-art-img"
          onError={() => setCandidateIndex(index => index + 1)}
        />
      ) : null}
    </span>
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
  const portalRoot = usePulsePortalRoot()
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

  useEffect(() => {
    if (!selectedKey) return
    function clear() {
      setSelectedKey(null)
      onSelectKey?.(null)
      onHighlightKey?.(null)
    }
    // Controls keep the selection; any other press clears it.
    const stopOutside = onOutsidePointerDown(
      portalRoot,
      event => Boolean((event.target as Element | null)?.closest?.('button, a, input, select, [data-chart-action="true"]')),
      event => { if (!event.defaultPrevented) clear() },
    )
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') clear()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      stopOutside()
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onHighlightKey, onSelectKey, portalRoot, selectedKey])

  if (!hasMeaningfulGameSegments(segments, durationSeconds) || !timelineRange || gameSlots.length === 0) {
    return (
      <div data-games-played data-games-played-empty aria-label="Games played" className="pulse-games">
        <div data-games-played-header className="pulse-games-head">
          <span data-games-played-label className="pulse-games-label">Games played</span>
          <span data-games-played-count className="pulse-games-count">Unavailable</span>
        </div>
        <p data-games-played-empty-copy className="pulse-games-empty-copy">
          {segments.length > 0 ? 'Game metadata is unavailable for the visible stream.' : 'No game metadata is available for this stream yet.'}
        </p>
      </div>
    )
  }

  const displayedKey = activeKey ?? selectedKey
  const displayedSlot = displayedKey
    ? gameSlots.find(slot => gameSegmentKey(slot.segment) === displayedKey)
    : gameSlots.length === 1
      ? gameSlots[0]
      : null
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
      className="pulse-games"
      onPointerLeave={() => {
        setActiveKey(null)
        onHighlightKey?.(selectedKey)
      }}
      onClick={event => {
        const target = event.target as HTMLElement | null
        if (target?.closest('button, a, input, select')) return
        if (selectedKey != null) {
          setSelectedKey(null)
          onSelectKey?.(null)
          onHighlightKey?.(null)
        }
      }}
    >
      <div data-games-played-header className="pulse-games-head">
        <span data-games-played-label className="pulse-games-label-shell">
          {displayedSlot ? (
            <>
              <strong className="pulse-games-name">{displayedSlot.segment.gameName}</strong>
              <span className="pulse-games-meta">
                {formatWindowLabel(displayedSlot.visibleStart, displayedSlot.visibleEnd)}
                {selectedKey === displayedKey ? ' · pinned' : ''}
              </span>
            </>
          ) : <span className="pulse-games-label">Games played</span>}
        </span>
        <span data-games-played-trail className="pulse-games-trail">
          <span data-games-played-count className="pulse-games-count">{gameSlots.length} {gameSlots.length === 1 ? 'game' : 'games'}</span>
          {scrollState.maxScroll > SCROLL_EDGE_EPSILON_PX ? (
            <span className="pulse-games-nav" aria-label="Games played navigation">
              <button type="button" data-chart-action="true" aria-label="Previous games" title="Previous games" disabled={!scrollState.canScrollLeft} className="pulse-games-arrow" onClick={() => scrollBy(-1)}>‹</button>
              <button type="button" data-chart-action="true" aria-label="Next games" title="Next games" disabled={!scrollState.canScrollRight} className="pulse-games-arrow" onClick={() => scrollBy(1)}>›</button>
            </span>
          ) : null}
        </span>
      </div>
      <div
        data-games-timeline
        data-timeline-start={timelineRange.startOffset}
        data-timeline-end={timelineRange.endOffset}
        className="pulse-games-timeline"
        style={{ paddingLeft: plotPadLeft, paddingRight: plotPadRight }}
      >
        <div ref={trackRef} data-games-played-track className="pulse-no-scrollbar pulse-games-track" role="list" tabIndex={-1}>
          {gameSlots.map((slot, index) => {
            const key = gameSegmentKey(slot.segment)
            const selected = selectedKey === key
            const highlighted = highlightedKey === key || selected
            const title = `${slot.segment.gameName} · ${formatWindowLabel(slot.visibleStart, slot.visibleEnd)}${slot.clipped ? ' · clipped to chart' : ''}`
            return (
              <div key={`${key}-${index}`} role="listitem" className="pulse-games-item">
                <button
                  type="button"
                  data-games-played-item
                  data-chart-action="true"
                  data-game-key={key}
                  data-game-name={slot.segment.gameName}
                  data-game-offset={slot.segment.offsetSeconds}
                  aria-label={title}
                  aria-pressed={selected}
                  title={title}
                  className={`pulse-games-card${highlighted ? ' is-active' : ''}${slot.clipped ? ' is-clipped' : ''}`}
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
                  <span aria-hidden="true" className="pulse-games-card-name">{slot.segment.gameName}</span>
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
