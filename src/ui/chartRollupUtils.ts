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
    if (value === null || value <= 0) {
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

/** Adaptive window for aggregate chat/emote trend lines (longer timelines → smoother). */
export function trendSmoothingWindow(pointCount: number): number {
  if (pointCount <= 30) return 5
  if (pointCount <= 90) return 7
  return 9
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
  for (let i = 0; i < n; i += 1) {
    const value = values[i]
    if (value === null || value <= 0) continue
    const x = plotXForIndex(i, n, padLeft, plotWidth)
    const y = plotY(value, max, height, padTop, padBottom, min)
    if (!started) {
      firstX = x
      d = `M ${x} ${baseline} L ${x} ${y}`
      started = true
    } else {
      d += ` L ${x} ${y}`
    }
  }
  if (!started) return ''
  const lastX = plotXForIndex(n - 1, n, padLeft, plotWidth)
  return `${d} L ${lastX} ${baseline} L ${firstX} ${baseline} Z`
}

/** Bar fill opacity: faint at rest; one bucket highlighted on hover or pin. */
export function chartBarBucketOpacity(args: {
  index: number
  activeIndex: number | null
  baseOpacity: number
  highlightOpacity?: number
}): number {
  const { index, activeIndex, baseOpacity, highlightOpacity = baseOpacity } = args
  const REST_SCALE = 0.42
  const DIM_SCALE = 0.32
  const HIGHLIGHT_CAP = 0.95
  const HIGHLIGHT_BOOST = 1.12

  if (activeIndex == null) {
    return baseOpacity * REST_SCALE
  }
  if (index === activeIndex) {
    return Math.min(highlightOpacity * HIGHLIGHT_BOOST, HIGHLIGHT_CAP)
  }
  return baseOpacity * DIM_SCALE
}
