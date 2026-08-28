import type { ChartMinuteRollup } from './types.ts'
import { formatHeatOffset } from '@streampulse/pulse-core'

export function count(value: number | null | undefined) {
  if (value === null || value === undefined) return '-'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return value.toLocaleString()
}

export function clock(value?: string) {
  if (!value) return '-'
  const ts = Date.parse(value)
  if (!Number.isFinite(ts)) return '-'
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function vodClock(minuteTs?: string, startedAt?: string): string {
  if (!minuteTs) return '-'
  if (!startedAt) return clock(minuteTs)
  const startMs = new Date(startedAt).getTime()
  const minuteMs = new Date(minuteTs).getTime()
  if (!Number.isFinite(startMs) || !Number.isFinite(minuteMs)) return clock(minuteTs)
  const offsetSeconds = Math.max(0, Math.floor((minuteMs - startMs) / 1000))
  return formatHeatOffset(offsetSeconds)
}

export function formatVodClock(sec?: number) {
  if (sec == null || sec < 0) return '0s'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`
  return `${s}s`
}

export function seriesMax(values: Array<number | null>) {
  return Math.max(0, ...values.map(value => value ?? 0))
}

export function viewerValue(point: ChartMinuteRollup) {
  return point.viewerLatest || point.viewerAvg || point.viewerMax || (point as any).viewerCount || 0
}

/** Compatibility-only latest value for KPI surfaces, never chart geometry. */
export function viewerLatestKpiValue(point: ChartMinuteRollup & { viewerCount?: number }) {
  return point.viewerLatest || point.viewerCount || 0
}

/** Sampled minute average for chart geometry; falls back to latest/max/count if samples omitted. */
export function chartViewerValue(point: ChartMinuteRollup): number | null {
  if (point.missing) return null
  if (point.viewerSamples !== undefined && point.viewerSamples !== null) {
    if (point.viewerSamples <= 0) return null
    if (point.viewerAvg == null || !Number.isFinite(point.viewerAvg)) return null
    return Math.max(0, point.viewerAvg)
  }
  const fallback = viewerValue(point)
  if (fallback > 0) return fallback
  const explicitCount = (point as ChartMinuteRollup & { viewerCount?: unknown }).viewerCount
  return typeof explicitCount === 'number' && Number.isFinite(explicitCount) && explicitCount > 0
    ? explicitCount
    : null
}

/** Observed chart viewer value, with missing/unobserved minutes kept as gaps. */
export function viewerObservedValue(point: ChartMinuteRollup): number | null {
  return chartViewerValue(point)
}

/** Same observed value as the plot — sampled average when samples exist. */
export function viewerReadoutValue(point: ChartMinuteRollup): number | null {
  return viewerObservedValue(point)
}

export function rollingMedianWindow(values: Array<number | null>, window: number): Array<number | null> {
  if (window <= 1) return values
  const radius = Math.floor(window / 2)
  return values.map((value, index) => {
    if (value === null) return null
    const samples: number[] = []
    for (let j = Math.max(0, index - radius); j <= Math.min(values.length - 1, index + radius); j++) {
      const sample = values[j]
      if (sample !== null && sample > 0) samples.push(sample)
    }
    if (!samples.length) return value
    samples.sort((a, b) => a - b)
    return samples[Math.floor(samples.length / 2)]
  })
}

export function viewerChartSmoothWindow(rollups: ChartMinuteRollup[], viewerSource?: string) {
  if (viewerSource === 'live') return 3
  if (viewerSource === 'tt' || viewerSource === 'twitchtracker') return 5
  if (viewerSource === 'merged') return 4
  const sampleMinutes = rollups.filter(point => !point.missing && (point.viewerSamples ?? 0) >= 2).length
  if (sampleMinutes >= rollups.length * 0.4) return 3
  return 5
}

export function viewerSourceLabel(source?: string) {
  switch (source) {
    case 'live':
      return 'Live samples'
    case 'tt':
    case 'twitchtracker':
      return 'TwitchTracker'
    case 'merged':
      return 'Live + TT gaps'
    case 'partial':
      return 'Partial viewers'
    default:
      return ''
  }
}

export function analyzeViewerCoverage(rollups: ChartMinuteRollup[]) {
  const indexed = rollups
    .map((point, idx) => ({ idx, value: chartViewerValue(point) }))
    .filter((point): point is { idx: number; value: number } => point.value != null)
  if (indexed.length < 3) {
    return {
      hasViewerRollups: false,
      hasFlatViewerLine: false,
      hasPartialTail: false,
      hasShortSpan: false,
    }
  }
  const values = indexed.map(point => point.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const hasFlatViewerLine = min === max
  const tailCount = Math.max(4, Math.floor(indexed.length * 0.4))
  const headCount = Math.max(4, Math.floor(indexed.length * 0.2))
  const tailValues = values.slice(-tailCount)
  const headValues = values.slice(0, headCount)
  const tailFlat = tailValues.length >= 4 && Math.min(...tailValues) === Math.max(...tailValues)
  const headVaried = headValues.length >= 4 && Math.min(...headValues) !== Math.max(...headValues)
  const hasPartialTail = indexed.length >= 12 && tailFlat && headVaried
  const spanMinutes = indexed[indexed.length - 1].idx - indexed[0].idx + 1
  const hasShortSpan = rollups.length >= 10 && spanMinutes / rollups.length < 0.7
  return {
    hasViewerRollups: true,
    hasFlatViewerLine,
    hasPartialTail,
    hasShortSpan,
  }
}

export function minuteEmoteTotal(point: ChartMinuteRollup) {
  const total = point.totalEmoteCount ?? 0
  if (total > 0) return total
  if (!point.emotes) return 0
  return Object.values(point.emotes).reduce((sum, count) => sum + count, 0)
}

export function rollupHasMinuteData(point: ChartMinuteRollup) {
  return !point.missing && (
    (point.viewerSamples ?? 0) > 0
    || (chartViewerValue(point) ?? 0) > 0
    || (point.chatCount ?? 0) > 0
    || minuteEmoteTotal(point) > 0
  )
}

export function rollupsHaveViewerData(rollups: ChartMinuteRollup[]) {
  return rollups.some(point => chartViewerValue(point) !== null)
}

export interface CompositeOverviewSignal {
  values: Array<number | null>
  weight: number
}

function quantile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.round((sorted.length - 1) * fraction)),
  )
  return sorted[index] ?? 0
}

function smoothCompositeSeries(
  values: Array<number | null>,
  window: number,
): Array<number | null> {
  const size = Math.max(1, Math.floor(window))
  if (size <= 1 || values.length <= 2) return values
  const radius = Math.floor(size / 2)
  return values.map((value, index) => {
    if (value === null) return null
    let weightedTotal = 0
    let totalWeight = 0
    for (
      let sampleIndex = Math.max(0, index - radius);
      sampleIndex <= Math.min(values.length - 1, index + radius);
      sampleIndex += 1
    ) {
      const sample = values[sampleIndex]
      if (sample === null) continue
      const distance = Math.abs(sampleIndex - index)
      const weight = radius + 1 - distance
      weightedTotal += sample * weight
      totalWeight += weight
    }
    return totalWeight > 0 ? weightedTotal / totalWeight : value
  })
}

/**
 * Builds the calm overview curve from every available primary signal.
 */
export function buildCompositeOverviewSeries(
  signals: CompositeOverviewSignal[],
  smoothWindow = 5,
): Array<number | null> {
  const usable = signals
    .filter(signal => Number.isFinite(signal.weight) && signal.weight > 0 && signal.values.length > 0)
    .map(signal => {
      const samples = signal.values
        .filter((value): value is number => value !== null && Number.isFinite(value))
        .sort((a, b) => a - b)
      const low = quantile(samples, 0.05)
      const high = quantile(samples, 0.95)
      return {
        ...signal,
        low,
        high,
        span: high - low,
        hasSamples: samples.length > 0,
      }
    })
    .filter(signal => signal.hasSamples)

  const length = usable.reduce((max, signal) => Math.max(max, signal.values.length), 0)
  if (length === 0) return []

  const composite = Array.from({ length }, (_, index): number | null => {
    let total = 0
    let totalWeight = 0
    for (const signal of usable) {
      const value = signal.values[index]
      if (value === null || value === undefined || !Number.isFinite(value)) continue
      const normalized = signal.span > Number.EPSILON
        ? Math.max(0, Math.min(1, (value - signal.low) / signal.span))
        : 0.5
      total += normalized * signal.weight
      totalWeight += signal.weight
    }
    if (totalWeight <= 0) return null
    return total / totalWeight
  })

  return smoothCompositeSeries(composite, smoothWindow)
}

/** Progressive-disclosure bar opacity shared by the detailed chart lanes. */
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
  if (activeIndex == null) return baseOpacity * 0.42
  if (index === activeIndex) return Math.min(highlightOpacity * 1.12, 0.95)
  if (fadeFutureAfterActive) {
    return baseOpacity * (index < activeIndex ? 0.78 : 0.14)
  }
  return baseOpacity * 0.32
}
