import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { formatHeatOffset } from '@streampulse/pulse-core'
import {
  buildGamesPlayedTimelineSlots,
  gameSegmentKey,
  gameSegmentOverlapsOffsetRange,
  hasMeaningfulGameSegments,
  normalizeGameSegments,
  resolveGamesPlayedTimelineRange,
  type ChartGameSegment,
} from '@streampulse/pulse-charts'
import { isIdBuiltBoxArt, isTwitchPlaceholderBoxArt, twitchBoxArtByName } from '../../utils/twitchBoxArt.ts'
import { hms } from './sessionSpChartModel.ts'

/** Keep the portal rail visually aligned with the Twitch extension rail. */
export const GAMES_PLAYED_ICON_SIZE_PX = 64
/** Twitch box-art is portrait (52×72), never a square avatar. */
export const GAMES_PLAYED_ART_WIDTH_PX = 46
export const GAMES_PLAYED_HIT_TARGET_PX = 52
export const GAMES_PLAYED_HIT_TARGET_HEIGHT_PX = 70
/** @deprecated retained for consumers that imported the old chip constant. */
export const GAMES_PLAYED_CHIP_WIDTH_PX = GAMES_PLAYED_HIT_TARGET_PX
/** @deprecated use GAMES_PLAYED_HIT_TARGET_PX */
export const GAMES_PLAYED_CHIP_MIN_WIDTH_PX = GAMES_PLAYED_HIT_TARGET_PX

const CHIP_GAP_PX = 8
const CHIP_STEP_PX = GAMES_PLAYED_HIT_TARGET_PX + CHIP_GAP_PX
/** (candidate, 10-30) GP1: a headerless item is as wide as its name line, up to this. */
export const GAMES_PLAYED_NAME_MAX_PX = 96

// (fix, 10-30) GP-3 / GP-7: what a run time can and cannot claim.
/** A game the API runs this far past the newest measured minute has no known end (a live poll runs to now). */
const OPEN_END_TOLERANCE_SECONDS = 120
const ESTIMATE_NOTE = 'Estimated from the stream category.'
const dataEndNote = (dataEndSeconds: number) => `Data ends at ${hms(dataEndSeconds)}; the games list runs past it.`

/**
 * (fix, 10-30) GP-7: switch times read from the stream's category, not
 * measured: category_fallback (the stream's one category) and snapshot
 * (category checks a poll apart). Stored segments are VOD-bounded.
 */
export function isEstimatedGameSource(source: string | undefined): boolean {
  return source === 'category_fallback' || source === 'snapshot'
}

/**
 * (fix, 10-30) GP-3: keys of the games the API runs past the newest measured
 * minute. The chart cuts them there, so their length is not known.
 */
export function gamesOpenAtDataEnd(
  games: readonly Pick<ChartGameSegment, 'gameName' | 'offsetSeconds' | 'durationSeconds'>[] | null | undefined,
  dataEndSeconds: number | null | undefined,
): Set<string> {
  const open = new Set<string>()
  if (dataEndSeconds == null || !Number.isFinite(dataEndSeconds) || dataEndSeconds <= 0) return open
  for (const game of games ?? []) {
    if (!Number.isFinite(game.offsetSeconds) || !Number.isFinite(game.durationSeconds)) continue
    if (game.offsetSeconds < dataEndSeconds && game.offsetSeconds + game.durationSeconds > dataEndSeconds + OPEN_END_TOLERANCE_SECONDS) {
      open.add(gameSegmentKey(game as ChartGameSegment))
    }
  }
  return open
}

/** (fix, 10-30) GP-3 / GP-7: "≈2h 55m+", about when estimated, "+" when the data ends first. */
function runTimeText(seconds: number, estimated: boolean, open: boolean): string {
  return `${estimated ? '≈' : ''}${formatRunTime(seconds)}${open ? '+' : ''}`
}

function runTimeNote(estimated: boolean, openAtSeconds: number | null): string {
  return [openAtSeconds != null ? dataEndNote(openAtSeconds) : null, estimated ? ESTIMATE_NOTE : null]
    .filter(Boolean)
    .join(' ')
}

export interface GamesPlayedVisibleRange {
  startOffset: number
  endOffset: number
}

export interface GamesPlayedStripProps {
  games?: ChartGameSegment[]
  durationSeconds: number
  highlightedKey?: string | null
  onHighlightKey?: (key: string | null) => void
  onSelectKey?: (key: string | null) => void
  /** Live charts may limit the initial rail to the visible chart window. */
  visibleRange?: GamesPlayedVisibleRange | null
  /**
   * The session chart (d3-v2 session-original, 2026-10-14/15 declutter): no
   * "Games played" header row, every game on the rail (no chart-window toggle
   * to host), and each poster says how long it ran, so the posters read as a
   * timeline against the chart's game band. No box around the posters and no
   * details line under them (the poster's title carries the game and span);
   * the poster borders follow the mockup's .po-gp-b (sp-session-chart.css).
   * (candidate, 10-30) GP1: each poster has two visible lines under it, the
   * name and the run time (they were title-only and aria-hidden).
   */
  headerless?: boolean
  /**
   * (fix, 10-30) GP-3: where the measured data ends (the newest minute's end).
   * A game the API runs past it gets an open run time ("2h 54m+") and says so.
   */
  dataEndSeconds?: number | null
}

function formatStreamDuration(durationSeconds: number): string {
  const total = Math.round(durationSeconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m`
  return `${total}s`
}

/** A poster's run time, rounded to the minute (session-original `fdm`): "49m", "10h 35m". */
function formatRunTime(durationSeconds: number): string {
  const total = Math.round(Math.max(0, durationSeconds) / 60)
  return total < 60 ? `${total}m` : `${Math.floor(total / 60)}h ${total % 60}m`
}

function formatWindowLabel(
  startOffset: number,
  endOffset: number,
  rounded = false,
  // (fix, 10-30) GP-3 / GP-7: "about" for an estimate, "+" for a run past the data.
  { estimated = false, open = false }: { estimated?: boolean; open?: boolean } = {},
): string {
  const span = Math.max(0, endOffset - startOffset)
  const run = rounded ? formatRunTime(span) : formatStreamDuration(span)
  return `${formatHeatOffset(startOffset)}–${formatHeatOffset(endOffset)} · ${estimated ? 'about ' : ''}${run}${open ? '+' : ''}`
}

function countHiddenAhead(node: HTMLDivElement, total: number): number {
  const overflow = node.scrollWidth - node.clientWidth
  if (overflow <= 1 || total <= 0) return 0
  const scrolledPast = Math.max(0, Math.round(node.scrollLeft / CHIP_STEP_PX))
  const visibleApprox = Math.max(1, Math.floor((node.clientWidth + CHIP_GAP_PX) / CHIP_STEP_PX))
  return Math.max(0, total - scrolledPast - visibleApprox)
}

// (candidate, 10-30) GP1: a named poster is 52 to 96 px wide, so the fixed chip
// step miscounts them. These measure the posters against the rail's visible width.
function namedRailEdges(node: HTMLDivElement): { left: number; right: number } {
  const left = node.getBoundingClientRect().left
  return { left, right: left + node.clientWidth }
}

/** (candidate, 10-30) GP1: posters wholly or partly past the rail's right edge. */
function countNamedHiddenAhead(node: HTMLDivElement): number {
  if (node.scrollWidth - node.clientWidth <= 1) return 0
  const { right } = namedRailEdges(node)
  return Array.from(node.children).filter(item => item.getBoundingClientRect().right > right + 1).length
}

/**
 * (candidate, 10-30) GP1: one poster per click, like the chip step. The next
 * poster cut off in that direction moves into the place of the last whole one,
 * so the rail moves by that poster's own width and gap.
 */
function namedScrollStepPx(node: HTMLDivElement, direction: -1 | 1): number {
  const { left, right } = namedRailEdges(node)
  const rects = Array.from(node.children, item => item.getBoundingClientRect())
  if (direction > 0) {
    const next = rects.findIndex(rect => rect.right > right + 1)
    if (next < 0) return CHIP_STEP_PX
    return Math.ceil(rects[next]!.right - (next > 0 ? rects[next - 1]!.right : right))
  }
  for (let previous = rects.length - 1; previous >= 0; previous -= 1) {
    if (rects[previous]!.left >= left - 1) continue
    return Math.floor(rects[previous]!.left - (previous < rects.length - 1 ? rects[previous + 1]!.left : left))
  }
  return -CHIP_STEP_PX
}

export function safeGameArtUrl(raw: string | undefined): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw)
    const host = url.hostname.toLowerCase()
    const twitchAsset = host === 'static-cdn.jtvnw.net' || host.endsWith('.twitch.tv')
    return url.protocol === 'https:' && twitchAsset ? url.toString() : null
  } catch {
    return null
  }
}

const KNOWN_GENERIC_TWITCH_CATEGORY_IDS = new Set(['676802825', '1675560685'])

export function isKnownGenericTwitchArtwork(url: string, categoryId?: string): boolean {
  const id = categoryId?.trim()
  return Boolean(id && KNOWN_GENERIC_TWITCH_CATEGORY_IDS.has(id) && !/_IGDB-/i.test(url))
}

function twitchIgdbVariant(url: string): string | null {
  if (/_IGDB-/i.test(url)) return null
  const next = url.replace(/\/ttv-boxart\/(\d+)-/i, '/ttv-boxart/$1_IGDB-')
  return next === url ? null : next
}

/** Public-safe standard → IGDB artwork order, followed by branded initials. */
function twitchNameArtUrl(gameName: string | undefined, igdb = false): string | null {
  const normalized = gameName?.trim()
  if (!normalized) return null
  // (fix, 10-30) GP-8: one builder for name-based art (twitchBoxArt.ts); "_" is
  // unreserved, so the IGDB name encodes exactly as before.
  return twitchBoxArtByName(igdb ? `${normalized}_IGDB` : normalized, 144, 192)
}

export function gameArtCandidates(
  boxArtUrl: string | undefined,
  categoryId: string | undefined,
  gameName?: string,
): string[] {
  const candidates: string[] = []
  const explicit = safeGameArtUrl(boxArtUrl)
  if (explicit) {
    candidates.push(explicit)
    const alternate = twitchIgdbVariant(explicit)
    if (alternate) candidates.push(alternate)
  }
  const normalizedCategoryId = categoryId?.trim()
  if (normalizedCategoryId && /^\d{1,20}$/.test(normalizedCategoryId)) {
    candidates.push(
      `https://static-cdn.jtvnw.net/ttv-boxart/${normalizedCategoryId}-144x192.jpg`,
      `https://static-cdn.jtvnw.net/ttv-boxart/${normalizedCategoryId}_IGDB-144x192.jpg`,
    )
  }
  // Hosted backends predating the category-identity migration return only
  // gameName. Twitch's box-art CDN accepts the encoded category name, so this
  // keeps the portal useful while the newer id/boxArt contract rolls out.
  // The host and dimensions are fixed here; no API-provided URL is trusted.
  const named = twitchNameArtUrl(gameName)
  const namedIgdb = twitchNameArtUrl(gameName, true)
  if (named) candidates.push(named)
  if (namedIgdb) candidates.push(namedIgdb)
  return Array.from(new Set(candidates))
}

export function resolveGameArtUrl(
  boxArtUrl: string | undefined,
  categoryId: string | undefined,
  gameName?: string,
): string | null {
  return gameArtCandidates(boxArtUrl, categoryId, gameName).find(candidate =>
    !isKnownGenericTwitchArtwork(candidate, categoryId),
  ) ?? null
}

export function initialsForGame(gameName: string): string {
  const words = gameName.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase()
  return `${words[0]![0]}${words[words.length - 1]![0]}`.toUpperCase()
}

/** Stable hue per game so art-less chips stay distinguishable instead of looking broken. */
function hueForGame(gameName: string): number {
  let hash = 0
  for (let i = 0; i < gameName.length; i += 1) {
    hash = (hash * 31 + gameName.charCodeAt(i)) % 360
  }
  return hash
}

function GameArt({
  gameName,
  boxArtUrl,
  categoryId,
  size = GAMES_PLAYED_ICON_SIZE_PX,
  width,
}: {
  gameName: string
  boxArtUrl?: string
  categoryId?: string
  size?: number
  /** Px; defaults to the portrait ratio of `size` (at least 24). */
  width?: number
}) {
  const candidates = useMemo(
    () => gameArtCandidates(boxArtUrl, categoryId, gameName),
    [boxArtUrl, categoryId, gameName],
  )
  const [candidateIndex, setCandidateIndex] = useState(() =>
    candidates.findIndex(candidate => !isKnownGenericTwitchArtwork(candidate, categoryId)),
  )
  const resolved = candidateIndex >= 0 ? candidates[candidateIndex] : null
  const artWidth = width ?? Math.max(24, Math.round(size * (GAMES_PLAYED_ART_WIDTH_PX / GAMES_PLAYED_ICON_SIZE_PX)))
  useEffect(() => {
    setCandidateIndex(candidates.findIndex(candidate => !isKnownGenericTwitchArtwork(candidate, categoryId)))
  }, [candidates, categoryId])
  // (fix, 10-30) GP-8: a cover the page builds itself, by name or by id, can be
  // Twitch's grey "?" (HTTP 200, so no onError). A newer game's standard id
  // cover redirects there too (checked 10-30: ttv-boxart/1419480843-144x192.jpg
  // → 404_boxart); only its _IGDB cover is real. It loads with CORS, stays hidden
  // until checked, and a proven placeholder falls through to the next candidate
  // or the initials. The backend's own cover is checked only when it is that id
  // cover (its fallback when the Twitch name lookup fails); its _IGDB or
  // looked-up cover loads as before.
  const sentArt = useMemo(() => safeGameArtUrl(boxArtUrl), [boxArtUrl])
  const checkArt = resolved != null && (resolved !== sentArt || isIdBuiltBoxArt(resolved))
  const [checkedArt, setCheckedArt] = useState<string | null>(null)
  const nextCandidate = (index: number) => candidates.findIndex((candidate, at) =>
    at > index && !isKnownGenericTwitchArtwork(candidate, categoryId),
  )

  if (!resolved) {
    const hue = hueForGame(gameName)
    return (
      <span
        aria-hidden="true"
        className="grid shrink-0 place-items-center overflow-hidden rounded-md"
        style={{
          background: `linear-gradient(150deg, hsl(${hue} 42% 28%), hsl(${(hue + 28) % 360} 34% 15%))`,
          boxShadow: `inset 0 0 0 1px hsl(${hue} 45% 62% / 0.28)`,
          color: `hsl(${hue} 60% 88%)`,
          height: size,
          width: artWidth,
        }}
      >
        <span
          className="font-semibold leading-none"
          style={{ fontSize: Math.max(9, Math.round(size * 0.34)), letterSpacing: '0.01em' }}
        >
          {initialsForGame(gameName)}
        </span>
      </span>
    )
  }

  return (
    <img
      key={resolved}
      src={resolved}
      alt=""
      width={artWidth}
      height={size}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      crossOrigin={checkArt ? 'anonymous' : undefined}
      className="block shrink-0 rounded-md object-cover"
      style={{ height: size, width: artWidth, opacity: checkArt && checkedArt !== resolved ? 0 : undefined }}
      onLoad={checkArt
        ? event => {
          const url = resolved
          void isTwitchPlaceholderBoxArt(event.currentTarget).then(placeholder => {
            if (!placeholder) {
              setCheckedArt(url)
              return
            }
            setCandidateIndex(current => (candidates[current] === url ? nextCandidate(current) : current))
          })
        }
        : undefined}
      onError={() => {
        setCandidateIndex(nextCandidate(candidateIndex))
      }}
    />
  )
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Compact chronological box-art rail shared by public portal analytics. */
export function GamesPlayedStrip({
  games,
  durationSeconds,
  highlightedKey = null,
  onHighlightKey,
  onSelectKey,
  visibleRange = null,
  headerless = false,
  dataEndSeconds = null,
}: GamesPlayedStripProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [hiddenAhead, setHiddenAhead] = useState(0)
  const allSegments = useMemo(
    () => normalizeGameSegments(games ?? [], durationSeconds),
    [games, durationSeconds],
  )
  // (fix, 10-30) GP-3: from the raw games; normalizing already cut them at the chart end.
  const openKeys = useMemo(() => gamesOpenAtDataEnd(games, dataEndSeconds), [games, dataEndSeconds])

  const rangeAware = Boolean(visibleRange) && !headerless
  const inRangeCount = useMemo(() => {
    if (!visibleRange) return allSegments.length
    return allSegments.filter(segment =>
      gameSegmentOverlapsOffsetRange(segment, visibleRange.startOffset, visibleRange.endOffset),
    ).length
  }, [allSegments, visibleRange])
  const hiddenCount = Math.max(0, allSegments.length - inRangeCount)

  const timelineRange = useMemo(() => {
    if (rangeAware && !expanded && visibleRange) {
      return resolveGamesPlayedTimelineRange(visibleRange, durationSeconds, allSegments)
    }
    return resolveGamesPlayedTimelineRange(null, durationSeconds, allSegments)
  }, [allSegments, durationSeconds, expanded, rangeAware, visibleRange])

  const gameSlots = useMemo(() => {
    if (!timelineRange) return []
    return buildGamesPlayedTimelineSlots(allSegments, timelineRange).filter(
      (slot): slot is Extract<typeof slot, { kind: 'segment' }> => slot.kind === 'segment',
    )
  }, [allSegments, timelineRange])

  useEffect(() => {
    const track = trackRef.current
    if (!track) return

    function syncEdges(): void {
      const node = trackRef.current
      if (!node) return
      const overflow = node.scrollWidth - node.clientWidth
      setCanScrollLeft(overflow > 1 && node.scrollLeft > 1)
      setCanScrollRight(overflow > 1 && node.scrollLeft < overflow - 1)
      // (candidate, 10-30) GP1: named posters are measured; chips keep the fixed step.
      const hidden = headerless ? countNamedHiddenAhead(node) : countHiddenAhead(node, gameSlots.length)
      setHiddenAhead(overflow > 1 ? hidden : 0)
    }

    function onWheel(event: WheelEvent): void {
      const node = trackRef.current
      if (!node) return
      const overflow = node.scrollWidth - node.clientWidth
      if (overflow <= 1) return
      // Do not steal ordinary vertical page scrolling from the analytics page.
      // Shift-wheel and native horizontal trackpad gestures still advance the rail.
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) && !event.shiftKey) return
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      if (delta === 0) return
      const next = Math.max(0, Math.min(overflow, node.scrollLeft + delta))
      if (next === node.scrollLeft) return
      event.preventDefault()
      event.stopPropagation()
      node.scrollLeft = next
      syncEdges()
    }

    syncEdges()
    track.addEventListener('scroll', syncEdges, { passive: true })
    track.addEventListener('wheel', onWheel, { passive: false })
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncEdges) : null
    observer?.observe(track)
    return () => {
      track.removeEventListener('scroll', syncEdges)
      track.removeEventListener('wheel', onWheel)
      observer?.disconnect()
    }
  }, [gameSlots.length, headerless])

  useEffect(() => {
    const valid = new Set(gameSlots.map(slot => gameSegmentKey(slot.segment)))
    if (selectedKey && !valid.has(selectedKey)) {
      setSelectedKey(null)
      onSelectKey?.(null)
    }
    if (activeKey && !valid.has(activeKey)) setActiveKey(null)
  }, [activeKey, gameSlots, onSelectKey, selectedKey])

  useEffect(() => {
    if (!selectedKey) return
    function handlePointerDown(event: PointerEvent) {
      if (event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      if (!target) return
      if (target.closest('button, a, input, select, [data-chart-action="true"]')) {
        return
      }
      setSelectedKey(null)
      onSelectKey?.(null)
      onHighlightKey?.(null)
    }
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        setSelectedKey(null)
        onSelectKey?.(null)
        onHighlightKey?.(null)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onHighlightKey, onSelectKey, selectedKey])

  if (!hasMeaningfulGameSegments(allSegments, durationSeconds) || !timelineRange || gameSlots.length === 0) {
    return null
  }

  const displayedKey = activeKey ?? selectedKey
  const displayedSlot = displayedKey
    ? gameSlots.find(slot => gameSegmentKey(slot.segment) === displayedKey) ?? null
    : null

  function scrollByChip(direction: -1 | 1): void {
    const node = trackRef.current
    if (!node) return
    // (candidate, 10-30) GP1: named posters differ in width, so step by the next one's own.
    const left = headerless ? namedScrollStepPx(node, direction) : direction * CHIP_STEP_PX
    node.scrollBy({ left, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }

  function focusRelative(index: number, direction: -1 | 1 | 0): void {
    const buttons = Array.from(
      trackRef.current?.querySelectorAll<HTMLButtonElement>('[data-games-played-item]') ?? [],
    )
    if (!buttons.length) return
    const nextIndex = direction === 0 ? index : Math.max(0, Math.min(buttons.length - 1, index + direction))
    const next = buttons[nextIndex]
    next?.focus({ preventScroll: true })
    next?.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'nearest',
    })
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
      className={headerless ? 'ssc-gp min-w-0 overflow-hidden' : 'mb-2 min-w-0 overflow-hidden rounded border border-white/10 bg-white/[0.02]'}
      aria-label="Games played"
      onMouseLeave={() => {
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
      data-games-played
    >
      {headerless ? null : <div className="flex min-w-0 items-center justify-between gap-2 border-b border-white/10 px-2.5 py-1.5" data-games-played-header>
        <span className="shrink-0 text-xs font-black uppercase tracking-wide text-zinc-400">Games played</span>
        <div className="flex min-w-0 items-center gap-1.5" data-games-played-trail>
          {allSegments.length > 1 ? (
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-xs font-black tabular-nums text-zinc-300">
              {expanded || !rangeAware ? allSegments.length : inRangeCount}
              {rangeAware && hiddenCount > 0 && !expanded ? `/${allSegments.length}` : ''}
            </span>
          ) : null}
          {rangeAware && hiddenCount > 0 ? (
            <button
              type="button"
              className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-xs font-black uppercase tracking-wide text-zinc-400 transition hover:border-white/25 hover:text-zinc-100"
              aria-expanded={expanded}
              onClick={() => setExpanded(value => !value)}
            >
              {expanded ? 'Chart window' : `Show all ${allSegments.length}`}
            </button>
          ) : null}
        </div>
      </div>}

      <div className={headerless ? 'min-w-0 overflow-hidden' : 'min-w-0 overflow-hidden px-2.5 py-1.5'} data-games-timeline data-timeline-start={timelineRange.startOffset} data-timeline-end={timelineRange.endOffset}>
        <div className="relative min-w-0 w-full">
          <div
            ref={trackRef}
            className="flex min-h-[74px] min-w-0 w-full items-center gap-2 overflow-x-auto overflow-y-hidden px-0.5 py-0.5 [justify-content:safe_center] [scrollbar-width:none] [-ms-overflow-style:none] [touch-action:pan-y] [&::-webkit-scrollbar]:hidden"
            role="list"
            tabIndex={-1}
            aria-label="Games played timeline"
            data-games-played-track
          >
            {gameSlots.map((slot, index) => {
              const { segment } = slot
              const key = gameSegmentKey(segment)
              const selected = selectedKey === key
              const active = highlightedKey === key || selected
              // (fix, 10-30) GP-3 / GP-7: an estimated switch says so; a run past the data end is open.
              const estimated = isEstimatedGameSource(segment.source)
              const open = openKeys.has(key)
              const note = runTimeNote(estimated, open ? dataEndSeconds : null)
              const title = `${segment.gameName} · ${formatWindowLabel(slot.visibleStart, slot.visibleEnd, headerless, { estimated, open })}${slot.clipped ? ' · clipped to chart' : ''}${note ? ` · ${note}` : ''}`
              const detailsId = `games-played-details-${index}-${key.replace(/[^a-z0-9_-]/gi, '-')}`

              return (
                <div
                  key={`${segment.gameName}-${segment.offsetSeconds}-${index}`}
                  role="listitem"
                  aria-label={title}
                  className={headerless ? 'ssc-gp-i relative flex flex-col items-center gap-0.5' : 'relative shrink-0'}
                  // (candidate, 10-30) GP1: as wide as the name line, 52 to 96 px.
                  style={headerless
                    ? { flex: '0 0 auto', minWidth: GAMES_PLAYED_HIT_TARGET_PX, maxWidth: GAMES_PLAYED_NAME_MAX_PX }
                    : { flex: `0 0 ${GAMES_PLAYED_HIT_TARGET_PX}px` }}
                >
                  <button
                    type="button"
                    className={headerless ? 'ssc-gp-b relative flex items-center justify-center' : `relative flex items-center justify-center rounded-lg border-2 p-0.5 outline-none transition ${
                      active
                        ? 'border-zinc-300 bg-white/[0.08] shadow-[0_0_0_2px_rgba(255,255,255,.08)]'
                        : slot.clipped
                          ? 'border-dashed border-white/20 bg-white/[0.03]'
                          : 'border-white/10 bg-white/[0.03]'
                    }`}
                    style={{ height: GAMES_PLAYED_HIT_TARGET_HEIGHT_PX, width: GAMES_PLAYED_HIT_TARGET_PX }}
                    title={title}
                    aria-label={title}
                    aria-pressed={selected}
                    aria-describedby={displayedKey === key ? detailsId : undefined}
                    data-games-played-item
                    data-game-key={key}
                    data-hl={headerless && active ? '' : undefined}
                    onMouseEnter={() => {
                      setActiveKey(key)
                      onHighlightKey?.(key)
                    }}
                    onFocus={() => {
                      setActiveKey(key)
                      onHighlightKey?.(key)
                    }}
                    onBlur={event => {
                      if (typeof Node !== 'undefined' && event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return
                      setActiveKey(currentKey => currentKey === key ? null : currentKey)
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
                    <GameArt gameName={segment.gameName} boxArtUrl={segment.boxArtUrl} categoryId={segment.categoryId} />
                  </button>
                  {headerless ? (
                    <>
                      {/* (candidate, 10-30) GP1: name and run time as visible lines (sp-session-chart.css). */}
                      <span className="ssc-gp-name" data-games-played-name title={segment.gameName}>{segment.gameName}</span>
                      <span className="ssc-gp-rt" data-games-played-run-time title={note || undefined}>
                        {runTimeText(slot.visibleEnd - slot.visibleStart, estimated, open)}
                      </span>
                    </>
                  ) : null}
                  {displayedKey === key ? <span id={detailsId} role="tooltip" className="sr-only">{title}</span> : null}
                </div>
              )
            })}
          </div>
          {canScrollLeft ? (
            <>
              <div className="pointer-events-none absolute inset-y-0 left-0 z-[1] w-8 bg-gradient-to-r from-zinc-950/90 to-transparent" aria-hidden="true" />
              <button type="button" className="absolute left-0 top-1/2 z-[2] flex h-[70px] w-[52px] -translate-y-1/2 items-center justify-center bg-transparent text-base text-zinc-300/80 hover:text-white" aria-label="Previous games" title="Previous games" onClick={() => scrollByChip(-1)}><span className="flex h-7 w-[22px] items-center justify-center rounded-full border border-white/10 bg-zinc-950/90 shadow-lg">‹</span></button>
            </>
          ) : null}
          {canScrollRight ? (
            <>
              <div className="pointer-events-none absolute inset-y-0 right-0 z-[1] w-8 bg-gradient-to-l from-zinc-950/90 to-transparent" aria-hidden="true" />
              <button type="button" className="absolute right-0 top-1/2 z-[2] flex h-[70px] w-[52px] -translate-y-1/2 items-center justify-center bg-transparent text-base text-zinc-300/80 hover:text-white" aria-label={hiddenAhead > 0 ? `Show ${hiddenAhead} more games` : 'Show more games'} title="More games" onClick={() => scrollByChip(1)}><span className="flex h-7 w-[22px] items-center justify-center rounded-full border border-white/10 bg-zinc-950/90 shadow-lg">›</span></button>
            </>
          ) : null}
        </div>
      </div>

      {displayedSlot && !headerless ? (
        <div
          className="mx-2.5 mb-1 min-w-0 truncate px-0.5 text-xs font-semibold tabular-nums text-zinc-400"
          data-games-played-details
          aria-live="polite"
          title={`${displayedSlot.segment.gameName} · ${formatWindowLabel(displayedSlot.visibleStart, displayedSlot.visibleEnd)}${displayedSlot.clipped ? ' · chart window' : ''}`}
        >
          <span className="font-black text-zinc-300" data-games-played-details-name>{displayedSlot.segment.gameName}</span>
          <span className="mx-1 text-zinc-700" aria-hidden="true" data-games-played-details-sep>·</span>
          <span>{formatWindowLabel(displayedSlot.visibleStart, displayedSlot.visibleEnd)}</span>
          {displayedSlot.clipped ? <span> · chart window</span> : null}
          {selectedKey === displayedKey ? <span className="ml-1 text-cyan-300">· pinned</span> : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * (fix, 10-30) GP-6: the games list for the chart's empty, loading and syncing
 * states, so a stream with games but no minutes still says what was played.
 * A length only where one is recorded: the last game of a stream with no end
 * (or a game with no length) shows its start instead, never the open record's
 * run to now.
 */
export function GamesPlayedList({
  games,
  streamEnded,
}: {
  games?: ChartGameSegment[] | null
  /** The stream record has an end (endedAt or a confirmed end). */
  streamEnded: boolean
}) {
  const rows = useMemo(
    () => (games ?? [])
      .filter(game =>
        game.gameName?.trim()
        && Number.isFinite(game.offsetSeconds)
        && Number.isFinite(game.durationSeconds)
        && game.offsetSeconds >= 0,
      )
      .slice()
      .sort((a, b) => a.offsetSeconds - b.offsetSeconds),
    [games],
  )
  if (!rows.length) return null
  return (
    <div aria-label="Games played" data-games-played-list className="mx-auto mt-4 w-full max-w-sm text-left">
      <p className="mb-1.5 text-xs font-semibold text-zinc-400">Games played</p>
      <ul className="flex flex-col gap-1.5">
        {rows.map((game, index) => {
          const estimated = isEstimatedGameSource(game.source)
          const last = index === rows.length - 1
          const noEnd = game.durationSeconds <= 0 || (last && !streamEnded && game.source !== 'stored')
          const time = noEnd ? `from ${hms(game.offsetSeconds)}` : runTimeText(game.durationSeconds, estimated, false)
          const note = [noEnd ? 'No end recorded yet.' : null, estimated ? ESTIMATE_NOTE : null].filter(Boolean).join(' ')
          return (
            <li key={`${gameSegmentKey(game)}-${index}`} className="flex min-w-0 items-center gap-2" data-games-played-list-item>
              <GameArt gameName={game.gameName} boxArtUrl={game.boxArtUrl} categoryId={game.categoryId} size={24} width={18} />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-200" title={game.gameName}>{game.gameName}</span>
              <span className="shrink-0 text-xs tabular-nums text-zinc-400" title={note || undefined} data-games-played-list-time>{time}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
