import type { ChartSelection } from '@streampulse/pulse-core'
import {
  buildChatIntervalSelection,
  chartSelectionCanonicalOffset,
  reactionAnalyticalOffset,
} from '@streampulse/pulse-core'
import {
  findReactionMomentAtPlotX,
  type ReactionLaneGeometry,
} from '@streampulse/pulse-charts'
import type { ExtensionPeak, ExtensionRollup } from '../shared/messages.ts'

export type IntervalLaneBar = {
  x: number
  y: number
  width: number
  height: number
  sourceIndex?: number
  hasValue?: boolean
  startIndex: number
  endExclusive: number
  average: number
  peak: { index: number; value: number; offsetSeconds?: number } | null
  observedCount: number
  rangeLength: number
  observedRatio: number
  fullyObserved: boolean
  value: number
  /** First canonical minute represented by the bar interval. */
  startOffsetSeconds: number
  /** Exclusive interval end (first minute not represented). */
  endOffsetSeconds: number
  /**
   * Interval midpoint used for bar x. Trend vertices use the same clock.
   * Never treat this as the interval start.
   */
  offsetSeconds: number
}

type LaneBarColumn = Pick<
  IntervalLaneBar,
  'x' | 'width' | 'startOffsetSeconds' | 'endOffsetSeconds'
>

export type HoverBucketBandGeom = {
  x: number
  width: number
}

/** Pin/hover lock X: center of the LOD bar whose window contains the offset. */
export function columnCenterXForOffset(
  bars: Array<LaneBarColumn | null>,
  offsetSeconds: number,
): number | null {
  const band = columnBandForOffset(bars, offsetSeconds)
  return band != null ? band.x + band.width / 2 : null
}

/** Column rect of the LOD bar whose window contains the offset. */
export function columnBandForOffset(
  bars: Array<LaneBarColumn | null>,
  offsetSeconds: number,
): HoverBucketBandGeom | null {
  if (!Number.isFinite(offsetSeconds)) return null
  for (const bar of bars) {
    if (!bar) continue
    if (offsetSeconds >= bar.startOffsetSeconds && offsetSeconds < bar.endOffsetSeconds) {
      return { x: bar.x, width: bar.width }
    }
  }
  return null
}

/** Hover highlight follows the chat column, then emotes, then the display index. */
export function resolveHoverBucketBand(args: {
  chatBars: Array<LaneBarColumn | null>
  emoteBars: Array<LaneBarColumn | null>
  offsetSeconds: number | null
  fallbackIndex: number | null
}): HoverBucketBandGeom | null {
  const { chatBars, emoteBars, offsetSeconds, fallbackIndex } = args
  if (offsetSeconds != null && Number.isFinite(offsetSeconds)) {
    const fromOffset =
      columnBandForOffset(chatBars, offsetSeconds)
      ?? columnBandForOffset(emoteBars, offsetSeconds)
    if (fromOffset) return fromOffset
  }
  if (fallbackIndex == null || fallbackIndex < 0) return null
  const fallback = chatBars[fallbackIndex] ?? emoteBars[fallbackIndex]
  if (!fallback) return null
  return { x: fallback.x, width: fallback.width }
}

export type ClickColumnWindow = {
  startOffsetSeconds: number
  endOffsetSeconds: number
}

function barContainsX(bar: IntervalLaneBar, plotX: number): boolean {
  return plotX >= bar.x && plotX <= bar.x + bar.width
}

export function columnWindowAtPlotX(
  bars: readonly (IntervalLaneBar | null)[],
  plotX: number,
): ClickColumnWindow | null {
  const bar = hitLaneBar(bars, plotX, false)
  if (!bar) return null
  return {
    startOffsetSeconds: bar.startOffsetSeconds,
    endOffsetSeconds: bar.endOffsetSeconds,
  }
}

function hitLaneBar(
  bars: readonly (IntervalLaneBar | null)[],
  plotX: number,
  snapToNearest: boolean,
): IntervalLaneBar | null {
  if (snapToNearest) return nearestBar(bars, plotX)
  for (const bar of bars) {
    if (!bar || !bar.hasValue) continue
    if (barContainsX(bar, plotX)) return bar
  }
  return null
}

function nearestBar(
  bars: readonly (IntervalLaneBar | null)[],
  plotX: number,
): IntervalLaneBar | null {
  let best: IntervalLaneBar | null = null
  let bestDist = Number.POSITIVE_INFINITY
  for (const bar of bars) {
    if (!bar || !bar.hasValue) continue
    if (barContainsX(bar, plotX)) return bar
    const center = bar.x + bar.width / 2
    const dist = Math.abs(center - plotX)
    if (dist < bestDist) {
      bestDist = dist
      best = bar
    }
  }
  return bestDist <= Math.max(8, (best?.width ?? 0) / 2 + 4) ? best : null
}

/**
 * Find the nearest covered canonical minute without scanning the entire
 * timeline on every pointer sample. Offsets are sorted; expand from the
 * insertion point until the next possible distance cannot beat the current
 * covered candidate. Missing runs are still skipped honestly.
 */
function nearestCoveredRollupIndex(
  rollups: readonly ExtensionRollup[],
  offsetSeconds: number,
): number {
  if (rollups.length === 0 || !Number.isFinite(offsetSeconds)) return -1
  let low = 0
  let high = rollups.length - 1
  while (low < high) {
    const mid = low + Math.floor((high - low) / 2)
    const offset = rollups[mid]?.offsetSeconds ?? Number.POSITIVE_INFINITY
    if (offset < offsetSeconds) low = mid + 1
    else high = mid
  }

  let left = low - 1
  let right = low
  let bestIndex = -1
  let bestDistance = Number.POSITIVE_INFINITY
  while (left >= 0 || right < rollups.length) {
    const leftDistance = left >= 0
      ? Math.abs((rollups[left]?.offsetSeconds ?? Number.NEGATIVE_INFINITY) - offsetSeconds)
      : Number.POSITIVE_INFINITY
    const rightDistance = right < rollups.length
      ? Math.abs((rollups[right]?.offsetSeconds ?? Number.POSITIVE_INFINITY) - offsetSeconds)
      : Number.POSITIVE_INFINITY
    if (leftDistance <= rightDistance) {
      if (leftDistance > bestDistance) break
      const point = rollups[left]
      if (point && !point.missing && leftDistance < bestDistance) {
        bestIndex = left
        bestDistance = leftDistance
      }
      left -= 1
    } else {
      if (rightDistance > bestDistance) break
      const point = rollups[right]
      if (point && !point.missing && rightDistance < bestDistance) {
        bestIndex = right
        bestDistance = rightDistance
      }
      right += 1
    }
  }
  return bestIndex
}

export function resolveOverviewPointerSelection(args: {
  plotX: number
  plotY: number
  chatBars: readonly (IntervalLaneBar | null)[]
  emoteBars: readonly (IntervalLaneBar | null)[]
  reactionBars: readonly ReactionLaneGeometry[]
  reactionPoints: readonly ExtensionPeak[]
  reactionGutterTop: number
  reactionGutterBottom: number
  emoteMagnitudeTop: number
  emoteMagnitudeBottom: number
  chatLaneTop: number
  chatLaneBottom: number
  displayRollups: readonly ExtensionRollup[]
  viewportStartSeconds: number
  viewportDuration: number
  fraction: number
  /** Whether lane hits may use the bounded nearest-column snap radius. */
  snapToNearestBar?: boolean
}): ChartSelection {
  const {
    plotX,
    plotY,
    chatBars,
    emoteBars,
    reactionBars,
    reactionPoints,
    reactionGutterTop,
    reactionGutterBottom,
    emoteMagnitudeTop,
    emoteMagnitudeBottom,
    chatLaneTop,
    chatLaneBottom,
    displayRollups,
    viewportStartSeconds,
    viewportDuration,
    fraction,
  } = args
  const snapToNearestBar = args.snapToNearestBar !== false

  if (
    reactionBars.length > 0
    && plotY >= reactionGutterTop
    && plotY <= reactionGutterBottom
  ) {
    const hit = findReactionMomentAtPlotX(reactionBars, plotX, 10)
    if (hit) {
      const sourceMoment =
        reactionPoints.find(
          (point) => point.offsetSeconds === hit.moment.offsetSeconds,
        ) ?? (hit.moment as ExtensionPeak)
      const analyticalOffsetSeconds = reactionAnalyticalOffset({
        offsetSeconds: sourceMoment.offsetSeconds,
        reactionOnsetOffsetSeconds: sourceMoment.reactionOnsetOffsetSeconds,
        reactionApexOffsetSeconds: sourceMoment.reactionApexOffsetSeconds,
        seekOffsetSeconds: sourceMoment.seekOffsetSeconds,
        precisionSeconds: sourceMoment.precisionSeconds,
      })
      return {
        kind: 'reaction',
        moment: sourceMoment as ExtensionPeak & Record<string, unknown>,
        analyticalOffsetSeconds,
      }
    }
  }

  if (plotY >= emoteMagnitudeTop && plotY <= emoteMagnitudeBottom) {
    const emote = hitLaneBar(emoteBars, plotX, snapToNearestBar)
    if (emote?.peak) {
      return {
        kind: 'emote_peak',
        sourceIndex: emote.peak.index,
        offsetSeconds: emote.offsetSeconds,
        value: emote.peak.value,
      }
    }
  }

  if (plotY >= chatLaneTop && plotY <= chatLaneBottom) {
    const chat = hitLaneBar(chatBars, plotX, snapToNearestBar)
    if (chat) {
      const peak = chat.peak
        ? {
            index: chat.peak.index,
            value: chat.peak.value,
            offsetSeconds: chat.peak.offsetSeconds ?? chat.offsetSeconds,
          }
        : null
      return buildChatIntervalSelection({
        startIndex: chat.startIndex,
        endExclusive: chat.endExclusive,
        startOffsetSeconds: chat.startOffsetSeconds,
        endOffsetSeconds: chat.endOffsetSeconds,
        average: chat.average,
        peak,
        observedCount: chat.observedCount,
        rangeLength: chat.rangeLength,
      })
    }
  }

  const pointerOffset = viewportStartSeconds
    + Math.max(0, Math.min(1, fraction)) * Math.max(0, viewportDuration)
  const canonicalIndex = nearestCoveredRollupIndex(displayRollups, pointerOffset)
  if (canonicalIndex < 0) return { kind: 'none' }
  return {
    kind: 'chart_minute',
    canonicalIndex,
    offsetSeconds: displayRollups[canonicalIndex]!.offsetSeconds,
  }
}

/** Hover chrome follows clickable hits only — misses must not paint a bucket band. */
export function hoverIndexForPointerSelection(
  selection: ChartSelection,
  mappedIndex: number | null,
): number | null {
  if (selection.kind === 'none') return null
  return mappedIndex
}

const SAME_PIN_TOLERANCE_SECONDS = 1

function pinInsideColumn(pin: number, window: ClickColumnWindow): boolean {
  return pin >= window.startOffsetSeconds && pin < window.endOffsetSeconds
}

/** Empty plot unpins. Same LOD column (or same reaction offset) toggles the pin off. */
export function resolveOverviewClickCommit(
  selection: ChartSelection,
  selectedOffsetSeconds: number | null | undefined,
  columnWindow?: ClickColumnWindow | null,
): 'ignore' | 'clear' | 'select' {
  if (selection.kind === 'none') {
    if (selectedOffsetSeconds == null || !Number.isFinite(selectedOffsetSeconds)) {
      return 'ignore'
    }
    return 'clear'
  }
  if (selectedOffsetSeconds == null || !Number.isFinite(selectedOffsetSeconds)) {
    return 'select'
  }
  const window =
    columnWindow
    ?? (selection.kind === 'chat_interval'
      ? {
          startOffsetSeconds: selection.startOffsetSeconds,
          endOffsetSeconds: selection.endOffsetSeconds,
        }
      : null)
  if (window && pinInsideColumn(selectedOffsetSeconds, window)) {
    return 'clear'
  }
  const hit = chartSelectionCanonicalOffset(selection)
  if (hit == null || !Number.isFinite(hit)) return 'select'
  if (Math.abs(hit - selectedOffsetSeconds) <= SAME_PIN_TOLERANCE_SECONDS) {
    return 'clear'
  }
  return 'select'
}

/** Double-click is a second commit (unpin same column), not series focus. */
export function resolvePlotClickAction(args: {
  clickDetail: number
  selection: ChartSelection
  selectedOffsetSeconds: number | null | undefined
  columnWindow?: ClickColumnWindow | null
  plotX?: number
  eventTimeMs?: number
  previousCommit?: { plotX: number; eventTimeMs: number } | null
}): 'ignore' | 'clear' | 'select' {
  void args.clickDetail
  const action = resolveOverviewClickCommit(
    args.selection,
    args.selectedOffsetSeconds,
    args.columnWindow,
  )
  if (action !== 'clear') return action

  // A fast second press can land in a different visual position while both
  // coordinates still resolve to the same density-limited overview column.
  // Treat that as a new selection. Only a true same-position re-click toggles
  // the existing pin off.
  const previous = args.previousCommit
  if (
    previous
    && args.plotX != null
    && args.eventTimeMs != null
    && args.eventTimeMs >= previous.eventTimeMs
    && args.eventTimeMs - previous.eventTimeMs <= 650
    && Math.abs(args.plotX - previous.plotX) > 4
  ) {
    return 'select'
  }
  return action
}
