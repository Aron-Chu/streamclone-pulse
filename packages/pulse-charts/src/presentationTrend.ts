/**
 * Layer B — presentation trend geometry.
 *
 * Analytical truth stays in composeRenderView / buildRenderBuckets.
 * This module produces a pixel-budgeted, gap-aware centerline for calm
 * overview strokes. Presentation mid-indices are never pin/seek identity.
 */

import type { RenderBucketRange, RenderSignalBucket } from './renderBuckets.ts'
import { contiguousSegmentsForRange } from './renderView.ts'

/**
 * Stream-start-anchored LOD step with last-bucket absorb.
 *
 * Ordinary live appends keep the previous step so historical ranges do not
 * reshuffle at thresholds such as 300→301. Coarsen only when the remainder
 * bucket would be ≥ 2× step. Never refine (decrease step) on append — that
 * oscillates at the boundary. Pass `previousStep` from the last trend for
 * the same viewport/mode; omit it when the viewport or plot width changes.
 */
export function resolvePresentationStep(
  sampleCount: number,
  maxBuckets: number,
  previousStep?: number,
): number {
  const count = Math.max(0, Math.floor(sampleCount))
  const budget = Math.max(1, Math.floor(maxBuckets))
  if (count <= budget) return 1
  const desired = Math.max(1, Math.ceil(count / budget))
  if (previousStep == null || previousStep < 1) return desired

  const step = Math.max(1, Math.floor(previousStep))
  const fullCount = Math.min(budget - 1, Math.max(0, Math.floor((count - 1) / step)))
  const lastLen = count - fullCount * step
  if (desired > step && lastLen >= step * 2) {
    return desired
  }
  return step
}

function buildStablePresentationRanges(
  sampleCount: number,
  maxBuckets: number,
  step: number,
): RenderBucketRange[] {
  const count = Math.max(0, Math.floor(sampleCount))
  const budget = Math.max(1, Math.floor(maxBuckets))
  const lockedStep = Math.max(1, Math.floor(step))
  if (count === 0) return []
  if (lockedStep <= 1 && count <= budget) {
    return Array.from({ length: count }, (_, index) => ({
      bucketIndex: index,
      startIndex: index,
      endExclusive: index + 1,
    }))
  }
  const ranges: RenderBucketRange[] = []
  let start = 0
  let bucketIndex = 0
  while (start + lockedStep < count && ranges.length < budget - 1) {
    ranges.push({
      bucketIndex,
      startIndex: start,
      endExclusive: start + lockedStep,
    })
    start += lockedStep
    bucketIndex += 1
  }
  ranges.push({
    bucketIndex,
    startIndex: start,
    endExclusive: count,
  })
  return ranges
}

function bucketsFromStableRanges(
  values: readonly (number | null | undefined)[],
  ranges: readonly RenderBucketRange[],
): RenderSignalBucket[] {
  return ranges.map((range) => {
    const points: { index: number; value: number }[] = []
    for (let index = range.startIndex; index < range.endExclusive; index++) {
      const value = values[index]
      if (isFiniteValue(value)) points.push({ index, value })
    }
    if (points.length === 0) {
      return {
        ...range,
        first: null,
        last: null,
        peak: null,
        minimum: null,
        maximum: null,
        sum: 0,
        count: 0,
        average: null,
      }
    }
    let peak = points[0]!
    let minimum = points[0]!
    let maximum = points[0]!
    let sum = 0
    for (const point of points) {
      sum += point.value
      if (point.value > peak.value) peak = point
      if (point.value < minimum.value) minimum = point
      if (point.value > maximum.value) maximum = point
    }
    return {
      ...range,
      first: points[0]!,
      last: points[points.length - 1]!,
      peak,
      minimum,
      maximum,
      sum,
      count: points.length,
      average: sum / points.length,
    }
  })
}

export type SemanticLodMode = 'overview' | 'intermediate' | 'exact'

export type PresentationTrendPoint = {
  /** Mid index for presentation x only — not hover/pin/reaction identity. */
  presentationMidIndex: number
  value: number
  sourceStartIndex: number
  sourceEndExclusive: number
  /** Always average of observed run — never inherits peak.index. */
  valueKind: 'average'
}

export type PresentationTrendSegment = {
  points: PresentationTrendPoint[]
}

export type PresentationTrend = {
  mode: SemanticLodMode
  segments: PresentationTrendSegment[]
  pointCount: number
  /** Max connected points allowed for this plot width / mode. */
  pointBudget: number
  /** Locked LOD step used to build ranges (1 in exact / under-budget). */
  step: number
  /**
   * True when one-point segments exceeded the budget and representative
   * observed segments were kept. Gaps are never joined.
   */
  degraded: boolean
}

export type BuildPresentationTrendOptions = {
  plotWidth: number
  /** Canonical minutes currently visible. */
  sampleCount?: number
  mode?: SemanticLodMode
  /**
   * Seconds or samples per pixel for LOD. When omitted, derived from
   * sampleCount / plotWidth when sampleCount is provided.
   */
  samplesPerPixel?: number
  previousMode?: SemanticLodMode
  /** Previous trend.step for the same viewport — keeps live appends stable. */
  previousStep?: number
  /**
   * Last committed presentation trend for the same viewport/mode/plot width.
   * Ordinary live appends reuse this instead of rebuilding all ranges.
   */
  previousTrend?: PresentationTrend
}

const OVERVIEW_ENTER_SPP = 1.35
const OVERVIEW_EXIT_SPP = 1.15
const EXACT_ENTER_SPP = 0.45
const EXACT_EXIT_SPP = 0.55

/** At most ~1 presentation point per 2px in overview. */
export function presentationPointBudget(plotWidth: number, mode: SemanticLodMode): number {
  const width = Math.max(1, Number.isFinite(plotWidth) ? plotWidth : 1)
  if (mode === 'exact') {
    return Math.max(24, Math.ceil(width * 2))
  }
  if (mode === 'intermediate') {
    return Math.max(24, Math.ceil(width / 1.5))
  }
  return Math.max(16, Math.ceil(width / 2))
}

/**
 * Semantic LOD from samples-per-pixel with hysteresis so modes do not flicker.
 */
export function resolveSemanticLodMode(options: {
  samplesPerPixel: number
  previous?: SemanticLodMode
}): SemanticLodMode {
  const spp = Number.isFinite(options.samplesPerPixel) ? Math.max(0, options.samplesPerPixel) : 0
  const prev = options.previous

  if (prev === 'overview') {
    if (spp < OVERVIEW_EXIT_SPP) {
      return spp <= EXACT_ENTER_SPP ? 'exact' : 'intermediate'
    }
    return 'overview'
  }
  if (prev === 'exact') {
    if (spp > EXACT_EXIT_SPP) {
      return spp >= OVERVIEW_ENTER_SPP ? 'overview' : 'intermediate'
    }
    return 'exact'
  }
  if (prev === 'intermediate') {
    if (spp >= OVERVIEW_ENTER_SPP) return 'overview'
    if (spp <= EXACT_ENTER_SPP) return 'exact'
    return 'intermediate'
  }

  if (spp >= OVERVIEW_ENTER_SPP) return 'overview'
  if (spp <= EXACT_ENTER_SPP) return 'exact'
  return 'intermediate'
}

function isFiniteValue(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value)
}

function averageOfPoints(points: readonly { value: number }[]): number | null {
  if (points.length === 0) return null
  let sum = 0
  for (const point of points) sum += point.value
  return sum / points.length
}

function pointsFromExactMinutes(
  values: readonly (number | null | undefined)[],
): PresentationTrendSegment[] {
  const segments: PresentationTrendSegment[] = []
  let active: PresentationTrendPoint[] = []

  const flush = () => {
    if (active.length === 0) return
    segments.push({ points: active })
    active = []
  }

  for (let index = 0; index < values.length; index++) {
    const value = values[index]
    if (!isFiniteValue(value)) {
      flush()
      continue
    }
    active.push({
      presentationMidIndex: index,
      value,
      sourceStartIndex: index,
      sourceEndExclusive: index + 1,
      valueKind: 'average',
    })
  }
  flush()
  return segments
}

function pointsFromBuckets(
  values: readonly (number | null | undefined)[],
  buckets: readonly RenderSignalBucket[],
): PresentationTrendSegment[] {
  const segments: PresentationTrendSegment[] = []
  let active: PresentationTrendPoint[] = []

  const flush = () => {
    if (active.length === 0) return
    segments.push({ points: active })
    active = []
  }

  let lastObservedEnd = -1
  for (const bucket of buckets) {
    if (bucket.count <= 0 || bucket.average == null) {
      flush()
      continue
    }

    const runs = contiguousSegmentsForRange(values, bucket)
    if (runs.length === 0) {
      flush()
      continue
    }

    for (const run of runs) {
      // Flush whenever the next observed run starts after the previous run's
      // endExclusive — including a one-minute gap that lands exactly on a
      // LOD bucket boundary.
      if (lastObservedEnd >= 0 && run.startIndex > lastObservedEnd) {
        flush()
      }
      const avg = averageOfPoints(run.points)
      if (avg == null) continue
      const mid = (run.startIndex + run.endExclusive - 1) / 2
      active.push({
        presentationMidIndex: mid,
        value: avg,
        sourceStartIndex: run.startIndex,
        sourceEndExclusive: run.endExclusive,
        valueKind: 'average',
      })
      lastObservedEnd = run.endExclusive
    }
  }
  flush()
  return segments
}

/**
 * Decimate a segment to at most `budget` points while keeping endpoints and
 * roughly uniform spacing. Deterministic.
 */
export function decimatePresentationPoints(
  points: readonly PresentationTrendPoint[],
  budget: number,
): PresentationTrendPoint[] {
  const cap = Math.floor(budget)
  if (cap <= 0 || points.length === 0) return []
  if (points.length <= cap) return [...points]
  if (cap === 1) {
    return [points[Math.floor((points.length - 1) / 2)]!]
  }
  const out: PresentationTrendPoint[] = [points[0]!]
  const innerBudget = cap - 2
  for (let i = 1; i <= innerBudget; i++) {
    const index = Math.round((i * (points.length - 1)) / (cap - 1))
    const point = points[index]!
    if (out[out.length - 1] !== point) out.push(point)
  }
  const last = points[points.length - 1]!
  if (out[out.length - 1] !== last) out.push(last)
  return out
}

function observedSourceLength(segment: PresentationTrendSegment): number {
  const first = segment.points[0]
  const last = segment.points[segment.points.length - 1]
  if (!first || !last) return 0
  return Math.max(1, last.sourceEndExclusive - first.sourceStartIndex)
}

function minSegmentAllocation(segment: PresentationTrendSegment): number {
  const n = segment.points.length
  if (n <= 1) return n
  return 2
}

/**
 * When one-point segments exceed the pixel budget, keep first/last and evenly
 * spaced representatives. Never join gaps.
 */
export function selectRepresentativeSegments(
  segments: readonly PresentationTrendSegment[],
  budget: number,
): PresentationTrendSegment[] {
  const n = segments.length
  const keep = Math.max(0, Math.min(Math.floor(budget), n))
  if (keep === 0) return []
  if (keep >= n) return segments.map((segment) => ({ points: [...segment.points] }))

  const coverage = segments.map((segment, index) => ({
    index,
    length: observedSourceLength(segment),
    midpointDistance: Math.abs(index - (n - 1) / 2),
  }))

  const indices: number[] = []
  if (keep === 1) {
    coverage.sort((a, b) => {
      if (b.length !== a.length) return b.length - a.length
      if (a.midpointDistance !== b.midpointDistance) return a.midpointDistance - b.midpointDistance
      return a.index - b.index
    })
    indices.push(coverage[0]!.index)
  } else {
    for (let i = 0; i < keep; i++) {
      const index = Math.round((i * (n - 1)) / (keep - 1))
      if (indices.length === 0 || indices[indices.length - 1] !== index) {
        indices.push(index)
      }
    }
    let cursor = 0
    while (indices.length < keep && cursor < n) {
      if (!indices.includes(cursor)) indices.push(cursor)
      cursor += 1
    }
    indices.sort((a, b) => a - b)
  }
  return indices.slice(0, keep).map((index) => {
    const segment = segments[index]!
    if (segment.points.length <= 1) return { points: [...segment.points] }
    const mid = segment.points[Math.floor((segment.points.length - 1) / 2)]!
    return { points: [mid] }
  })
}

/**
 * Apply `pointBudget` to the entire rendered signal, not independently per
 * segment. Reserve endpoints, then distribute remainder by observed source
 * length with largest-remainder rounding (ties break toward lower index).
 */
function allocateGlobalBudget(
  segments: readonly PresentationTrendSegment[],
  pointBudget: number,
): { segments: PresentationTrendSegment[]; degraded: boolean } {
  const budget = Math.max(0, Math.floor(pointBudget))
  const nonempty = segments.filter((segment) => segment.points.length > 0)
  if (budget <= 0 || nonempty.length === 0) {
    return { segments: [], degraded: false }
  }

  const mins = nonempty.map((segment) =>
    Math.min(minSegmentAllocation(segment), segment.points.length),
  )
  const minTotal = mins.reduce((sum, value) => sum + value, 0)
  if (minTotal > budget) {
    return {
      segments: selectRepresentativeSegments(nonempty, budget),
      degraded: true,
    }
  }

  const totalPoints = nonempty.reduce((sum, segment) => sum + segment.points.length, 0)
  if (totalPoints <= budget) {
    return {
      segments: nonempty.map((segment) => ({ points: [...segment.points] })),
      degraded: false,
    }
  }

  const remaining = budget - minTotal
  const extraCap = nonempty.map((segment, index) => segment.points.length - mins[index]!)
  const weights = nonempty.map(observedSourceLength)
  const weightSum = weights.reduce((sum, value) => sum + value, 0) || 1
  const extras = extraCap.map((cap, index) => {
    if (remaining <= 0 || cap <= 0) return 0
    const raw = (remaining * weights[index]!) / weightSum
    return Math.min(cap, Math.floor(raw))
  })
  let leftover = remaining - extras.reduce((sum, value) => sum + value, 0)
  while (leftover > 0) {
    let progressed = false
    const order = extras
      .map((_, index) => index)
      .filter((index) => extras[index]! < extraCap[index]!)
      .sort((a, b) => {
        const fracA = ((remaining * weights[a]!) / weightSum)
          - Math.floor((remaining * weights[a]!) / weightSum)
        const fracB = ((remaining * weights[b]!) / weightSum)
          - Math.floor((remaining * weights[b]!) / weightSum)
        if (fracB !== fracA) return fracB - fracA
        return a - b
      })
    for (const index of order) {
      if (leftover <= 0) break
      if (extras[index]! >= extraCap[index]!) continue
      extras[index] += 1
      leftover -= 1
      progressed = true
    }
    if (!progressed) break
  }

  return {
    segments: nonempty
      .map((segment, index) => ({
        points: decimatePresentationPoints(segment.points, mins[index]! + extras[index]!),
      }))
      .filter((segment) => segment.points.length > 0),
    degraded: false,
  }
}

function trendSampleCount(trend: PresentationTrend): number {
  let max = 0
  for (const segment of trend.segments) {
    for (const point of segment.points) {
      max = Math.max(max, point.sourceEndExclusive)
    }
  }
  return max
}

function cloneTrendSegments(trend: PresentationTrend): PresentationTrendSegment[] {
  return trend.segments.map((segment) => ({
    points: segment.points.map((point) => ({ ...point })),
  }))
}

function reaverageRange(
  values: readonly (number | null | undefined)[],
  startIndex: number,
  endExclusive: number,
): number | null {
  let sum = 0
  let count = 0
  for (let index = startIndex; index < endExclusive; index++) {
    const value = values[index]
    if (isFiniteValue(value)) {
      sum += value
      count += 1
    }
  }
  return count === 0 ? null : sum / count
}

function countPresentationPoints(segments: readonly PresentationTrendSegment[]): number {
  return segments.reduce((sum, segment) => sum + segment.points.length, 0)
}

function mergePresentationPoints(
  left: PresentationTrendPoint,
  right: PresentationTrendPoint,
  values: readonly (number | null | undefined)[],
): PresentationTrendPoint {
  const sourceStartIndex = Math.min(left.sourceStartIndex, right.sourceStartIndex)
  const sourceEndExclusive = Math.max(left.sourceEndExclusive, right.sourceEndExclusive)
  return {
    presentationMidIndex: (sourceStartIndex + sourceEndExclusive - 1) / 2,
    value: reaverageRange(values, sourceStartIndex, sourceEndExclusive) ?? left.value,
    sourceStartIndex,
    sourceEndExclusive,
    valueKind: 'average',
  }
}

/**
 * Coarsen only the oldest prefix until `pointBudget` fits. Never joins gaps.
 * One-point segments stay split; if every remaining segment is a singleton,
 * drop the oldest singleton (degraded) rather than bridging a null.
 */
function compactOldestPrefix(
  segments: PresentationTrendSegment[],
  values: readonly (number | null | undefined)[],
  pointBudget: number,
): boolean {
  let droppedSingleton = false
  while (countPresentationPoints(segments) > pointBudget) {
    const index = segments.findIndex((segment) => segment.points.length >= 2)
    if (index >= 0) {
      const segment = segments[index]!
      const merged = mergePresentationPoints(segment.points[0]!, segment.points[1]!, values)
      segment.points.splice(0, 2, merged)
      continue
    }
    if (segments.length <= 1) break
    segments.shift()
    droppedSingleton = true
  }
  return droppedSingleton
}

/**
 * Stream-start-anchored live append: extend the open tail, or add a 1-minute
 * tail point, then compact only the oldest prefix if over budget.
 * Returns null when the previous trend cannot be reused.
 */
function appendPresentationTrend(
  previous: PresentationTrend,
  values: readonly (number | null | undefined)[],
  pointBudget: number,
  mode: SemanticLodMode,
): PresentationTrend | null {
  const prevCount = trendSampleCount(previous)
  if (values.length !== prevCount + 1) return null
  if (previous.pointBudget !== pointBudget || previous.mode !== mode) return null

  const step = Math.max(1, previous.step)
  const segments = cloneTrendSegments(previous)
  const newIndex = prevCount
  const newValue = values[newIndex]

  if (isFiniteValue(newValue)) {
    const lastSegment = segments[segments.length - 1]
    const lastPoint = lastSegment?.points[lastSegment.points.length - 1]
    if (lastPoint && lastPoint.sourceEndExclusive === newIndex) {
      const lastLen = lastPoint.sourceEndExclusive - lastPoint.sourceStartIndex
      if (lastLen < step) {
        lastPoint.sourceEndExclusive = newIndex + 1
        const average = reaverageRange(values, lastPoint.sourceStartIndex, lastPoint.sourceEndExclusive)
        if (average != null) lastPoint.value = average
        lastPoint.presentationMidIndex = (lastPoint.sourceStartIndex + lastPoint.sourceEndExclusive - 1) / 2
      } else if (lastSegment) {
        lastSegment.points.push({
          presentationMidIndex: newIndex,
          value: newValue,
          sourceStartIndex: newIndex,
          sourceEndExclusive: newIndex + 1,
          valueKind: 'average',
        })
      }
    } else {
      segments.push({
        points: [{
          presentationMidIndex: newIndex,
          value: newValue,
          sourceStartIndex: newIndex,
          sourceEndExclusive: newIndex + 1,
          valueKind: 'average',
        }],
      })
    }
  }

  let degraded = previous.degraded
  if (countPresentationPoints(segments) > pointBudget) {
    if (compactOldestPrefix(segments, values, pointBudget)) degraded = true
  }
  if (countPresentationPoints(segments) > pointBudget) {
    const allocated = allocateGlobalBudget(segments, pointBudget)
    return {
      mode,
      segments: allocated.segments,
      pointCount: countPresentationPoints(allocated.segments),
      pointBudget,
      step,
      degraded: true,
    }
  }

  return {
    mode,
    segments,
    pointCount: countPresentationPoints(segments),
    pointBudget,
    step,
    degraded,
  }
}

/**
 * Build a gap-aware presentation trend from a nullable signal.
 * Does not mutate analytical composeRenderView output.
 */
export function buildPresentationTrend(
  values: readonly (number | null | undefined)[],
  options: BuildPresentationTrendOptions,
): PresentationTrend {
  const plotWidth = Math.max(1, options.plotWidth)
  const sampleCount = options.sampleCount ?? values.length
  const samplesPerPixel = options.samplesPerPixel
    ?? (plotWidth > 0 ? sampleCount / plotWidth : sampleCount)
  const mode = options.mode
    ?? resolveSemanticLodMode({ samplesPerPixel, previous: options.previousMode })
  const pointBudget = presentationPointBudget(plotWidth, mode)

  if (options.previousTrend) {
    const appended = appendPresentationTrend(options.previousTrend, values, pointBudget, mode)
    if (appended) return appended
  }

  let segments: PresentationTrendSegment[]
  let step = 1
  if (mode === 'exact' || sampleCount <= pointBudget) {
    segments = pointsFromExactMinutes(values)
  } else {
    const bucketBudget = Math.min(pointBudget, Math.max(1, Math.ceil(plotWidth / 2)))
    step = resolvePresentationStep(
      values.length,
      bucketBudget,
      options.previousTrend?.step ?? options.previousStep,
    )
    const ranges = buildStablePresentationRanges(values.length, bucketBudget, step)
    const buckets = bucketsFromStableRanges(values, ranges)
    segments = pointsFromBuckets(values, buckets)
  }

  const allocated = allocateGlobalBudget(segments, pointBudget)
  const pointCount = allocated.segments.reduce(
    (sum, segment) => sum + segment.points.length,
    0,
  )
  return {
    mode,
    segments: allocated.segments,
    pointCount,
    pointBudget,
    step,
    degraded: allocated.degraded,
  }
}

export function presentationTrendPathD(
  trend: PresentationTrend,
  args: {
    xForIndex: (index: number) => number
    yForValue: (value: number) => number
  },
): string {
  const parts: string[] = []
  for (const segment of trend.segments) {
    const points = segment.points.map((point) => ({
      x: args.xForIndex(point.presentationMidIndex),
      y: args.yForValue(point.value),
    }))
    const path = monotoneCubicPath(points)
    if (path) parts.push(path)
  }
  return parts.join(' ')
}

/**
 * Shape-preserving monotone cubic Hermite path (Fritsch–Carlson style).
 * No overshoot beyond adjacent y values; linear for ≤2 points; empty → "".
 */
export function monotoneCubicPath(
  points: readonly { x: number; y: number }[],
): string {
  if (points.length === 0) return ''
  const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : '0.00')
  const first = points[0]!
  let path = `M${fmt(first.x)} ${fmt(first.y)}`
  if (points.length === 1) return path
  if (points.length === 2) {
    const second = points[1]!
    return `${path} L${fmt(second.x)} ${fmt(second.y)}`
  }

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
  slopes[0] = 0
  slopes[points.length - 1] = 0

  for (let index = 0; index < points.length - 1; index++) {
    const left = points[index]!
    const right = points[index + 1]!
    const dx = right.x - left.x
    if (dx <= 0) {
      path += ` L${fmt(right.x)} ${fmt(right.y)}`
      continue
    }
    const low = Math.min(left.y, right.y)
    const high = Math.max(left.y, right.y)
    const cp1y = Math.min(high, Math.max(low, left.y + (slopes[index]! * dx) / 3))
    const cp2y = Math.min(high, Math.max(low, right.y - (slopes[index + 1]! * dx) / 3))
    path += ` C ${fmt(left.x + dx / 3)} ${fmt(cp1y)}, ${fmt(right.x - dx / 3)} ${fmt(cp2y)}, ${fmt(right.x)} ${fmt(right.y)}`
  }
  return path
}

/** Area under monotone path segments, closed to bandBottom. */
export function monotoneCubicAreaPath(
  segments: readonly { x: number; y: number }[][],
  bandBottom: number,
): string {
  const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : '0.00')
  return segments.map((points) => {
    if (points.length === 0) return ''
    const first = points[0]!
    const last = points[points.length - 1]!
    const curve = monotoneCubicPath(points)
    const secondSpace = curve.indexOf(' ', curve.indexOf(' ') + 1)
    const continuation = secondSpace >= 0 ? curve.slice(secondSpace + 1) : ''
    return `M${fmt(first.x)} ${fmt(bandBottom)} L${fmt(first.x)} ${fmt(first.y)}${continuation ? ` ${continuation}` : ''} L${fmt(last.x)} ${fmt(bandBottom)} Z`
  }).filter(Boolean).join(' ')
}

/** Shared inspection context opacity (legible, not disabled-looking). */
export const INSPECTION_AFTER_OPACITY = 0.4
