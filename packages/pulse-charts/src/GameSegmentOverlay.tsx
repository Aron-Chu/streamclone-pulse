import type { ChartGameSegment, ChartMinuteRollup } from './types.ts'
import {
  gameSegmentPlotBounds,
  gameSegmentPlotBoundsByOffsets,
  gameSegmentPlotBoundsByTimestampScale,
} from './gameSegmentChart.ts'
import { gameSegmentKey } from './gameSegments.ts'
import type { ViewerTimestampScale } from './viewerGeometry.ts'

const GAME_ACCENT = '#f97316'
/** Skip dividers glued to the left axis (segment started before the visible window). */
const LEFT_EDGE_EPSILON_PX = 2
/** Box-art icon size on the chart (px, in viewBox units). 28 fits the activity band. */
const GAME_ICON_SIZE = 28

function safeGameArtUrl(url: string | undefined): string | null {
  if (!url) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null
  const host = parsed.hostname.toLowerCase()
  const isTwitchBoxArt = host === 'static-cdn.jtvnw.net' && parsed.pathname.startsWith('/ttv-boxart/')
  if (!isTwitchBoxArt) return null
  return parsed.toString()
}

function resolveGameArtUrl(boxArtUrl: string | undefined, categoryId: string | undefined): string | null {
  const explicit = safeGameArtUrl(boxArtUrl)
  if (explicit) return explicit
  const normalizedCategoryId = categoryId?.trim()
  if (!normalizedCategoryId || !/^\d{1,20}$/.test(normalizedCategoryId)) return null
  return `https://static-cdn.jtvnw.net/ttv-boxart/${normalizedCategoryId}-144x192.jpg`
}

export interface GameSegmentOverlayProps {
  segments: ChartGameSegment[]
  rollups: ChartMinuteRollup[]
  streamStartedAt?: string
  padLeft: number
  plotWidth: number
  /** Top of the plot area — divider lines start here. */
  gameBandTop: number
  /**
   * @deprecated Horizontal band height. Ignored — games render as vertical
   * dividers through the plot (not a top strip).
   */
  gameBandHeight?: number
  /** @deprecated Labels removed from plot — names live in Games played list. */
  labelAnchorY?: number
  /**
   * How far the vertical divider extends downward from gameBandTop.
   * Callers should pass full plot height so the line reaches viewers → chat → emotes.
   */
  dividerExtent?: number
  /** @deprecated Labels removed from plot. */
  minLabelWidth?: number
  /** Only the strip-focused game divider is visible at rest. */
  highlightedSegmentKey?: string | null
  /**
   * When set (extension index-spaced charts), map dividers by rollup offsets
   * instead of wall-clock time so spike-downsampled full-stream charts align.
   */
  chartOffsets?: readonly number[]
  /** Shared timestamp domain used by paths, bars, cursors, and game dividers. */
  timestampScale?: ViewerTimestampScale
  /**
   * When true, paint a dashed right-edge marker at "now" for the active live game.
   * Mid-stream dashed dividers remain game *changes* only (left-glued starts still skipped).
   */
  isLive?: boolean
}

/** Live charts with at least one game segment get the dashed right-edge "now" cap. */
export function shouldRenderActiveGameCap(
  isLive: boolean | undefined,
  segmentCount: number,
): boolean {
  return Boolean(isLive) && segmentCount > 0
}

/** Right plot edge X — live "now" cap sits here (not segment endX). */
export function activeGameCapX(padLeft: number, plotWidth: number): number {
  return padLeft + plotWidth
}

/** Tooltip for the live right-edge cap. */
export function activeGameCapTitle(gameName: string | undefined): string | undefined {
  const name = gameName?.trim()
  if (!name) return undefined
  return `${name} — live`
}

/** Match game-change dividers — orange markers stay dotted, never a solid bar. */
export const ACTIVE_GAME_CAP_DASHARRAY = '4 6'

/**
 * The Games played strip owns game selection; at rest only the selected game's
 * divider is revealed to keep long sessions quiet. Readable game names belong
 * in the strip. Live only: the dashed right-edge marker means the current game
 * runs to "now".
 */
export function GameSegmentOverlay({
  segments,
  rollups,
  streamStartedAt,
  padLeft,
  plotWidth,
  gameBandTop,
  dividerExtent = 240,
  chartOffsets,
  timestampScale,
  isLive = false,
  highlightedSegmentKey = null,
}: GameSegmentOverlayProps) {
  const lineBottom = gameBandTop + Math.max(48, dividerExtent)
  const useOffsets = !timestampScale && (chartOffsets?.length ?? 0) > 0
  const showActiveCap = shouldRenderActiveGameCap(isLive, segments.length)

  let lastVisibleGameName: string | undefined
  if (showActiveCap) {
    for (const segment of segments) {
      const bounds = useOffsets
        ? gameSegmentPlotBoundsByOffsets(segment, chartOffsets!, padLeft, plotWidth)
        : timestampScale
          ? gameSegmentPlotBoundsByTimestampScale(segment, timestampScale, streamStartedAt)
        : gameSegmentPlotBounds(
            segment,
            rollups,
            streamStartedAt,
            padLeft,
            plotWidth,
          )
      if (bounds) lastVisibleGameName = segment.gameName
    }
  }
  const capTitle = activeGameCapTitle(lastVisibleGameName)
  const capX = activeGameCapX(padLeft, plotWidth)

  return (
    <>
      {segments.map((segment, index) => {
        const bounds = useOffsets
          ? gameSegmentPlotBoundsByOffsets(segment, chartOffsets!, padLeft, plotWidth)
          : timestampScale
            ? gameSegmentPlotBoundsByTimestampScale(segment, timestampScale, streamStartedAt)
          : gameSegmentPlotBounds(
              segment,
              rollups,
              streamStartedAt,
              padLeft,
              plotWidth,
            )
        if (!bounds) return null
        const { startX, centerX } = bounds
        // Continuations that began before the visible window clamp to the left axis — skip.
        if (startX <= padLeft + LEFT_EDGE_EPSILON_PX) return null
        if (highlightedSegmentKey !== gameSegmentKey(segment)) return null

        const isEstimated = segment.source === 'category_fallback'
        const title = isEstimated ? `Est. ${segment.gameName}` : segment.gameName
        const iconUrl = resolveGameArtUrl(segment.boxArtUrl, segment.categoryId)
        const iconY = gameBandTop + Math.max(0, lineBottom - gameBandTop - GAME_ICON_SIZE) / 2

        return (
          <g key={segment.id ?? `${segment.gameName}-${segment.offsetSeconds}-${index}`}>
            <title>{title}</title>
            <line
              x1={startX}
              x2={startX}
              y1={gameBandTop}
              y2={lineBottom}
              stroke={GAME_ACCENT}
              strokeWidth={1}
              strokeDasharray={isEstimated ? '3 5' : '4 6'}
              opacity={0.72}
              vectorEffect="non-scaling-stroke"
              shapeRendering="geometricPrecision"
            >
              <title>{title}</title>
            </line>
            {iconUrl ? (
              <image
                href={iconUrl}
                xlinkHref={iconUrl}
                x={centerX - GAME_ICON_SIZE / 2}
                y={iconY}
                width={GAME_ICON_SIZE}
                height={GAME_ICON_SIZE}
                preserveAspectRatio="xMidYMid slice"
                data-game-icon="true"
                opacity={0.92}
                pointerEvents="none"
              >
                <title>{title}</title>
              </image>
            ) : null}
          </g>
        )
      })}
      {showActiveCap ? (
        <g key="active-game-cap" data-active-game-cap="true">
          {capTitle ? <title>{capTitle}</title> : null}
          <line
            x1={capX}
            x2={capX}
            y1={gameBandTop}
            y2={lineBottom}
            stroke={GAME_ACCENT}
            strokeWidth={1.25}
            strokeDasharray={ACTIVE_GAME_CAP_DASHARRAY}
            opacity={0.45}
            vectorEffect="non-scaling-stroke"
            shapeRendering="geometricPrecision"
            data-active-game-cap="true"
          >
            {capTitle ? <title>{capTitle}</title> : null}
          </line>
        </g>
      ) : null}
    </>
  )
}
