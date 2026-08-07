export type MorphTimedValue = {
  offsetSeconds: number
  value: number | null
  missing?: boolean
  bucketStartOffsetSeconds?: number
  bucketEndOffsetSeconds?: number
}

export type ChartOffsetScale = {
  viewBoxWidth: number
  firstOffsetSeconds: number
  lastOffsetSeconds: number
  plotStartX: number
  plotEndX: number
  plotWidth: number
  xForOffset: (offsetSeconds: number) => number
  offsetForX: (x: number) => number
  firstTimestampMs: number
  lastTimestampMs: number
  xForTimestamp: (minuteTs: string, fallbackIndex?: number, fallbackCount?: number) => number
  xForTimestampMs: (timestampMs: number) => number
  timestampAtX: (x: number) => number | null
}

export type StaticChartPoint = {
  offsetSeconds: number
  x: number
  value: number | null
  y: number | null
  index: number
  missing?: boolean
  bucketStartOffsetSeconds?: number
  bucketEndOffsetSeconds?: number
}

export type StaticChartSegment = StaticChartPoint[]

export type InspectionClipGeometry = {
  cursorX: number | null
  beforeWidth: number
  afterX: number
  afterWidth: number
}

export type StaticChartGeometry = {
  scale: ChartOffsetScale
  idlePoints: StaticChartPoint[]
  idleSegments: StaticChartSegment[]
  detailPoints: StaticChartPoint[]
  detailSegments: StaticChartSegment[]
  idleLineD: string
  idleAreaD: string
  detailLineD: string
  detailAreaD: string
  /** Source-compatible aliases for callers that describe the detail lattice. */
  points: StaticChartPoint[]
  segments: StaticChartSegment[]
  idlePathD: string
  detailPathD: string
}

export type MorphGeometry = StaticChartGeometry

export type MorphGeometryOptions = {
  width: number
  padLeft: number
  padRight: number
  bandTop: number
  bandBottom: number
  valueToY: (value: number) => number
  scale?: ChartOffsetScale
  domainStartOffsetSeconds?: number
  domainEndOffsetSeconds?: number
  /** CSS plot width used to derive the idle anchor budget. */
  plotCssWidth?: number
  /** Explicit budgets are useful for deterministic tests and very small hosts. */
  idleAnchorCount?: number
  detailPointBudget?: number
  /** Keep backend-selected moments in both reduced layers when possible. */
  preserveOffsets?: readonly number[]
  idleCurve?: 'monotone' | 'linear'
  detailCurve?: 'linear' | 'monotone'
  originTimestampMs?: number
}

type GeometryPoint = { x: number; y: number }

export const CHART_BUDGET_REFERENCE_WIDTH_PX = 264

const DEFAULT_ACTIVITY_IDLE_POINTS_AT_REFERENCE = 26
const DEFAULT_ACTIVITY_DETAIL_POINTS_AT_REFERENCE = 66

/**
 * Render budgets are deliberately below one point per physical pixel. The
 * viewer line is quieter than the activity lanes, so it gets a smaller lattice.
 */
export function chartPointBudgets(
  cssPlotWidth: number,
  series: 'viewer' | 'activity' = 'activity',
): { idle: number; detail: number } {
  const width = Math.max(1, Number.isFinite(cssPlotWidth) ? cssPlotWidth : CHART_BUDGET_REFERENCE_WIDTH_PX)
  const reference = series === 'viewer'
    ? { idle: 19, detail: 38 }
    : { idle: DEFAULT_ACTIVITY_IDLE_POINTS_AT_REFERENCE, detail: DEFAULT_ACTIVITY_DETAIL_POINTS_AT_REFERENCE }
  return {
    idle: Math.max(2, Math.round(width * reference.idle / CHART_BUDGET_REFERENCE_WIDTH_PX)),
    detail: Math.max(2, Math.round(width * reference.detail / CHART_BUDGET_REFERENCE_WIDTH_PX)),
  }
}

export const CHART_CADENCE_GAP_MULTIPLIER = 1.75

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00'
}

function timestampMs(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

function offsetValues(values: readonly MorphTimedValue[]): number[] {
  return values
    .map(point => point.offsetSeconds)
    .filter(value => Number.isFinite(value))
}

/**
 * Estimate the source cadence without assuming that every chart sample is a
 * one-minute rollup. The densest nearby delta cluster rejects isolated dropped
 * intervals while preserving ordinary 1/2/5/15-minute sampled timelines.
 */
export function inferSampleCadenceSeconds(
  offsets: readonly number[],
  fallbackSeconds = 60,
): number {
  const deltas: number[] = []
  let previous: number | null = null
  for (const offset of offsets) {
    if (!Number.isFinite(offset)) continue
    if (previous != null && offset > previous) deltas.push(offset - previous)
    previous = offset
  }
  if (deltas.length === 0) return Math.max(1, fallbackSeconds)
  let bestMembers: number[] = []
  for (const candidate of deltas) {
    const tolerance = Math.max(5, candidate * 0.2)
    const members = deltas.filter(delta => Math.abs(delta - candidate) <= tolerance)
    if (
      members.length > bestMembers.length
      || (
        members.length === bestMembers.length
        && Math.min(...members) < Math.min(...bestMembers)
      )
    ) {
      bestMembers = members
    }
  }
  bestMembers.sort((left, right) => left - right)
  const middle = Math.floor(bestMembers.length / 2)
  const median = bestMembers.length % 2 === 0
    ? (bestMembers[middle - 1]! + bestMembers[middle]!) / 2
    : bestMembers[middle]!
  return Math.max(1, median)
}

function inferredDomain(values: readonly MorphTimedValue[]): { start: number; end: number } {
  const offsets = offsetValues(values)
  if (offsets.length === 0) return { start: 0, end: 60 }
  const last = Math.max(0, Math.max(...offsets))
  return { start: 0, end: Math.max(60, last) }
}

/**
 * One chart-wide coordinate system. The timestamp members make this object
 * usable by pulse-charts game dividers without giving those dividers a second
 * X mapping.
 */
export function buildCanonicalOffsetScale(options: {
  width: number
  padLeft: number
  padRight: number
  domainStartOffsetSeconds: number
  domainEndOffsetSeconds: number
  originTimestampMs?: number
}): ChartOffsetScale {
  const plotStartX = options.padLeft
  const plotEndX = Math.max(plotStartX, options.width - options.padRight)
  const plotWidth = Math.max(0, plotEndX - plotStartX)
  const firstOffsetSeconds = Math.max(0, finiteOr(options.domainStartOffsetSeconds, 0))
  const requestedEnd = finiteOr(options.domainEndOffsetSeconds, firstOffsetSeconds + 60)
  const lastOffsetSeconds = requestedEnd > firstOffsetSeconds
    ? requestedEnd
    : firstOffsetSeconds + 60
  const originTimestampMs = finiteOr(options.originTimestampMs ?? 0, 0)
  const firstTimestampMs = originTimestampMs + firstOffsetSeconds * 1000
  const lastTimestampMs = originTimestampMs + lastOffsetSeconds * 1000

  const xForOffset = (offsetSeconds: number): number => {
    if (lastOffsetSeconds <= firstOffsetSeconds || plotWidth <= 0) return plotStartX
    const fraction = clamp(
      (finiteOr(offsetSeconds, firstOffsetSeconds) - firstOffsetSeconds)
        / (lastOffsetSeconds - firstOffsetSeconds),
      0,
      1,
    )
    return plotStartX + fraction * plotWidth
  }

  const offsetForX = (x: number): number => {
    if (lastOffsetSeconds <= firstOffsetSeconds || plotWidth <= 0) return firstOffsetSeconds
    const fraction = clamp((x - plotStartX) / plotWidth, 0, 1)
    return firstOffsetSeconds + fraction * (lastOffsetSeconds - firstOffsetSeconds)
  }

  const xForTimestampMs = (value: number): number => {
    if (!Number.isFinite(value)) return plotStartX
    return xForOffset((value - originTimestampMs) / 1000)
  }

  const xForTimestamp = (
    minuteTs: string,
    fallbackIndex = 0,
    fallbackCount = 1,
  ): number => {
    const parsed = timestampMs(minuteTs)
    if (Number.isFinite(parsed)) return xForTimestampMs(parsed)
    const fraction = fallbackCount <= 1 ? 0 : fallbackIndex / (fallbackCount - 1)
    return xForOffset(firstOffsetSeconds + fraction * (lastOffsetSeconds - firstOffsetSeconds))
  }

  const timestampAtX = (x: number): number => originTimestampMs + offsetForX(x) * 1000

  return {
    viewBoxWidth: Math.max(0, options.width),
    firstOffsetSeconds,
    lastOffsetSeconds,
    plotStartX,
    plotEndX,
    plotWidth,
    xForOffset,
    offsetForX,
    firstTimestampMs,
    lastTimestampMs,
    xForTimestamp,
    xForTimestampMs,
    timestampAtX,
  }
}

export function inspectionClipAtOffset(
  scale: ChartOffsetScale,
  offsetSeconds: number | null | undefined,
): InspectionClipGeometry {
  if (offsetSeconds == null || !Number.isFinite(offsetSeconds)) {
    return {
      cursorX: null,
      beforeWidth: 0,
      afterX: scale.plotEndX,
      afterWidth: 0,
    }
  }
  const cursorX = scale.xForOffset(offsetSeconds)
  return {
    cursorX,
    beforeWidth: Math.max(0, cursorX - scale.plotStartX),
    afterX: cursorX,
    afterWidth: Math.max(0, scale.plotEndX - cursorX),
  }
}

function normalizePoints(
  values: readonly MorphTimedValue[],
  scale: ChartOffsetScale,
  valueToY: (value: number) => number,
  bandTop: number,
  bandBottom: number,
): StaticChartPoint[] {
  return values
    .map((point, sourceIndex) => ({
      offsetSeconds: point.offsetSeconds,
      value: !Number.isFinite(point.offsetSeconds)
        || point.missing
        || typeof point.value !== 'number'
        || !Number.isFinite(point.value)
        ? null
        : point.value,
      missing: point.missing,
      bucketStartOffsetSeconds: point.bucketStartOffsetSeconds,
      bucketEndOffsetSeconds: point.bucketEndOffsetSeconds,
      sourceIndex,
    }))
    .map((point, index) => {
      const rawY = point.value == null ? Number.NaN : valueToY(point.value)
      const y = Number.isFinite(rawY) ? clamp(rawY, bandTop, bandBottom) : null
      return {
        offsetSeconds: point.offsetSeconds,
        x: scale.xForOffset(point.offsetSeconds),
        value: point.value,
        y,
        index,
        missing: point.missing,
        bucketStartOffsetSeconds: point.bucketStartOffsetSeconds,
        bucketEndOffsetSeconds: point.bucketEndOffsetSeconds,
      }
    })
}

function connectedSegments(points: StaticChartPoint[]): StaticChartSegment[] {
  const segments: StaticChartSegment[] = []
  let segment: StaticChartSegment = []
  const cadenceSeconds = inferSampleCadenceSeconds(points.map(point => point.offsetSeconds))

  const flush = (): void => {
    if (segment.length > 0) segments.push(segment)
    segment = []
  }

  for (const point of points) {
    if (point.value == null || point.y == null) {
      flush()
      continue
    }
    const previous = segment[segment.length - 1]
    if (
      previous
      && (
        point.offsetSeconds <= previous.offsetSeconds
        || (
          Number.isFinite(previous.bucketEndOffsetSeconds)
          && Number.isFinite(point.bucketStartOffsetSeconds)
          && point.bucketStartOffsetSeconds! > previous.bucketEndOffsetSeconds! + 0.001
        )
        || (
          !Number.isFinite(previous.bucketEndOffsetSeconds)
          && !Number.isFinite(point.bucketStartOffsetSeconds)
          && point.offsetSeconds - previous.offsetSeconds
            > cadenceSeconds * CHART_CADENCE_GAP_MULTIPLIER
        )
      )
    ) {
      flush()
    }
    segment.push(point)
  }
  flush()
  return segments
}

function chooseExtrema(segment: StaticChartSegment, start: number, end: number): number[] {
  if (end <= start) return []
  let minIndex = start
  let maxIndex = start
  for (let index = start + 1; index < end; index += 1) {
    const value = segment[index]!.value!
    if (value < segment[minIndex]!.value!) minIndex = index
    if (value > segment[maxIndex]!.value!) maxIndex = index
  }
  return minIndex === maxIndex ? [minIndex] : [minIndex, maxIndex]
}

/** Retain endpoints plus min/max values from each horizontal bucket. */
export function reduceStaticSegment(
  segment: StaticChartSegment,
  budget: number,
  preserveOffsets: readonly number[] = [],
): StaticChartSegment {
  if (segment.length <= budget || segment.length <= 2) return segment
  const target = Math.max(2, Math.floor(budget))
  const interiorLength = segment.length - 2
  const bucketCount = Math.max(1, Math.floor((target - 2) / 2))
  const selected = new Set<number>([0, segment.length - 1])

  for (let index = 1; index < segment.length - 1; index += 1) {
    const offset = segment[index]!.offsetSeconds
    if (preserveOffsets.some(preserved => preserved === offset)) selected.add(index)
  }

  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = 1 + Math.floor((bucket * interiorLength) / bucketCount)
    const end = 1 + Math.floor(((bucket + 1) * interiorLength) / bucketCount)
    for (const index of chooseExtrema(segment, start, Math.max(start + 1, end))) {
      selected.add(index)
    }
  }

  const ordered = [...selected].sort((left, right) => left - right)
  if (ordered.length <= target) return ordered.map(index => segment[index]!)

  // Protected moments and endpoints win over the visual budget. A moment
  // should not disappear merely because another bucket contains a larger peak.
  const protectedIndices = new Set<number>([0, segment.length - 1])
  for (let index = 1; index < segment.length - 1; index += 1) {
    if (preserveOffsets.some(preserved => preserved === segment[index]!.offsetSeconds)) {
      protectedIndices.add(index)
    }
  }
  const kept = ordered.filter(index => protectedIndices.has(index))
  for (const index of ordered) {
    if (kept.length >= target) break
    if (!protectedIndices.has(index)) kept.push(index)
  }
  return kept.sort((left, right) => left - right).map(index => segment[index]!)
}

function reduceSegments(
  segments: StaticChartSegment[],
  budget: number,
  preserveOffsets: readonly number[] = [],
): StaticChartSegment[] {
  return segments.map(segment => reduceStaticSegment(segment, budget, preserveOffsets))
}

function reduceSegmentsToTotalBudget(
  segments: StaticChartSegment[],
  budget: number,
  preserveOffsets: readonly number[] = [],
): StaticChartSegment[] {
  const target = Math.max(2, Math.floor(budget))
  const minimum = segments.length * 2
  if (segments.reduce((total, segment) => total + segment.length, 0) <= target) return segments

  const totalBudget = Math.max(target, minimum)
  const base = Math.floor(totalBudget / Math.max(1, segments.length))
  const remainder = totalBudget % Math.max(1, segments.length)
  return segments.map((segment, index) => reduceStaticSegment(
    segment,
    base + (index < remainder ? 1 : 0),
    preserveOffsets,
  ))
}

function monotoneSlopes(points: GeometryPoint[]): number[] {
  if (points.length <= 1) return points.map(() => 0)
  if (points.length === 2) {
    const dx = Math.max(0.0001, points[1]!.x - points[0]!.x)
    const slope = (points[1]!.y - points[0]!.y) / dx
    return [slope, slope]
  }

  const intervals = points.slice(0, -1).map((point, index) => {
    const next = points[index + 1]!
    const dx = Math.max(0.0001, next.x - point.x)
    return { dx, slope: (next.y - point.y) / dx }
  })
  const slopes = new Array<number>(points.length).fill(0)

  // Keep the one-sided endpoint tangents horizontal and exact at both edges.
  slopes[0] = 0
  for (let index = 1; index < points.length - 1; index += 1) {
    const left = intervals[index - 1]!
    const right = intervals[index]!
    if (left.slope === 0 || right.slope === 0 || Math.sign(left.slope) !== Math.sign(right.slope)) {
      slopes[index] = 0
      continue
    }
    const weightLeft = 2 * right.dx + left.dx
    const weightRight = right.dx + 2 * left.dx
    slopes[index] = (weightLeft + weightRight)
      / (weightLeft / left.slope + weightRight / right.slope)
  }
  slopes[points.length - 1] = 0
  return slopes
}

function curveParts(
  segment: StaticChartSegment,
  curve: 'monotone' | 'linear',
): { start: string; commands: string[] } {
  const first = segment[0]!
  if (segment.length <= 1) {
    return {
      // Do not turn an isolated observation into a pill that looks like a
      // measured interval. A real neighboring sample or bucket is required
      // for a painted line segment.
      start: `M${formatNumber(first.x)} ${formatNumber(first.y!)}`,
      commands: [],
    }
  }
  const start = `M${formatNumber(first.x)} ${formatNumber(first.y!)}`

  if (curve === 'linear' || segment.length === 2) {
    return {
      start,
      commands: segment.slice(1).map(point => `L${formatNumber(point.x)} ${formatNumber(point.y!)}`),
    }
  }

  const points = segment.map(point => ({ x: point.x, y: point.y! }))
  const slopes = monotoneSlopes(points)
  const commands: string[] = []
  for (let index = 0; index < points.length - 1; index += 1) {
    const left = points[index]!
    const right = points[index + 1]!
    const dx = right.x - left.x
    if (dx <= 0) {
      commands.push(`L${formatNumber(right.x)} ${formatNumber(right.y)}`)
      continue
    }
    const low = Math.min(left.y, right.y)
    const high = Math.max(left.y, right.y)
    const cp1y = clamp(left.y + slopes[index]! * dx / 3, low, high)
    const cp2y = clamp(right.y - slopes[index + 1]! * dx / 3, low, high)
    commands.push(
      `C ${formatNumber(left.x + dx / 3)} ${formatNumber(cp1y)}, `
      + `${formatNumber(right.x - dx / 3)} ${formatNumber(cp2y)}, `
      + `${formatNumber(right.x)} ${formatNumber(right.y)}`,
    )
  }
  return { start, commands }
}

function linePath(
  segments: StaticChartSegment[],
  curve: 'monotone' | 'linear',
): string {
  return segments
    .map(segment => {
      const parts = curveParts(segment, curve)
      return [parts.start, ...parts.commands].join(' ')
    })
    .join(' ')
}

function areaPath(
  segments: StaticChartSegment[],
  bandBottom: number,
  curve: 'monotone' | 'linear',
): string {
  return segments
    .filter(segment => segment.length > 1)
    .map(segment => {
      const first = segment[0]!
      const last = segment[segment.length - 1]!
      const parts = curveParts(segment, curve)
      return [
        `M${formatNumber(first.x)} ${formatNumber(bandBottom)}`,
        `L${formatNumber(first.x)} ${formatNumber(first.y!)}`,
        ...parts.commands,
        `L${formatNumber(last.x)} ${formatNumber(bandBottom)}`,
        'Z',
      ].join(' ')
    })
    .join(' ')
}

function resolveScale(
  idleValues: readonly MorphTimedValue[],
  detailValues: readonly MorphTimedValue[],
  options: MorphGeometryOptions,
): ChartOffsetScale {
  if (options.scale) return options.scale
  const combined = [...idleValues, ...detailValues]
  const inferred = inferredDomain(combined)
  return buildCanonicalOffsetScale({
    width: options.width,
    padLeft: options.padLeft,
    padRight: options.padRight,
    domainStartOffsetSeconds: options.domainStartOffsetSeconds ?? inferred.start,
    domainEndOffsetSeconds: options.domainEndOffsetSeconds ?? inferred.end,
    originTimestampMs: options.originTimestampMs,
  })
}

export function buildStaticChartGeometry(
  idleValues: MorphTimedValue[],
  detailValues: MorphTimedValue[],
  options: MorphGeometryOptions,
): StaticChartGeometry {
  const scale = resolveScale(idleValues, detailValues, options)
  const idlePoints = normalizePoints(
    idleValues,
    scale,
    options.valueToY,
    options.bandTop,
    options.bandBottom,
  )
  const detailPoints = normalizePoints(
    detailValues,
    scale,
    options.valueToY,
    options.bandTop,
    options.bandBottom,
  )
  const cssPlotWidth = options.plotCssWidth ?? options.width
  const budgets = chartPointBudgets(cssPlotWidth)
  const idleBudget = options.idleAnchorCount ?? budgets.idle
  const detailBudget = options.detailPointBudget ?? budgets.detail
  const idleSegments = reduceSegments(
    connectedSegments(idlePoints),
    idleBudget,
    options.preserveOffsets,
  )
  const detailSegments = reduceSegmentsToTotalBudget(
    connectedSegments(detailPoints),
    detailBudget,
    options.preserveOffsets,
  )
  const idleCurve = options.idleCurve ?? 'monotone'
  const detailCurve = options.detailCurve ?? 'linear'

  return {
    scale,
    idlePoints,
    idleSegments,
    detailPoints,
    detailSegments,
    idleLineD: linePath(idleSegments, idleCurve),
    idleAreaD: areaPath(idleSegments, options.bandBottom, idleCurve),
    detailLineD: linePath(detailSegments, detailCurve),
    detailAreaD: areaPath(detailSegments, options.bandBottom, detailCurve),
    points: detailPoints,
    segments: detailSegments,
    idlePathD: linePath(idleSegments, idleCurve),
    detailPathD: linePath(detailSegments, detailCurve),
  }
}

/** Alias names make the static intent explicit at call sites and in tests. */
export const buildIdleDetailGeometry = buildStaticChartGeometry
export const buildChartGeometry = buildStaticChartGeometry
/** Kept for source compatibility; this function performs no morphing. */
export const buildMorphGeometry = buildStaticChartGeometry
