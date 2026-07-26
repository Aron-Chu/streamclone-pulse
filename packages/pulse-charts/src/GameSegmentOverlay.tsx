import type { ChartGameSegment, ChartMinuteRollup } from './types.ts'
import {
  gameSegmentPlotBounds,
  gameSegmentPlotBoundsByOffsets,
} from './gameSegmentChart.ts'

const GAME_ACCENT = '#f97316'
/** Skip dividers glued to the left axis (segment started before the visible window). */
const LEFT_EDGE_EPSILON_PX = 2

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
  /**
   * When set (extension index-spaced charts), map dividers by rollup offsets
   * instead of wall-clock time so spike-downsampled full-stream charts align.
   */
  chartOffsets?: readonly number[]
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
export const ACTIVE_GAME_CAP_DASHARRAY = '5 5'

/**
 * Game markers as vertical dashed dividers through the chart (no on-plot lettering).
 * Readable game names belong in the Games played list below/beside the chart.
 * Live only: dashed right-edge marker means the current game runs to "now".
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
  isLive = false,
}: GameSegmentOverlayProps) {
  const lineBottom = gameBandTop + Math.max(48, dividerExtent)
  const useOffsets = (chartOffsets?.length ?? 0) > 0
  const showActiveCap = shouldRenderActiveGameCap(isLive, segments.length)

  let lastVisibleGameName: string | undefined
  if (showActiveCap) {
    for (const segment of segments) {
      const bounds = useOffsets
        ? gameSegmentPlotBoundsByOffsets(segment, chartOffsets!, padLeft, plotWidth)
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
          : gameSegmentPlotBounds(
              segment,
              rollups,
              streamStartedAt,
              padLeft,
              plotWidth,
            )
        if (!bounds) return null
        const { startX } = bounds
        // Continuations that began before the visible window clamp to the left axis — skip.
        if (startX <= padLeft + LEFT_EDGE_EPSILON_PX) return null

        const isEstimated = segment.source === 'category_fallback'
        const title = isEstimated ? `Est. ${segment.gameName}` : segment.gameName

        return (
          <g key={segment.id ?? `${segment.gameName}-${segment.offsetSeconds}-${index}`}>
            <title>{title}</title>
            <line
              x1={startX}
              x2={startX}
              y1={gameBandTop}
              y2={lineBottom}
              stroke={GAME_ACCENT}
              strokeWidth={1.5}
              strokeDasharray={isEstimated ? '4 4' : '5 5'}
              opacity={0.85}
              shapeRendering="geometricPrecision"
            >
              <title>{title}</title>
            </line>
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
            strokeWidth={2}
            strokeDasharray={ACTIVE_GAME_CAP_DASHARRAY}
            opacity={0.95}
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
