import { useEffect, useMemo, useRef, useState } from 'react'
import { formatHeatOffset } from '@streampulse/pulse-core'
import {
  CHART_PLOT_PAD_LEFT,
  CHART_PLOT_PAD_RIGHT,
  buildGamesPlayedTimelineSlots,
  gameSegmentKey,
  gameSegmentOverlapsOffsetRange,
  hasMeaningfulGameSegments,
  normalizeGameSegments,
  resolveGamesPlayedTimelineRange,
  type ChartGameSegment,
} from '@streampulse/pulse-charts'

/** Fixed chip width — equal, readable, and forces horizontal scroll when many games. */
export const GAMES_PLAYED_CHIP_WIDTH_PX = 112
/** @deprecated use GAMES_PLAYED_CHIP_WIDTH_PX */
export const GAMES_PLAYED_CHIP_MIN_WIDTH_PX = GAMES_PLAYED_CHIP_WIDTH_PX

const CHIP_GAP_PX = 4
const CHIP_STEP_PX = GAMES_PLAYED_CHIP_WIDTH_PX + CHIP_GAP_PX

export interface GamesPlayedVisibleRange {
  startOffset: number
  endOffset: number
}

export interface GamesPlayedStripProps {
  games?: ChartGameSegment[]
  durationSeconds: number
  highlightedKey?: string | null
  onHighlightKey?: (key: string | null) => void
  /**
   * Live charts: when set, the strip is range-aware (chart window) and offers
   * expand to show the full stream timeline. Offline/VOD/recap omit this so the
   * full session timeline stays always expanded.
   */
  visibleRange?: GamesPlayedVisibleRange | null
  /** Match PulseMultiSignalChart plot insets so the bar edges the series. */
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

function countHiddenAhead(node: HTMLDivElement, total: number): number {
  const overflow = node.scrollWidth - node.clientWidth
  if (overflow <= 1 || total <= 0) return 0
  const scrolledPast = Math.max(0, Math.round(node.scrollLeft / CHIP_STEP_PX))
  const visibleApprox = Math.max(1, Math.floor((node.clientWidth + CHIP_GAP_PX) / CHIP_STEP_PX))
  return Math.max(0, total - scrolledPast - visibleApprox)
}

/**
 * Readable equal-width game chips.
 * Hover still maps to chart highlight via segment key; chip width is not a mini-timeline.
 */
export function GamesPlayedStrip({
  games,
  durationSeconds,
  highlightedKey = null,
  onHighlightKey,
  visibleRange = null,
  plotPadLeft = CHART_PLOT_PAD_LEFT,
  plotPadRight = CHART_PLOT_PAD_RIGHT,
}: GamesPlayedStripProps) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const nudgedRef = useRef(false)
  const [expanded, setExpanded] = useState(false)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [hiddenAhead, setHiddenAhead] = useState(0)
  const allSegments = useMemo(
    () => normalizeGameSegments(games ?? [], durationSeconds),
    [games, durationSeconds],
  )

  const rangeAware = Boolean(visibleRange)
  const inRangeCount = useMemo(() => {
    if (!visibleRange) return allSegments.length
    return allSegments.filter(segment =>
      gameSegmentOverlapsOffsetRange(
        segment,
        visibleRange.startOffset,
        visibleRange.endOffset,
      ),
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
      if (overflow <= 1) {
        setCanScrollLeft(false)
        setCanScrollRight(false)
        setHiddenAhead(0)
        return
      }
      setCanScrollLeft(node.scrollLeft > 1)
      setCanScrollRight(node.scrollLeft < overflow - 1)
      setHiddenAhead(countHiddenAhead(node, gameSlots.length))
    }

    function onWheel(event: WheelEvent): void {
      const node = trackRef.current
      if (!node) return
      const overflow = node.scrollWidth - node.clientWidth
      if (overflow <= 1) return
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
    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncEdges) : null
    resizeObserver?.observe(track)

    if (!nudgedRef.current && track.scrollWidth - track.clientWidth > CHIP_STEP_PX) {
      nudgedRef.current = true
      const reducedMotion =
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (!reducedMotion) {
        const start = track.scrollLeft
        window.setTimeout(() => {
          const node = trackRef.current
          if (!node || node.scrollLeft !== start) return
          node.scrollTo({ left: Math.min(36, node.scrollWidth - node.clientWidth), behavior: 'smooth' })
          window.setTimeout(() => {
            const again = trackRef.current
            if (!again || again.scrollLeft > 40) return
            again.scrollTo({ left: 0, behavior: 'smooth' })
          }, 420)
        }, 480)
      }
    }

    return () => {
      track.removeEventListener('scroll', syncEdges)
      track.removeEventListener('wheel', onWheel)
      resizeObserver?.disconnect()
    }
  }, [gameSlots.length])

  if (!hasMeaningfulGameSegments(allSegments, durationSeconds) || !timelineRange || gameSlots.length === 0) {
    return null
  }

  function handleStripLeave(): void {
    onHighlightKey?.(null)
  }

  function scrollByChip(direction: -1 | 1): void {
    const node = trackRef.current
    if (!node) return
    node.scrollBy({ left: direction * CHIP_STEP_PX, behavior: 'smooth' })
  }

  return (
    <div
      className="mb-2 min-w-0 overflow-hidden rounded border border-white/10 bg-white/[0.02]"
      aria-label="Games played"
      onMouseLeave={handleStripLeave}
    >
      <div className="flex items-center justify-center gap-2 border-b border-white/10 px-2.5 py-2">
        <span className="shrink-0 text-[10px] font-black uppercase tracking-wide text-zinc-500">
          Games played
        </span>
        {allSegments.length > 1 ? (
          <span className="rounded-full border border-orange-400/25 bg-orange-500/10 px-1.5 py-0.5 text-[9px] font-black tabular-nums text-orange-200">
            {expanded || !rangeAware ? allSegments.length : inRangeCount}
            {rangeAware && hiddenCount > 0 && !expanded ? `/${allSegments.length}` : ''}
          </span>
        ) : null}
        {canScrollRight && hiddenAhead > 0 ? (
          <span className="text-[9px] font-bold text-orange-300/90">+{hiddenAhead} more · scroll</span>
        ) : null}
        {rangeAware && hiddenCount > 0 ? (
          <button
            type="button"
            className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-zinc-400 transition hover:border-orange-400/40 hover:text-orange-200"
            aria-expanded={expanded}
            onClick={() => setExpanded(value => !value)}
          >
            {expanded ? 'Chart window' : `Show all ${allSegments.length}`}
          </button>
        ) : null}
      </div>

      <div
        className="min-w-0 py-2"
        style={{ paddingLeft: plotPadLeft, paddingRight: plotPadRight }}
        data-games-timeline
        data-timeline-start={timelineRange.startOffset}
        data-timeline-end={timelineRange.endOffset}
      >
        <div className="relative min-w-0 w-full">
          <div
            ref={trackRef}
            className="flex min-h-11 min-w-0 w-full items-stretch gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
            role="list"
            tabIndex={0}
            aria-label="Scroll games played"
          >
            {gameSlots.map((slot, index) => {
              const { segment } = slot
              const key = gameSegmentKey(segment)
              const isHighlighted = highlightedKey === key
              const boxArt = segment.boxArtUrl?.trim()
              const title = `${segment.gameName} · ${formatWindowLabel(slot.visibleStart, slot.visibleEnd)}${
                slot.clipped ? ' · clipped to chart' : ''
              }`

              return (
                <button
                  key={`${segment.gameName}-${segment.offsetSeconds}-${index}`}
                  type="button"
                  role="listitem"
                  title={title}
                  aria-label={title}
                  className={`flex shrink-0 cursor-pointer flex-col items-center justify-center gap-0.5 overflow-hidden rounded-md border px-2 py-1.5 text-center outline-none transition ${
                    isHighlighted
                      ? 'border-orange-400/80 bg-orange-500/25 shadow-[0_0_0_1px_rgba(249,115,22,0.35)]'
                      : slot.clipped
                        ? 'border-dashed border-orange-400/35 bg-orange-500/[0.08] hover:border-orange-400/55 hover:bg-orange-500/15'
                        : 'border-orange-400/30 bg-orange-500/[0.07] hover:border-orange-400/55 hover:bg-orange-500/15'
                  }`}
                  style={{ width: GAMES_PLAYED_CHIP_WIDTH_PX, flex: `0 0 ${GAMES_PLAYED_CHIP_WIDTH_PX}px` }}
                  onMouseEnter={() => onHighlightKey?.(key)}
                  onFocus={() => onHighlightKey?.(key)}
                  onBlur={() => onHighlightKey?.(null)}
                >
                  <span className="flex min-w-0 max-w-full items-center justify-center gap-1">
                    {boxArt ? (
                      <img
                        src={boxArt}
                        alt=""
                        className="h-4 w-3 shrink-0 rounded-sm object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : null}
                    <span className="min-w-0 truncate text-[10px] font-black leading-snug text-orange-200">
                      {segment.gameName}
                    </span>
                  </span>
                  <span className="max-w-full truncate text-[9px] font-semibold tabular-nums text-zinc-500">
                    {formatHeatOffset(slot.visibleStart)}
                    <span className="mx-0.5 opacity-65" aria-hidden="true">
                      –
                    </span>
                    {formatHeatOffset(slot.visibleEnd)}
                  </span>
                </button>
              )
            })}
          </div>
          {canScrollLeft ? (
            <>
              <div
                className="pointer-events-none absolute inset-y-0 left-0 z-[1] w-7 bg-gradient-to-r from-zinc-950/90 to-transparent"
                aria-hidden="true"
              />
              <button
                type="button"
                className="absolute left-0 top-1/2 z-[2] -translate-y-1/2 border-0 bg-transparent px-1 text-xl font-medium leading-none text-orange-200/55 hover:text-orange-200/85"
                aria-label="Previous games"
                title="Previous games"
                onClick={() => scrollByChip(-1)}
              >
                ‹
              </button>
            </>
          ) : null}
          {canScrollRight ? (
            <>
              <div
                className="pointer-events-none absolute inset-y-0 right-0 z-[1] w-7 bg-gradient-to-l from-zinc-950/90 to-transparent"
                aria-hidden="true"
              />
              <button
                type="button"
                className="absolute right-0 top-1/2 z-[2] -translate-y-1/2 border-0 bg-transparent px-1 text-xl font-medium leading-none text-orange-200/55 hover:text-orange-200/85"
                aria-label={hiddenAhead > 0 ? `Show ${hiddenAhead} more games` : 'Show more games'}
                title={hiddenAhead > 0 ? `+${hiddenAhead} more · scroll` : 'More games'}
                onClick={() => scrollByChip(1)}
              >
                ›
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
