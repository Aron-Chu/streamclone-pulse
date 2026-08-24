import type { ExtensionGameSegment, ExtensionRollup } from '../shared/messages.ts'

export function formatVodClock(sec?: number): string {
  if (sec == null || sec < 0) return '0s'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  if (m > 0) return `${m}:${String(s).padStart(2, '0')}`
  return `${s}s`
}

export function seriesMax(values: Array<number | null>): number {
  return Math.max(0, ...values.map(value => value ?? 0))
}

/** Bar lane Y max — typical minutes fill the lane; outliers still reach the top. */
export function barDisplayAxisMax(values: Array<number | null>): number {
  const peaks = values.filter((value): value is number => value != null && value > 0)
  if (peaks.length === 0) return 1
  const max = Math.max(...peaks)
  if (peaks.length < 5) return Math.max(max, 1)
  const sorted = [...peaks].sort((a, b) => a - b)
  const p85Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.85))
  const p85 = sorted[p85Index] ?? max
  return Math.max(Math.ceil(p85 * 1.15), max * 0.55, 1)
}

/** Compress outliers into the top fifth of a lane without flattening typical values. */
export function softFitValueToAxis(value: number, axisMax: number): number {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(axisMax) || axisMax <= 0) return 0
  const knee = axisMax * 0.8
  if (value <= knee) return value
  const headroom = Math.max(1, axisMax - knee)
  return Math.min(axisMax, knee + headroom * (1 - Math.exp(-(value - knee) / headroom)))
}

export function softFitSeriesToAxis(
  values: Array<number | null>,
  axisMax: number,
): Array<number | null> {
  return values.map(value => value == null ? null : softFitValueToAxis(value, axisMax))
}

export function widthDerivedBucketCount(
  plotWidth: number,
  viewportMinutes: number,
  maxBuckets = 260,
): number {
  if (plotWidth <= 0 || viewportMinutes <= 0 || maxBuckets <= 0) return 0
  const readableBuckets = Math.max(24, Math.round(plotWidth / 1.2))
  return Math.min(viewportMinutes, maxBuckets, readableBuckets)
}

export function minuteEmoteTotal(point: ExtensionRollup): number {
  const total = point.totalEmoteCount ?? 0
  if (total > 0) return total
  return point.sevenTvEmoteCount ?? 0
}

export function chartViewerValue(point: ExtensionRollup): number {
  return Math.max(0, point.viewerCount ?? 0)
}

export function rollupHasMinuteData(point: ExtensionRollup): boolean {
  if (point.missing) return false
  return (
    (point.chatCount ?? 0) > 0
    || minuteEmoteTotal(point) > 0
    || chartViewerValue(point) > 0
  )
}

/** Earliest rollup minute with chat, emotes, or viewer samples. */
export function firstActiveRollupOffset(rollups: ExtensionRollup[]): number | null {
  for (const rollup of rollups) {
    if (rollupHasMinuteData(rollup)) return rollup.offsetSeconds
  }
  return null
}

export function decimateSeriesForRender(
  values: Array<number | null>,
  maxPoints: number,
): Array<number | null> {
  const n = values.length
  if (n === 0 || maxPoints <= 0 || n <= maxPoints) return values
  const bucketSize = n / maxPoints
  const out: Array<number | null> = []
  for (let bucket = 0; bucket < maxPoints; bucket += 1) {
    const start = Math.floor(bucket * bucketSize)
    const end = Math.min(n, Math.floor((bucket + 1) * bucketSize))
    if (end <= start) continue
    let peak: number | null = null
    for (let i = start; i < end; i += 1) {
      const value = values[i]
      if (value !== null && value > 0 && (peak === null || value > peak)) {
        peak = value
      }
    }
    out.push(peak)
  }
  return out
}

export function hasMeaningfulGameSegments(
  segments: ExtensionGameSegment[],
  durationSeconds: number,
): boolean {
  if (!segments.length || durationSeconds <= 0) return false
  if (segments.length > 1) return true
  const segment = segments[0]
  if (!segment) return false
  if (segment.offsetSeconds > 0) return true
  const coverage = segment.durationSeconds / durationSeconds
  return coverage < 0.9
}

export function nearestMomentForOffset<T extends { offsetSeconds: number }>(
  moments: T[],
  offsetSeconds: number,
): T | null {
  if (!moments.length || !Number.isFinite(offsetSeconds)) return null
  let best = moments[0]!
  let bestDist = Math.abs(best.offsetSeconds - offsetSeconds)
  for (let i = 1; i < moments.length; i += 1) {
    const moment = moments[i]!
    const dist = Math.abs(moment.offsetSeconds - offsetSeconds)
    if (dist < bestDist || (dist === bestDist && moment.offsetSeconds < best.offsetSeconds)) {
      best = moment
      bestDist = dist
    }
  }
  return best
}

export function normalizeGameSegments(
  games: ExtensionGameSegment[],
  durationSeconds: number,
): ExtensionGameSegment[] {
  if (!games.length || durationSeconds <= 0) return []

  const cleaned = games
    .filter(game =>
      Number.isFinite(game.offsetSeconds)
      && Number.isFinite(game.durationSeconds)
      && game.offsetSeconds >= 0,
    )
    .map(game => ({
      ...game,
      offsetSeconds: Math.max(0, game.offsetSeconds),
      durationSeconds: Math.max(0, game.durationSeconds),
    }))

  if (!cleaned.length) return []

  const needsRepair = cleaned.every(game => game.durationSeconds <= 0)
  if (!needsRepair) {
    return cleaned.filter(game => game.durationSeconds > 0)
  }

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return []
  const each = Math.max(60, Math.floor(durationSeconds / cleaned.length))
  let offset = 0
  return cleaned.map((game, index) => {
    const segmentDuration = index === cleaned.length - 1
      ? Math.max(60, durationSeconds - offset)
      : each
    const segment = { ...game, offsetSeconds: offset, durationSeconds: segmentDuration }
    offset += segmentDuration
    return segment
  })
}

export function chartDurationSeconds(
  rollups: ExtensionRollup[],
  fallbackSeconds = 0,
): number {
  if (rollups.length === 0) return Math.max(60, fallbackSeconds)
  const first = rollups[0]?.offsetSeconds ?? 0
  const last = rollups[rollups.length - 1]?.offsetSeconds ?? first
  return Math.max(60, fallbackSeconds, last - first + 60)
}

/** Map extension offset rollups to chart minute timestamps for game segment plotting. */
export function rollupsToChartMinuteRollups(
  rollups: ExtensionRollup[],
  streamStartedAt?: string,
): Array<{ minuteTs: string }> {
  const baseMs = streamStartedAt ? Date.parse(streamStartedAt) : Number.NaN
  return rollups.map((rollup) => {
    const minuteTs = Number.isFinite(baseMs)
      ? new Date(baseMs + Math.max(0, rollup.offsetSeconds) * 1000).toISOString()
      : new Date(Math.max(0, rollup.offsetSeconds) * 1000).toISOString()
    return { minuteTs }
  })
}

/** First rollup offset with a Helix viewer sample (extension rollups). */
export function firstViewerOffsetSeconds(
  rollups: ExtensionRollup[],
  fallback = -1,
): number {
  let earliest = -1
  for (const rollup of rollups) {
    if ((rollup.viewerCount ?? 0) <= 0) continue
    if (earliest < 0 || rollup.offsetSeconds < earliest) {
      earliest = rollup.offsetSeconds
    }
  }
  if (earliest >= 0) return earliest
  return Math.max(0, fallback)
}

/**
 * Chart-only: carry the first Helix viewer sample backward across earlier chat minutes
 * so the viewer lane does not leave a multi-minute dead zone before samples arrive.
 */
export function extendViewerSeriesToLeadingEdge(
  rollups: ExtensionRollup[],
  values: Array<number | null>,
): Array<number | null> {
  const firstIndex = values.findIndex(value => value != null && value > 0)
  if (firstIndex <= 0) return values
  const anchor = values[firstIndex]!
  const out = [...values]
  for (let i = 0; i < firstIndex; i += 1) {
    const rollup = rollups[i]
    if (!rollup) continue
    const hasActivity = (rollup.chatCount ?? 0) > 0 || minuteEmoteTotal(rollup) > 0
    if (hasActivity) out[i] = anchor
  }
  return out
}

/**
 * Chart-only: carry the last Helix viewer sample forward across trailing empty minutes
 * so the viewer line reaches Now (Helix often lags the latest chat rollups).
 */
export function extendViewerSeriesToTrailingEdge(
  values: Array<number | null>,
): Array<number | null> {
  return extendSeriesToTrailingEdge(values)
}

/**
 * Chart-only: carry the last positive sample forward across trailing null/zero gaps
 * (viewers, chat trends, emote trends).
 */
export function extendSeriesToTrailingEdge(
  values: Array<number | null>,
): Array<number | null> {
  let lastIndex = -1
  let lastValue = 0
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i]
    if (value != null && value > 0) {
      lastIndex = i
      lastValue = value
    }
  }
  if (lastIndex < 0 || lastIndex >= values.length - 1) return values
  const out = [...values]
  for (let i = lastIndex + 1; i < out.length; i += 1) {
    out[i] = lastValue
  }
  return out
}

export function indexFromChartClick(
  clientX: number,
  rectLeft: number,
  rectWidth: number,
  pointCount: number,
): number {
  if (pointCount <= 0 || rectWidth <= 0) return 0
  if (pointCount === 1) return 0
  const pct = Math.min(1, Math.max(0, (clientX - rectLeft) / rectWidth))
  return Math.round(pct * (pointCount - 1))
}

export function plotXForIndex(
  index: number,
  pointCount: number,
  padLeft: number,
  plotWidth: number,
): number {
  if (pointCount <= 1) return padLeft
  return padLeft + (index / (pointCount - 1)) * plotWidth
}

/** Cap early-stream bar width so 1–2 minutes never become half-chart slabs. */
export const OVERVIEW_CHART_MAX_BAR_WIDTH_PX = 14

export function overviewBarWidth(
  plotWidth: number,
  pointCount: number,
  maxBarPx = OVERVIEW_CHART_MAX_BAR_WIDTH_PX,
): number {
  const natural = Math.max(1, plotWidth / Math.max(pointCount, 1) - 0.5)
  return Math.min(natural, maxBarPx)
}

export function plotY(
  value: number,
  max: number,
  height: number,
  padTop: number,
  padBottom: number,
  min = 0,
): number {
  const span = Math.max(1, max - min)
  const bandHeight = height - padTop - padBottom
  const normalized = (value - min) / span
  return height - padBottom - normalized * bandHeight
}

/** Y coordinate for a value plotted inside a vertical band (matches linePathInBand). */
export function valueYInBand(
  value: number | null | undefined,
  max: number,
  chartHeight: number,
  bandTop: number,
  bandBottom: number,
  min = 0,
): number | null {
  if (value == null || value <= 0 || max <= 0) return null
  return plotY(value, max, chartHeight, bandTop, chartHeight - bandBottom, min)
}

export function linePath(
  values: Array<number | null>,
  max: number,
  width: number,
  height: number,
  padLeft: number,
  padRight: number,
  padTop: number,
  padBottom: number,
  min = 0,
): string {
  const n = values.length
  if (n === 0 || max <= 0) return ''
  const plotWidth = width - padLeft - padRight
  let d = ''
  let started = false
  for (let i = 0; i < n; i += 1) {
    const value = values[i]
    if (value === null || value < 0) {
      started = false
      continue
    }
    const x = plotXForIndex(i, n, padLeft, plotWidth)
    const y = plotY(value, max, height, padTop, padBottom, min)
    d += started ? ` L ${x} ${y}` : `M ${x} ${y}`
    started = true
  }
  return d
}

function collectBandLinePoints(
  values: Array<number | null>,
  max: number,
  width: number,
  height: number,
  padLeft: number,
  padRight: number,
  bandTop: number,
  bandBottom: number,
  min = 0,
): Array<{ x: number; y: number } | null> {
  const n = values.length
  if (n === 0 || max <= 0) return []
  const plotWidth = width - padLeft - padRight
  const padBottom = height - bandBottom
  return values.map((value, index) => {
    if (value === null || value < 0) return null
    return {
      x: plotXForIndex(index, n, padLeft, plotWidth),
      y: plotY(value, max, height, bandTop, padBottom, min),
    }
  })
}

function smoothLineSegment(
  segment: Array<{ x: number; y: number }>,
  bandTop: number,
  bandBottom: number,
  linear = false,
): string {
  if (segment.length === 0) return ''
  if (segment.length === 1) return `M ${segment[0].x.toFixed(1)} ${segment[0].y.toFixed(1)}`
  if (segment.length === 2 || linear) {
    let d = `M ${segment[0].x.toFixed(1)} ${segment[0].y.toFixed(1)}`
    for (let i = 1; i < segment.length; i += 1) {
      d += ` L ${segment[i].x.toFixed(1)} ${segment[i].y.toFixed(1)}`
    }
    return d
  }

  let d = `M ${segment[0].x.toFixed(1)} ${segment[0].y.toFixed(1)}`
  const slopes: number[] = new Array(segment.length)
  for (let i = 0; i < segment.length; i += 1) {
    if (i === 0) {
      slopes[i] = (segment[1].y - segment[0].y) / Math.max(1e-6, segment[1].x - segment[0].x)
    } else if (i === segment.length - 1) {
      slopes[i] = (segment[i].y - segment[i - 1].y) / Math.max(1e-6, segment[i].x - segment[i - 1].x)
    } else {
      const dx1 = segment[i].x - segment[i - 1].x
      const dy1 = segment[i].y - segment[i - 1].y
      const dx2 = segment[i + 1].x - segment[i].x
      const dy2 = segment[i + 1].y - segment[i].y
      slopes[i] = (dy1 / Math.max(1e-6, dx1) + dy2 / Math.max(1e-6, dx2)) / 2
    }
  }

  for (let i = 0; i < segment.length - 1; i += 1) {
    const p1 = segment[i]
    const p2 = segment[i + 1]
    const dx = p2.x - p1.x
    const cp1x = p1.x + dx * 0.35
    const cp1y = Math.max(bandTop, Math.min(bandBottom, p1.y + slopes[i] * dx * 0.35))
    const cp2x = p2.x - dx * 0.35
    const cp2y = Math.max(bandTop, Math.min(bandBottom, p2.y - slopes[i + 1] * dx * 0.35))
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
  }
  return d
}

function smoothLinePathFromPoints(
  points: Array<{ x: number; y: number } | null>,
  bandTop: number,
  bandBottom: number,
  linear = false,
): string {
  let path = ''
  let segment: Array<{ x: number; y: number }> = []
  for (const point of points) {
    if (point === null) {
      if (segment.length > 0) {
        path += `${path ? ' ' : ''}${smoothLineSegment(segment, bandTop, bandBottom, linear)}`
        segment = []
      }
    } else {
      segment.push(point)
    }
  }
  if (segment.length > 0) {
    path += `${path ? ' ' : ''}${smoothLineSegment(segment, bandTop, bandBottom, linear)}`
  }
  return path
}

/** Cubic-bezier trend line inside a vertical band (portal chart parity). */
export function smoothLinePathInBand(
  values: Array<number | null>,
  max: number,
  width: number,
  height: number,
  padLeft: number,
  padRight: number,
  bandTop: number,
  bandBottom: number,
  min = 0,
  linear = false,
): string {
  const points = collectBandLinePoints(
    values,
    max,
    width,
    height,
    padLeft,
    padRight,
    bandTop,
    bandBottom,
    min,
  )
  return smoothLinePathFromPoints(points, bandTop, bandBottom, linear)
}

/** Plot a line inside a band defined by y-coordinates (bandTop, bandBottom). */
export function linePathInBand(
  values: Array<number | null>,
  max: number,
  width: number,
  height: number,
  padLeft: number,
  padRight: number,
  bandTop: number,
  bandBottom: number,
  min = 0,
): string {
  return linePath(values, max, width, height, padLeft, padRight, bandTop, height - bandBottom, min)
}

/** Moving-average smooth for thin sidebar trace lanes. */
export function smoothSeriesValues(values: number[], window = 3): number[] {
  if (window <= 1 || values.length < 3) return values
  const radius = Math.floor(window / 2)
  return values.map((value, index) => {
    let sum = 0
    let count = 0
    for (let i = Math.max(0, index - radius); i <= Math.min(values.length - 1, index + radius); i += 1) {
      sum += values[i]!
      count += 1
    }
    return count > 0 ? sum / count : value
  })
}

/** Adaptive window for aggregate chat/emote trend lines (longer timelines → slightly smoother). */
export function trendSmoothingWindow(pointCount: number): number {
  if (pointCount <= 30) return 3
  if (pointCount <= 90) return 5
  return 7
}

/** Ease-in-out cubic — gradual rise at stream start (TwitchTracker-style ramp). */
export function easeInOutCubic(t: number): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/**
 * Chart display: ramp from 0 at stream start to the first positive sample so
 * trend/area lines rise gradually instead of jumping or backfilling flat.
 */
export function rampNullableSeriesFromStreamStart(
  values: Array<number | null>,
): Array<number | null> {
  const firstIndex = values.findIndex(value => value != null && value > 0)
  if (firstIndex <= 0) return values
  const anchor = values[firstIndex]!
  const out = [...values]
  out[0] = 0
  for (let i = 1; i <= firstIndex; i += 1) {
    const t = i / firstIndex
    out[i] = anchor * easeInOutCubic(t)
  }
  return out
}

/** Centered moving average for nullable minute series — gaps stay null. */
export function smoothNullableSeriesValues(
  values: Array<number | null>,
  window = 5,
): Array<number | null> {
  if (window <= 1 || values.length < 3) return values
  const radius = Math.floor(window / 2)
  return values.map((value, index) => {
    if (value === null) return null
    let sum = 0
    let count = 0
    for (let offset = -radius; offset <= radius; offset += 1) {
      const sample = values[index + offset]
      if (sample === null || sample === undefined) continue
      sum += sample
      count += 1
    }
    return count > 0 ? sum / count : value
  })
}

export function areaPath(
  values: Array<number | null>,
  max: number,
  width: number,
  height: number,
  padLeft: number,
  padRight: number,
  padTop: number,
  padBottom: number,
  min = 0,
): string {
  const n = values.length
  if (n === 0 || max <= 0) return ''
  const plotWidth = width - padLeft - padRight
  const baseline = height - padBottom
  let d = ''
  let started = false
  let firstX = padLeft
  let lastX = padLeft
  const closeSegment = () => {
    if (!started) return
    d += ` L ${lastX} ${baseline} L ${firstX} ${baseline} Z`
    started = false
  }
  for (let i = 0; i < n; i += 1) {
    const value = values[i]
    if (value === null || value < 0) {
      // Keep unsupported viewer intervals visibly unsupported. Do not fill an
      // area from the last known sample across an unmeasured gap.
      closeSegment()
      continue
    }
    const x = plotXForIndex(i, n, padLeft, plotWidth)
    const y = plotY(value, max, height, padTop, padBottom, min)
    if (!started) {
      firstX = x
      d += `${d ? ' ' : ''}M ${x} ${baseline} L ${x} ${y}`
      started = true
    } else {
      d += ` L ${x} ${y}`
    }
    lastX = x
  }
  closeSegment()
  return d
}

/** Plot a filled area inside a vertical band (matches linePathInBand). */
export function areaPathInBand(
  values: Array<number | null>,
  max: number,
  width: number,
  height: number,
  padLeft: number,
  padRight: number,
  bandTop: number,
  bandBottom: number,
  min = 0,
): string {
  return areaPath(values, max, width, height, padLeft, padRight, bandTop, height - bandBottom, min)
}

/** Bar fill opacity: faint at rest; one bucket highlighted on hover or pin. */
export function chartBarBucketOpacity(args: {
  index: number
  activeIndex: number | null
  baseOpacity: number
  highlightOpacity?: number
  fadeFutureAfterActive?: boolean
}): number {
  const {
    index,
    activeIndex,
    baseOpacity,
    highlightOpacity = baseOpacity,
    fadeFutureAfterActive = false,
  } = args
  const REST_SCALE = 0.42
  const DIM_SCALE = 0.32
  const PAST_SCALE = 0.78
  const FUTURE_SCALE = 0.14
  const HIGHLIGHT_CAP = 0.95
  const HIGHLIGHT_BOOST = 1.12

  if (activeIndex == null) {
    return baseOpacity * REST_SCALE
  }
  if (index === activeIndex) {
    return Math.min(highlightOpacity * HIGHLIGHT_BOOST, HIGHLIGHT_CAP)
  }
  if (fadeFutureAfterActive) {
    return baseOpacity * (index < activeIndex ? PAST_SCALE : FUTURE_SCALE)
  }
  return baseOpacity * DIM_SCALE
}
