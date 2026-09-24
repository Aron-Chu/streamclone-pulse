export type ViewerTimedValue = {
  minuteTs: string
  value: number | null
}

export type ViewerTimestampScale = {
  firstTimestampMs: number
  lastTimestampMs: number
  plotStartX: number
  plotEndX: number
  plotWidth: number
  xForTimestamp: (minuteTs: string, fallbackIndex?: number, fallbackCount?: number) => number
  xForTimestampMs: (timestamp: number) => number
  timestampAtX: (x: number) => number | null
}

export type ViewerPoint = {
  minuteTs: string
  timestampMs: number
  x: number
  value: number | null
  y: number | null
  index: number
}

export type ViewerSegment = ViewerPoint[]

export type ViewerGeometryOptions = {
  width: number
  padLeft: number
  padRight: number
  bandTop: number
  bandBottom: number
  valueToY: (value: number) => number
  /** CSS/viewBox plot width used for density budgets. */
  plotCssWidth?: number
  /** Reuse the chart-wide timestamp scale so every layer shares X coordinates. */
  timestampScale?: ViewerTimestampScale
  idleAnchorCount?: number
  detailPointBudget?: number
}

export type ViewerGeometry = {
  scale: ViewerTimestampScale
  overviewPoints: ViewerPoint[]
  overviewSegments: ViewerSegment[]
  detailPoints: ViewerPoint[]
  detailSegments: ViewerSegment[]
  idlePathD: string
  idleAreaPathD: string
  detailPathD: string
  /** Aliases for callers that need the complete detail lattice for hit testing. */
  points: ViewerPoint[]
  segments: ViewerSegment[]
}

type TimedValueWithIndex = ViewerTimedValue & {
  sourceIndex: number
  timestampMs: number
}

type GeometryPoint = { x: number; y: number }

const IDLE_BUDGET_RATIO = 1 / 6
const DETAIL_BUDGET_RATIO = 1 / 2
const MIN_IDLE_ANCHORS = 64
const MAX_IDLE_ANCHORS = 180
const MIN_DETAIL_POINTS = 120
const MAX_DETAIL_POINTS = 640
const IDLE_SMOOTHING_MINUTES = { min: 7, max: 11, targetSamples: 9 }
const DETAIL_SMOOTHING_MINUTES = { min: 3, max: 5, targetSamples: 4 }
const MAX_GAP_MS = 150_000

function timestampMs(minuteTs: string): number {
  const parsed = Date.parse(minuteTs)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)] ?? null
}

function finiteTimestampValues(values: readonly (string | ViewerTimedValue)[]): number[] {
  return values
    .map(value => timestampMs(typeof value === 'string' ? value : value.minuteTs))
    .filter(value => Number.isFinite(value))
}

export function buildViewerTimestampScale(
  timestamps: readonly (string | ViewerTimedValue)[],
  options: Pick<ViewerGeometryOptions, 'width' | 'padLeft' | 'padRight'> & {
    domainStartMs?: number
    domainEndMs?: number
  },
): ViewerTimestampScale {
  const plotStartX = options.padLeft
  const plotEndX = Math.max(plotStartX, options.width - options.padRight)
  const plotWidth = Math.max(0, plotEndX - plotStartX)
  const finite = finiteTimestampValues(timestamps)
  const inferredStart = finite.length > 0 ? Math.min(...finite) : Number.NaN
  const inferredEnd = finite.length > 0 ? Math.max(...finite) : Number.NaN
  const firstTimestampMs = Number.isFinite(options.domainStartMs)
    ? options.domainStartMs!
    : inferredStart
  const lastTimestampMs = Number.isFinite(options.domainEndMs)
    ? options.domainEndMs!
    : inferredEnd
  const hasTimeDomain = Number.isFinite(firstTimestampMs) && Number.isFinite(lastTimestampMs)

  const xForTimestampMs = (timestamp: number): number => {
    if (!hasTimeDomain) return plotStartX
    if (lastTimestampMs <= firstTimestampMs) return plotStartX
    return plotStartX + clamp((timestamp - firstTimestampMs) / (lastTimestampMs - firstTimestampMs), 0, 1) * plotWidth
  }

  const fallbackCount = Math.max(1, timestamps.length)
  const xForTimestamp = (minuteTs: string, fallbackIndex = 0, count = fallbackCount): number => {
    const parsed = timestampMs(minuteTs)
    if (Number.isFinite(parsed) && hasTimeDomain) return xForTimestampMs(parsed)
    if (count <= 1) return plotStartX
    return plotStartX + clamp(fallbackIndex / (count - 1), 0, 1) * plotWidth
  }

  const timestampAtX = (x: number): number | null => {
    if (!hasTimeDomain) return null
    if (lastTimestampMs <= firstTimestampMs) return firstTimestampMs
    const fraction = clamp((x - plotStartX) / Math.max(1, plotWidth), 0, 1)
    return firstTimestampMs + fraction * (lastTimestampMs - firstTimestampMs)
  }

  return {
    firstTimestampMs,
    lastTimestampMs,
    plotStartX,
    plotEndX,
    plotWidth,
    xForTimestamp,
    xForTimestampMs,
    timestampAtX,
  }
}

export function projectValuesToTimestamps(
  source: ViewerTimedValue[],
  targetTimestamps: string[],
): Array<number | null> {
  if (targetTimestamps.length === 0) return []
  if (source.length === 0) return targetTimestamps.map(() => null)

  const exact = new Map<string, number | null>()
  const ordered = source
    .map((point, sourceIndex) => ({
      ...point,
      sourceIndex,
      timestampMs: timestampMs(point.minuteTs),
    }))
    .sort((left, right) => {
      if (Number.isFinite(left.timestampMs) && Number.isFinite(right.timestampMs)) {
        return left.timestampMs - right.timestampMs || left.sourceIndex - right.sourceIndex
      }
      if (Number.isFinite(left.timestampMs)) return -1
      if (Number.isFinite(right.timestampMs)) return 1
      return left.sourceIndex - right.sourceIndex
    })

  for (const point of ordered) exact.set(point.minuteTs, point.value)

  const timed = ordered.filter(point => Number.isFinite(point.timestampMs)) as Array<
    (typeof ordered)[number] & { timestampMs: number }
  >
  if (timed.length === 0) return targetTimestamps.map(target => exact.get(target) ?? null)
  const sourceGapThresholdMs = gapThresholdMs(ordered)

  return targetTimestamps.map(target => {
    if (exact.has(target)) return exact.get(target) ?? null
    const targetMs = timestampMs(target)
    if (!Number.isFinite(targetMs)) return null
    if (targetMs < timed[0]!.timestampMs || targetMs > timed[timed.length - 1]!.timestampMs) return null

    let rightIndex = timed.findIndex(point => point.timestampMs >= targetMs)
    if (rightIndex < 0) rightIndex = timed.length - 1
    const right = timed[rightIndex]!
    if (right.timestampMs === targetMs) return right.value
    const left = timed[Math.max(0, rightIndex - 1)]!
    if (left.timestampMs >= right.timestampMs || left.value === null || right.value === null) return null
    if (right.timestampMs - left.timestampMs > sourceGapThresholdMs) return null
    if (ordered.some(point => Number.isFinite(point.timestampMs)
      && point.timestampMs > left.timestampMs
      && point.timestampMs < right.timestampMs
      && point.value === null)) return null

    const fraction = (targetMs - left.timestampMs) / (right.timestampMs - left.timestampMs)
    return left.value + (right.value - left.value) * fraction
  })
}

function normalizeTimedValues(values: ViewerTimedValue[]): TimedValueWithIndex[] {
  return values
    .map((point, sourceIndex) => ({
      ...point,
      sourceIndex,
      timestampMs: timestampMs(point.minuteTs),
    }))
    .sort((left, right) => {
      if (Number.isFinite(left.timestampMs) && Number.isFinite(right.timestampMs)) {
        return left.timestampMs - right.timestampMs || left.sourceIndex - right.sourceIndex
      }
      if (Number.isFinite(left.timestampMs)) return -1
      if (Number.isFinite(right.timestampMs)) return 1
      return left.sourceIndex - right.sourceIndex
    })
}

function medianCadenceMs(points: TimedValueWithIndex[]): number | null {
  const deltas: number[] = []
  let previous: number | null = null
  for (const point of points) {
    if (!Number.isFinite(point.timestampMs)) continue
    if (previous !== null && point.timestampMs > previous) {
      deltas.push(point.timestampMs - previous)
    }
    previous = point.timestampMs
  }
  return median(deltas)
}

function gapThresholdMs(points: TimedValueWithIndex[]): number {
  return Math.max(MAX_GAP_MS, (medianCadenceMs(points) ?? 60_000) * 2.5)
}

function hasTimestampGap(left: ViewerPoint | undefined, right: ViewerPoint, thresholdMs: number): boolean {
  if (!left || !Number.isFinite(left.timestampMs) || !Number.isFinite(right.timestampMs)) return false
  return right.timestampMs - left.timestampMs > thresholdMs
}

function pointY(value: number, options: ViewerGeometryOptions): number {
  const projected = options.valueToY(value)
  if (!Number.isFinite(projected)) return options.bandBottom
  return clamp(projected, options.bandTop, options.bandBottom)
}

function normalizedValue(value: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function segmentRanges(
  points: TimedValueWithIndex[],
  thresholdMs: number,
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  let start = -1
  let previous: TimedValueWithIndex | null = null

  const flush = (end: number) => {
    if (start >= 0 && end >= start) ranges.push({ start, end })
    start = -1
    previous = null
  }

  points.forEach((point, index) => {
    if (normalizedValue(point.value) === null) {
      flush(index - 1)
      return
    }
    if (start < 0 || (previous && Number.isFinite(previous.timestampMs)
      && Number.isFinite(point.timestampMs)
      && point.timestampMs - previous.timestampMs > thresholdMs)) {
      if (start >= 0) flush(index - 1)
      start = index
    }
    previous = point
  })
  flush(points.length - 1)
  return ranges
}

function isProminentLocalExtremum(
  values: Array<number | null>,
  index: number,
  range: { start: number; end: number },
  windowStart: number,
  windowEnd: number,
): boolean {
  if (index <= range.start || index >= range.end) return false
  const value = values[index]
  const previous = values[index - 1]
  const next = values[index + 1]
  if (value === null || previous === null || next === null) return false

  const localValues = values
    .slice(windowStart, windowEnd + 1)
    .filter((sample): sample is number => sample !== null)
  if (localValues.length === 0) return false
  const localRange = Math.max(...localValues) - Math.min(...localValues)
  const prominenceThreshold = Math.max(1, Math.abs(value) * 0.04, localRange * 0.08)
  const high = value >= previous && value >= next && value - Math.max(previous, next) >= prominenceThreshold
  const low = value <= previous && value <= next && Math.min(previous, next) - value >= prominenceThreshold
  return high || low
}

function smoothDisplayValues(
  points: TimedValueWithIndex[],
  thresholdMs: number,
  bounds: { min: number; max: number; targetSamples: number },
): Array<number | null> {
  const raw = points.map(point => normalizedValue(point.value))
  const display = [...raw]
  const cadenceMs = medianCadenceMs(points) ?? 60_000
  const windowMs = clamp(
    cadenceMs * bounds.targetSamples,
    bounds.min * 60_000,
    bounds.max * 60_000,
  )
  const radiusMs = windowMs / 2

  for (const range of segmentRanges(points, thresholdMs)) {
    for (let index = range.start + 1; index < range.end; index++) {
      const point = points[index]!
      const centerTs = point.timestampMs
      const windowStart = Number.isFinite(centerTs)
        ? points.findIndex((candidate, candidateIndex) => candidateIndex >= range.start
          && Number.isFinite(candidate.timestampMs)
          && centerTs - candidate.timestampMs <= radiusMs)
        : Math.max(range.start, index - bounds.targetSamples)
      const windowEnd = Number.isFinite(centerTs)
        ? (() => {
          let end = index
          while (end < range.end && Number.isFinite(points[end]!.timestampMs)
            && points[end]!.timestampMs - centerTs <= radiusMs) end += 1
          return end - 1
        })()
        : Math.min(range.end, index + bounds.targetSamples)
      const localStart = windowStart < range.start ? range.start : windowStart
      const localEnd = Math.max(localStart, Math.min(range.end, windowEnd))
      if (isProminentLocalExtremum(raw, index, range, localStart, localEnd)) continue

      const samples: number[] = []
      for (let sampleIndex = localStart; sampleIndex <= localEnd; sampleIndex++) {
        const sample = raw[sampleIndex]
        if (sample === null) continue
        if (Number.isFinite(centerTs) && Number.isFinite(points[sampleIndex]!.timestampMs)
          && Math.abs(points[sampleIndex]!.timestampMs - centerTs) > radiusMs) continue
        samples.push(sample)
      }
      const fitted = median(samples)
      if (fitted === null || samples.length === 0) continue
      display[index] = clamp(fitted, Math.min(...samples), Math.max(...samples))
    }
  }
  return display
}

function pointsForValues(
  values: ViewerTimedValue[],
  scale: ViewerTimestampScale,
  options: ViewerGeometryOptions,
  smoothingBounds: { min: number; max: number; targetSamples: number },
): ViewerPoint[] {
  const ordered = normalizeTimedValues(values)
  const thresholdMs = gapThresholdMs(ordered)
  const rawValues = ordered.map(point => normalizedValue(point.value))
  const displayValues = smoothDisplayValues(ordered, thresholdMs, smoothingBounds)
  return ordered.map((point, index) => {
    const value = rawValues[index]
    const displayValue = displayValues[index]
    return {
      minuteTs: point.minuteTs,
      timestampMs: point.timestampMs,
      x: scale.xForTimestamp(point.minuteTs, index, ordered.length),
      value,
      y: value === null || displayValue === null ? null : pointY(displayValue, options),
      index,
    }
  })
}

function connectedSegments(points: ViewerPoint[], thresholdMs: number): ViewerSegment[] {
  const segments: ViewerSegment[] = []
  let segment: ViewerSegment = []
  let previous: ViewerPoint | undefined
  for (const point of points) {
    if (point.value === null || point.y === null || hasTimestampGap(previous, point, thresholdMs)) {
      if (segment.length > 0) segments.push(segment)
      segment = []
      previous = undefined
      if (point.value !== null && point.y !== null) {
        segment.push(point)
        previous = point
      }
      continue
    }
    segment.push(point)
    previous = point
  }
  if (segment.length > 0) segments.push(segment)
  return segments
}

function chooseExtrema(segment: ViewerSegment, start: number, end: number): number[] {
  if (end <= start) return []
  let minIndex = start
  let maxIndex = start
  for (let index = start + 1; index < end; index++) {
    const value = segment[index]!.value ?? 0
    const minValue = segment[minIndex]!.value ?? 0
    const maxValue = segment[maxIndex]!.value ?? 0
    if (value < minValue) minIndex = index
    if (value > maxValue) maxIndex = index
  }
  return minIndex === maxIndex ? [minIndex] : [minIndex, maxIndex]
}

/**
 * Reduce a connected segment by retaining both local bucket extrema. This is
 * deliberately not averaging or LTTB-only: short spikes and troughs survive
 * the idle overview while the original null boundaries remain untouched.
 */
export function reduceViewerSegment(segment: ViewerSegment, budget: number): ViewerSegment {
  if (segment.length <= budget || segment.length <= 2) return segment
  const target = Math.max(2, Math.floor(budget))
  const bucketCount = Math.max(1, Math.floor((target - 2) / 2))
  const selected = new Set<number>([0, segment.length - 1])
  const interiorLength = segment.length - 2

  for (let bucket = 0; bucket < bucketCount; bucket++) {
    const start = 1 + Math.floor((bucket * interiorLength) / bucketCount)
    const end = 1 + Math.floor(((bucket + 1) * interiorLength) / bucketCount)
    for (const index of chooseExtrema(segment, start, Math.max(start + 1, end))) selected.add(index)
  }

  return [...selected]
    .sort((left, right) => left - right)
    .map(index => segment[index]!)
}

/**
 * Calm full-stream presentation without inventing continuity. Each connected
 * segment is reduced independently, so real null/timestamp gaps remain gaps.
 * Ordinary bucket noise is represented by an averaged display anchor while
 * the true global high and low survive as authored points. Zoom/detail still
 * uses `reduceViewerSegment`, which retains local extrema.
 */
export function reduceViewerOverviewSegment(segment: ViewerSegment, budget: number): ViewerSegment {
  if (segment.length <= budget || segment.length <= 2) return segment
  const target = Math.max(2, Math.floor(budget))
  let minIndex = 0
  let maxIndex = 0
  for (let index = 1; index < segment.length; index++) {
    if ((segment[index]!.value ?? 0) < (segment[minIndex]!.value ?? 0)) minIndex = index
    if ((segment[index]!.value ?? 0) > (segment[maxIndex]!.value ?? 0)) maxIndex = index
  }

  const authored = new Map<number, ViewerPoint>()
  for (const index of [0, segment.length - 1, minIndex, maxIndex]) {
    authored.set(index, segment[index]!)
  }
  const remaining = Math.max(0, target - authored.size)
  if (remaining > 0) {
    for (let bucket = 0; bucket < remaining; bucket++) {
      const start = Math.floor((bucket * segment.length) / remaining)
      const end = Math.max(start + 1, Math.floor(((bucket + 1) * segment.length) / remaining))
      const points = segment.slice(start, Math.min(segment.length, end))
      if (points.length === 0) continue
      const representativeIndex = Math.min(
        segment.length - 1,
        start + Math.floor(points.length / 2),
      )
      if (authored.has(representativeIndex)) continue
      const representative = segment[representativeIndex]!
      const count = points.length
      authored.set(representativeIndex, {
        ...representative,
        timestampMs: points.reduce((sum, point) => sum + point.timestampMs, 0) / count,
        x: points.reduce((sum, point) => sum + point.x, 0) / count,
        value: points.reduce((sum, point) => sum + (point.value ?? 0), 0) / count,
        y: points.reduce((sum, point) => sum + (point.y ?? 0), 0) / count,
      })
    }
  }

  return [...authored.entries()]
    .sort(([left], [right]) => left - right)
    .slice(0, target)
    .map(([, point]) => point)
}

function reduceSegments(
  segments: ViewerSegment[],
  budget: number,
  reducer: (segment: ViewerSegment, budget: number) => ViewerSegment = reduceViewerSegment,
): ViewerSegment[] {
  if (segments.length === 0) return []
  const minimums = segments.map(segment => Math.min(segment.length, segment.length <= 1 ? 1 : 2))
  const minimumTotal = minimums.reduce((sum, value) => sum + value, 0)
  let remaining = Math.max(0, Math.floor(budget) - minimumTotal)
  const allocations = [...minimums]
  const capacities = segments.map((segment, index) => Math.max(0, segment.length - allocations[index]!))
  const capacityTotal = capacities.reduce((sum, value) => sum + value, 0)

  if (remaining > 0 && capacityTotal > 0) {
    remaining = Math.min(remaining, capacityTotal)
    const fractional = capacities.map(capacity => capacity * remaining / capacityTotal)
    const additions = fractional.map((value, index) => Math.min(capacities[index]!, Math.floor(value)))
    let assigned = additions.reduce((sum, value) => sum + value, 0)
    while (assigned < remaining) {
      let bestIndex = -1
      let bestRemainder = -1
      for (let index = 0; index < fractional.length; index++) {
        if (additions[index]! >= capacities[index]!) continue
        const remainder = fractional[index]! - additions[index]!
        if (remainder > bestRemainder) {
          bestRemainder = remainder
          bestIndex = index
        }
      }
      if (bestIndex < 0) break
      additions[bestIndex] = additions[bestIndex]! + 1
      assigned += 1
    }
    additions.forEach((addition, index) => {
      allocations[index] = Math.min(segments[index]!.length, allocations[index]! + addition)
    })
  }

  return segments.map((segment, index) => reducer(segment, allocations[index]!))
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00'
}

function monotoneSlopes(points: GeometryPoint[]): number[] {
  if (points.length <= 1) return points.map(() => 0)
  const intervals = points.slice(0, -1).map((point, index) => {
    const next = points[index + 1]!
    const dx = Math.max(0.0001, next.x - point.x)
    return { dx, slope: (next.y - point.y) / dx }
  })
  const slopes = new Array<number>(points.length).fill(0)

  for (let index = 1; index < points.length - 1; index++) {
    const left = intervals[index - 1]!
    const right = intervals[index]!
    if (left.slope === 0 || right.slope === 0 || Math.sign(left.slope) !== Math.sign(right.slope)) {
      slopes[index] = 0
      continue
    }
    const weightLeft = 2 * right.dx + left.dx
    const weightRight = right.dx + 2 * left.dx
    slopes[index] = (weightLeft + weightRight) / (weightLeft / left.slope + weightRight / right.slope)
  }
  // A segment boundary is a real data boundary, not an implied continuation.
  // Zero endpoint tangents keep the curve from kicking sharply into a gap.
  slopes[0] = 0
  slopes[points.length - 1] = 0
  return slopes
}

function curvePath(segment: ViewerSegment): string {
  if (segment.length === 0) return ''
  const points = segment.map(point => ({ x: point.x, y: point.y! }))
  let path = `M${formatNumber(points[0]!.x)} ${formatNumber(points[0]!.y)}`
  if (points.length === 1) return path
  if (points.length === 2) {
    return `${path} L${formatNumber(points[1]!.x)} ${formatNumber(points[1]!.y)}`
  }

  const slopes = monotoneSlopes(points)
  for (let index = 0; index < points.length - 1; index++) {
    const left = points[index]!
    const right = points[index + 1]!
    const dx = right.x - left.x
    if (dx <= 0) {
      path += ` L${formatNumber(right.x)} ${formatNumber(right.y)}`
      continue
    }
    const low = Math.min(left.y, right.y)
    const high = Math.max(left.y, right.y)
    const cp1y = clamp(left.y + slopes[index]! * dx / 3, low, high)
    const cp2y = clamp(right.y - slopes[index + 1]! * dx / 3, low, high)
    path += ` C ${formatNumber(left.x + dx / 3)} ${formatNumber(cp1y)}, ${formatNumber(right.x - dx / 3)} ${formatNumber(cp2y)}, ${formatNumber(right.x)} ${formatNumber(right.y)}`
  }
  return path
}

function linePath(segments: ViewerSegment[]): string {
  return segments.map(segment => {
    if (segment.length !== 1) return curvePath(segment)
    const point = segment[0]!
    if (point.y == null) return ''
    // A single observation is still a bucket, not a point cloud marker. Give
    // it a short horizontal footprint so sampled zero and lone samples remain
    // legible without introducing a persistent circle.
    const halfStroke = 3
    return `M${formatNumber(point.x - halfStroke)} ${formatNumber(point.y)} L${formatNumber(point.x + halfStroke)} ${formatNumber(point.y)}`
  }).filter(Boolean).join(' ')
}

function areaPath(segments: ViewerSegment[], bandBottom: number): string {
  return segments.map(segment => {
    if (segment.length === 0) return ''
    const first = segment[0]!
    const last = segment[segment.length - 1]!
    const curve = curvePath(segment)
    const secondSpace = curve.indexOf(' ', curve.indexOf(' ') + 1)
    const continuation = secondSpace >= 0 ? curve.slice(secondSpace + 1) : ''
    return `M${formatNumber(first.x)} ${formatNumber(bandBottom)} L${formatNumber(first.x)} ${formatNumber(first.y!)}${continuation ? ` ${continuation}` : ''} L${formatNumber(last.x)} ${formatNumber(bandBottom)} Z`
  }).filter(Boolean).join(' ')
}

export function buildViewerOverviewPath(segments: ViewerSegment[]): string {
  return linePath(segments)
}

export function buildViewerOverviewAreaPath(segments: ViewerSegment[], bandBottom: number): string {
  return areaPath(segments, bandBottom)
}

export function buildViewerDetailPath(segments: ViewerSegment[]): string {
  return linePath(segments)
}

export function viewerIdlePointBudget(cssPlotWidth: number): number {
  return Math.round(clamp(
    Number.isFinite(cssPlotWidth) ? Math.max(0, cssPlotWidth) * IDLE_BUDGET_RATIO : 0,
    MIN_IDLE_ANCHORS,
    MAX_IDLE_ANCHORS,
  ))
}

export function viewerDetailPointBudget(cssPlotWidth: number): number {
  return Math.round(clamp(
    Number.isFinite(cssPlotWidth) ? Math.max(0, cssPlotWidth) * DETAIL_BUDGET_RATIO : 0,
    MIN_DETAIL_POINTS,
    MAX_DETAIL_POINTS,
  ))
}

export function buildViewerGeometry(
  overview: ViewerTimedValue[],
  detail: ViewerTimedValue[],
  options: ViewerGeometryOptions,
): ViewerGeometry {
  const plotWidth = Math.max(0, options.width - options.padLeft - options.padRight)
  const scale = options.timestampScale ?? buildViewerTimestampScale(
    [...overview, ...detail],
    options,
  )
  const overviewOrdered = normalizeTimedValues(overview)
  const detailOrdered = normalizeTimedValues(detail)
  const overviewPoints = pointsForValues(overview, scale, options, IDLE_SMOOTHING_MINUTES)
  const detailPoints = pointsForValues(detail, scale, options, DETAIL_SMOOTHING_MINUTES)
  const overviewRawSegments = connectedSegments(overviewPoints, gapThresholdMs(overviewOrdered))
  const detailRawSegments = connectedSegments(detailPoints, gapThresholdMs(detailOrdered))
  const cssPlotWidth = options.plotCssWidth ?? plotWidth
  const idleAnchorCount = options.idleAnchorCount ?? viewerIdlePointBudget(cssPlotWidth)
  const detailPointBudget = options.detailPointBudget ?? viewerDetailPointBudget(cssPlotWidth)
  const overviewSegments = reduceSegments(
    overviewRawSegments,
    idleAnchorCount,
    reduceViewerOverviewSegment,
  )
  const detailSegments = reduceSegments(detailRawSegments, detailPointBudget)

  return {
    scale,
    overviewPoints,
    overviewSegments,
    detailPoints,
    detailSegments,
    idlePathD: buildViewerOverviewPath(overviewSegments),
    idleAreaPathD: buildViewerOverviewAreaPath(overviewSegments, options.bandBottom),
    detailPathD: buildViewerDetailPath(detailSegments),
    points: detailPoints,
    segments: detailSegments,
  }
}

/** Kept as a source-compatible name for package consumers; it no longer morphs. */
export const buildViewerMorphGeometry = buildViewerGeometry

export function viewerPointAtTimestamp(
  geometry: ViewerGeometry,
  minuteTs: string | null | undefined,
): ViewerPoint | null {
  if (!minuteTs || geometry.detailPoints.length === 0) return null
  const exact = geometry.detailPoints.find(point => point.minuteTs === minuteTs)
  if (exact) return exact
  const target = timestampMs(minuteTs)
  if (!Number.isFinite(target)) return null
  let nearest: ViewerPoint | null = null
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const point of geometry.detailPoints) {
    if (!Number.isFinite(point.timestampMs)) continue
    const distance = Math.abs(point.timestampMs - target)
    if (distance < nearestDistance) {
      nearest = point
      nearestDistance = distance
    }
  }
  return nearest
}
