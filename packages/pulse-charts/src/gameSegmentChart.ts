export type GameSegmentPlotInput = {
  offsetSeconds: number
  durationSeconds: number
}

export type RollupMinuteTs = {
  minuteTs: string
}

export type GameSegmentPlotBounds = {
  startX: number
  endX: number
  centerX: number
  textWidth: number
}

/**
 * Duration used when re-normalizing game segments against chart rollups.
 * Prefer wall/offset span from minuteTs-derived offsets — never `rollups.length * 60`
 * alone, which drops late games (Terraria / Slay the Spire) after timeline downsample.
 */
export function gamesNormalizeDurationSeconds(
  chartOffsets: readonly number[],
  rollupCount: number,
  explicitDurationSeconds = 0,
): number {
  if (Number.isFinite(explicitDurationSeconds) && explicitDurationSeconds > 0) {
    return explicitDurationSeconds
  }
  if (chartOffsets.length > 0) {
    const last = chartOffsets[chartOffsets.length - 1]!
    if (Number.isFinite(last)) {
      // Absolute offset from stream start through the last minute bucket.
      // Do not use (last - first): late coverage starts must not shrink total duration.
      return Math.max(last + 60, 60)
    }
  }
  return Math.max(rollupCount * 60, 60)
}

/** Map a stream offset onto an index-spaced chart (matches plotXForIndex). */
export function plotXForOffsetSeconds(
  offsetSeconds: number,
  chartOffsets: readonly number[],
  plotLeft: number,
  plotWidth: number,
): number | null {
  const n = chartOffsets.length
  if (n < 1 || plotWidth <= 0 || !Number.isFinite(offsetSeconds)) return null
  if (n === 1) return plotLeft

  const first = chartOffsets[0]!
  const last = chartOffsets[n - 1]!
  if (!Number.isFinite(first) || !Number.isFinite(last)) return null
  if (offsetSeconds <= first) return plotLeft
  if (offsetSeconds >= last) return plotLeft + plotWidth

  let lo = 0
  while (lo < n - 1 && chartOffsets[lo + 1]! < offsetSeconds) lo += 1
  const a = chartOffsets[lo]!
  const b = chartOffsets[lo + 1]!
  const t = b === a ? 0 : (offsetSeconds - a) / (b - a)
  const index = lo + Math.max(0, Math.min(1, t))
  return plotLeft + (index / (n - 1)) * plotWidth
}

/**
 * Map game segments onto charts that space points by index (extension PulseOverviewChart).
 * Prefer this over time-based bounds when rollups are spike-downsampled (uneven offsets).
 */
export function gameSegmentPlotBoundsByOffsets(
  segment: GameSegmentPlotInput,
  chartOffsets: readonly number[],
  plotLeft: number,
  plotWidth: number,
): GameSegmentPlotBounds | null {
  if (
    chartOffsets.length < 1
    || !Number.isFinite(segment.offsetSeconds)
    || !Number.isFinite(segment.durationSeconds)
    || segment.durationSeconds <= 0
    || plotWidth <= 0
  ) {
    return null
  }

  const chartFirst = chartOffsets[0]!
  const chartLast = chartOffsets[chartOffsets.length - 1]!
  if (!Number.isFinite(chartFirst) || !Number.isFinite(chartLast)) {
    return null
  }

  // Minute buckets are starts; the last visible minute covers through chartLast+60.
  const chartEndExclusive = chartLast + 60

  // Single-bucket charts (first === last) still need hover highlight geometry.
  if (chartLast <= chartFirst) {
    const segStart = Math.max(0, segment.offsetSeconds)
    const segEnd = segStart + segment.durationSeconds
    if (segEnd <= chartFirst || segStart >= chartEndExclusive) return null
    return {
      startX: plotLeft,
      endX: plotLeft + plotWidth,
      centerX: plotLeft + plotWidth / 2,
      textWidth: plotWidth,
    }
  }

  const segStart = Math.max(0, segment.offsetSeconds)
  const segEnd = segStart + segment.durationSeconds
  const visibleStart = Math.max(chartFirst, segStart)
  const visibleEnd = Math.min(chartEndExclusive, segEnd)
  if (visibleEnd <= visibleStart) return null

  const startX = plotXForOffsetSeconds(visibleStart, chartOffsets, plotLeft, plotWidth)
  // Map the exclusive end onto the right edge when it reaches past the last bucket start.
  const endX =
    visibleEnd >= chartEndExclusive
      ? plotLeft + plotWidth
      : plotXForOffsetSeconds(visibleEnd, chartOffsets, plotLeft, plotWidth)
  if (startX == null || endX == null || !Number.isFinite(startX) || !Number.isFinite(endX)) {
    return null
  }

  return {
    startX,
    endX: Math.max(startX, endX),
    centerX: (startX + Math.max(startX, endX)) / 2,
    textWidth: Math.max(0, Math.max(startX, endX) - startX),
  }
}

/** Map absolute stream game segments onto the visible chart rollup window (time domain). */
export function gameSegmentPlotBounds(
  segment: GameSegmentPlotInput,
  rollups: RollupMinuteTs[],
  streamStartedAt: string | undefined,
  plotLeft: number,
  plotWidth: number,
): GameSegmentPlotBounds | null {
  if (
    rollups.length < 1
    || !Number.isFinite(segment.offsetSeconds)
    || !Number.isFinite(segment.durationSeconds)
    || segment.durationSeconds <= 0
    || plotWidth <= 0
  ) {
    return null
  }

  const chartFirstMs = Date.parse(rollups[0].minuteTs)
  const chartLastMs = Date.parse(rollups[rollups.length - 1].minuteTs)
  if (!Number.isFinite(chartFirstMs) || !Number.isFinite(chartLastMs)) return null
  // Last minute bucket covers through +60s; plot span uses exclusive end for width.
  const chartEndExclusiveMs = chartLastMs + 60_000
  const chartSpanMs = chartEndExclusiveMs - chartFirstMs
  if (!Number.isFinite(chartSpanMs) || chartSpanMs <= 0) return null

  const streamStartMs = streamStartedAt ? Date.parse(streamStartedAt) : chartFirstMs
  if (!Number.isFinite(streamStartMs)) return null

  const segStartMs = streamStartMs + Math.max(0, segment.offsetSeconds) * 1000
  const segEndMs = segStartMs + segment.durationSeconds * 1000
  const visibleStartMs = Math.max(chartFirstMs, segStartMs)
  const visibleEndMs = Math.min(chartEndExclusiveMs, segEndMs)
  if (visibleEndMs <= visibleStartMs) return null

  const startPct = (visibleStartMs - chartFirstMs) / chartSpanMs
  const endPct = (visibleEndMs - chartFirstMs) / chartSpanMs
  const startX = plotLeft + startPct * plotWidth
  const endX = plotLeft + endPct * plotWidth
  if (!Number.isFinite(startX) || !Number.isFinite(endX)) return null

  return {
    startX,
    endX,
    centerX: (startX + endX) / 2,
    textWidth: endX - startX,
  }
}
