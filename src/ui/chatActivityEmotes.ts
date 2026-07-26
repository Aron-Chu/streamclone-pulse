import { SPARKLINE_MAX_POINTS, formatHeatOffset } from '@streampulse/pulse-core'
import { CHART_THEME, emoteChartColor } from './chartTheme.ts'
import type { ExtensionEmote, ExtensionRollup, PulseCoverage, PulsePayload } from '../shared/messages.ts'
import { chartBucketRanges } from './extensionChartPoints.ts'
import { firstActiveRollupOffset } from './chartRollupUtils.ts'

export const MAX_PAST_STREAM_ROWS = 3
export const CHAT_INSPECTOR_EMOTE_LIMIT = 8
export const MAX_PLOTTED_EMOTES = 6
/** Emotes listed in Plot on chart picker; plotting remains capped at MAX_PLOTTED_EMOTES. */
export const PLOT_PICKER_EMOTE_LIMIT = 24

export function toggleEmotePlotKeys(
  keys: string[],
  emoteKey: string,
  max = MAX_PLOTTED_EMOTES,
): string[] {
  if (keys.includes(emoteKey)) {
    return keys.filter(key => key !== emoteKey)
  }
  if (keys.length >= max) return keys
  return [...keys, emoteKey]
}

/** Activity of an emote series inside the active chart window. */
export type EmoteWindowActivity = 'loading' | 'none' | 'active'

/**
 * Plottable only when at least one non-missing minute in `rollups` has a non-zero
 * count for this emote. Distinguishes loading (no usable minutes yet) from confirmed none.
 */
export function emoteActivityInRollups(
  rollups: ExtensionRollup[],
  emote: ExtensionEmote,
  options?: { loading?: boolean },
): EmoteWindowActivity {
  if (options?.loading) return 'loading'
  if (rollups.length === 0) return 'loading'
  const hasUsableMinute = rollups.some(rollup => !rollup.missing)
  if (!hasUsableMinute) return 'loading'

  const index = getEmoteCountIndex(rollups)
  const series = index.get(emoteSelectionKey(emote))
  if (series?.some(value => value > 0)) return 'active'
  for (const rollup of rollups) {
    if (rollup.missing) continue
    if (emoteCountAtRollup(rollup, emote) > 0) return 'active'
  }
  return 'none'
}

/** Drop selections whose series is unavailable in the current chart window. */
export function pruneUnavailableEmoteSelections(
  keys: string[],
  catalog: ExtensionEmote[],
  rollups: ExtensionRollup[],
  options?: { loading?: boolean },
): string[] {
  if (keys.length === 0) return keys
  if (options?.loading || rollups.length === 0) return keys
  const hasUsableMinute = rollups.some(rollup => !rollup.missing)
  if (!hasUsableMinute) return keys

  return keys.filter(key => {
    const emote = catalog.find(item => emoteSelectionKey(item) === key)
    if (!emote) return false
    return emoteActivityInRollups(rollups, emote) === 'active'
  })
}

export function overlaySeriesAxisMax(
  values: Array<number | null>,
  normalizePerSeries: boolean,
  sharedMax: number,
): number {
  if (!normalizePerSeries) return sharedMax
  const numeric = values.filter((value): value is number => value != null && value > 0)
  return Math.max(maxSeriesValue(numeric), 1)
}

export const EMOTE_OVERLAY_PALETTE = CHART_THEME.perEmotePalette

export function emoteOverlayColor(index: number): string {
  return emoteChartColor(index)
}

export interface ActivityAxis {
  min: number
  max: number
}

export function activityAxisBounds(seriesValues: number[][]): ActivityAxis {
  const visible: number[] = []
  for (const values of seriesValues) {
    for (const value of values) {
      if (value > 0) visible.push(value)
    }
  }
  if (visible.length === 0) return { min: 0, max: 1 }
  const visibleMin = Math.min(...visible)
  const visibleMax = Math.max(...visible)
  const span = Math.max(0, visibleMax - visibleMin)
  const pad = span > 0 ? span * 0.05 : Math.max(1, visibleMax * 0.08)
  const fitMin = span > 0 ? Math.max(0, Math.floor(visibleMin - pad)) : 0
  const fitMax = Math.max(fitMin + 1, Math.ceil(visibleMax + pad))
  return { min: fitMin, max: fitMax }
}

/** Shared trace lane scale anchored at zero (sidebar / thin lanes). */
export function activityAxisBoundsFromZero(seriesValues: number[][]): ActivityAxis {
  const axis = activityAxisBounds(seriesValues)
  return { min: 0, max: axis.max }
}

export function maxSeriesValue(values: number[]): number {
  return values.reduce((max, value) => Math.max(max, value), 0)
}

export const FULL_TIMELINE_MAX_POINTS = 480

export type RollupWindow = 'recent' | 'full'
export type ChartTimelineWindow = '15m' | '30m' | '60m' | '2h' | '4h' | 'full'

export const CHART_TIMELINE_WINDOWS: readonly ChartTimelineWindow[] = ['15m', '30m', '60m', '2h', '4h', 'full']

export const CHART_WINDOW_OPTIONS: ReadonlyArray<{ value: ChartTimelineWindow; label: string }> = [
  { value: '15m', label: '15 min' },
  { value: '30m', label: '30 min' },
  { value: '60m', label: '60 min' },
  { value: '2h', label: '2 hours' },
  { value: '4h', label: '4 hours' },
  { value: 'full', label: 'Full stream' },
]

export const CHART_WINDOW_SECONDS: Record<Exclude<ChartTimelineWindow, 'full'>, number> = {
  '15m': 15 * 60,
  '30m': 30 * 60,
  '60m': 60 * 60,
  '2h': 2 * 60 * 60,
  '4h': 4 * 60 * 60,
}

function filterChartRollups(rollups: ExtensionRollup[] | undefined): ExtensionRollup[] {
  return (rollups ?? []).filter(rollup => !rollup.missing)
}

export function chartWindowNeedsFullFetch(
  window: ChartTimelineWindow,
  payload?: PulsePayload,
  currentOffsetSeconds = 0,
): boolean {
  if (window !== '2h' && window !== '4h' && window !== 'full') return false
  if (payload && hasFullTimelineRollups(payload) && !fullRollupsMissingStreamPrefix(payload)) {
    return false
  }

  if (!payload || currentOffsetSeconds <= 0) {
    return window === 'full'
  }

  const recent = filterChartRollups(payload.rollups)
  if (recent.length === 0) return true

  const windowSeconds =
    window === 'full' ? currentOffsetSeconds : CHART_WINDOW_SECONDS[window]
  const needFrom = Math.max(0, currentOffsetSeconds - windowSeconds)
  const earliestRecent = recent[0]?.offsetSeconds ?? currentOffsetSeconds
  return earliestRecent > needFrom + 90
}

/**
 * Default BFF polls tail-trim fullRollups to FULL_TIMELINE_MAX_POINTS (480) minutes.
 * Long streams look "complete" but drop the opening ~ (duration - 480) minutes.
 */
export function fullRollupsMissingStreamPrefix(payload: PulsePayload | null | undefined): boolean {
  if (!payload?.fullRollups?.length) return true
  const full = payload.fullRollups
  const current = Math.max(0, payload.currentOffsetSeconds ?? 0)
  if (current <= FULL_TIMELINE_MAX_POINTS * 60) return false

  const first = full[0]?.offsetSeconds ?? 0
  const coverageStart = resolvePayloadCoverageStartOffset(payload)
  if (first <= coverageStart + FULL_CHART_STREAM_START_TOLERANCE_SEC) return false

  const expectedTailStart = Math.max(0, current - FULL_TIMELINE_MAX_POINTS * 60)
  const toleranceSec = 20 * 60
  return first >= expectedTailStart - toleranceSec
}

export function chartTimelineWindowLabel(window: ChartTimelineWindow): string {
  if (window === '15m') return '15 min'
  if (window === '30m') return '30 min'
  if (window === '60m') return '60 min'
  if (window === '2h') return '2 hours'
  if (window === '4h') return '4 hours'
  return 'Full'
}

export function chartTimelineWindowHeader(window: ChartTimelineWindow, hasFullRollups: boolean): string {
  if (window === 'full' && hasFullRollups) return 'Chat activity (full stream)'
  if (window === 'full') return 'Chat activity · waiting for rollups'
  return `Chat activity (${chartTimelineWindowLabel(window)})`
}

function chartWindowSeconds(window: ChartTimelineWindow): number {
  if (window === '15m') return 15 * 60
  if (window === '30m') return 30 * 60
  if (window === '60m') return 60 * 60
  if (window === '2h') return 2 * 60 * 60
  if (window === '4h') return 4 * 60 * 60
  return Number.POSITIVE_INFINITY
}

function rollupSource(payload: PulsePayload, window: RollupWindow): ExtensionRollup[] {
  if (window === 'full' && (payload.fullRollups?.length ?? 0) > 0) {
    return payload.fullRollups ?? []
  }
  if (payload.rollups.length > 0) return payload.rollups
  return payload.fullRollups ?? []
}

export function chatSeriesFromRollups(rollups: ExtensionRollup[]): number[] {
  return rollups.map(rollup => Math.max(0, rollup.chatCount ?? 0))
}

/** Average emote counts over the last N completed rollup minutes. */
export function emoteAveragesFromRollups(
  rollups: ExtensionRollup[],
  windowMinutes = 5,
): { totalPerMin: number; sevenTvPerMin: number; minutes: number } {
  const completed = rollups.filter(r =>
    !r.missing && ((r.totalEmoteCount ?? 0) > 0 || (r.sevenTvEmoteCount ?? 0) > 0),
  )
  const slice = completed.slice(-windowMinutes)
  if (slice.length === 0) {
    return { totalPerMin: 0, sevenTvPerMin: 0, minutes: 0 }
  }
  let total = 0
  let sevenTv = 0
  for (const rollup of slice) {
    total += rollup.totalEmoteCount ?? rollup.sevenTvEmoteCount ?? 0
    sevenTv += rollup.sevenTvEmoteCount ?? 0
  }
  const minutes = slice.length
  return {
    totalPerMin: Math.round(total / minutes),
    sevenTvPerMin: Math.round(sevenTv / minutes),
    minutes,
  }
}

/** Sum of 7TV emote uses across chart rollups (stream window). */
export function streamSevenTvTotal(rollups: ExtensionRollup[]): number {
  return rollups.reduce((sum, rollup) => sum + Math.max(0, rollup.sevenTvEmoteCount ?? 0), 0)
}

export function rollupSeries(payload: PulsePayload, window: RollupWindow = 'recent'): ExtensionRollup[] {
  const maxPoints = window === 'full' ? FULL_TIMELINE_MAX_POINTS : SPARKLINE_MAX_POINTS
  const source = rollupSource(payload, window)
  const filtered = source.filter(rollup => {
    if (rollup.missing) return false
    if (window === 'full') return true
    return (
      (rollup.chatCount ?? 0) > 0
      || (rollup.totalEmoteCount ?? 0) > 0
      || (rollup.sevenTvEmoteCount ?? 0) > 0
      || (rollup.topEmotes?.length ?? 0) > 0
    )
  })
  return filtered.slice(-maxPoints)
}

/** Chart rollups: prefer full-stream payload whenever the backend sends it. */
export function chartRollupSeries(payload: PulsePayload): ExtensionRollup[] {
  return rollupSeries(payload, hasFullTimelineRollups(payload) ? 'full' : 'recent')
}

/** Zero-fill / bucket sparse full-stream rollups so the chart spans stream start → now. */
function mergeTopEmotesAcrossMinutes(emoteLists: ExtensionEmote[][]): ExtensionEmote[] | undefined {
  if (emoteLists.length === 0) return undefined
  const totals = new Map<string, ExtensionEmote>()
  for (const emotes of emoteLists) {
    for (const emote of emotes) {
      const key = emoteSelectionKey(emote)
      const existing = totals.get(key)
      if (existing) {
        totals.set(key, { ...existing, count: existing.count + Math.max(0, emote.count ?? 0) })
      } else {
        totals.set(key, { ...emote, count: Math.max(0, emote.count ?? 0) })
      }
    }
  }
  if (totals.size === 0) return undefined
  return [...totals.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, CHAT_INSPECTOR_EMOTE_LIMIT)
}

/** Matches backend coverageStartToleranceSec and resolvePulseLiveAccess. */
export const FULL_CHART_STREAM_START_TOLERANCE_SEC = 120

/** Skip zero-filling long dead zones before the first chat/emote/viewer minute. */
export const FULL_CHART_DEAD_ZONE_CLIP_SEC = 10 * 60

export function resolveFullChartDensifyFromOffset(
  payload: PulsePayload,
  raw: ExtensionRollup[],
  coverageStartOffsetSeconds?: number,
): number {
  const coverageStart = resolvePayloadCoverageStartOffset(payload, coverageStartOffsetSeconds)
  const firstDataOffset = raw.length > 0 ? raw[0]!.offsetSeconds : coverageStart
  let fromOffset = resolveFullChartFromOffset(coverageStart, firstDataOffset, payload.coverage)

  const firstActive = firstActiveRollupOffset(raw)
  if (
    firstActive != null
    && firstActive > fromOffset + FULL_CHART_DEAD_ZONE_CLIP_SEC
    && !hasMissingPrefixFromStreamStart(payload.coverage)
  ) {
    fromOffset = firstActive
  }
  return fromOffset
}

export function resolvePayloadCoverageStartOffset(
  payload: Pick<PulsePayload, 'coverageStartOffsetSeconds' | 'coverage'>,
  override?: number,
): number {
  return Math.max(
    0,
    override
      ?? payload.coverageStartOffsetSeconds
      ?? payload.coverage?.coverageStartOffsetSeconds
      ?? 0,
  )
}

/** True when backend reports a missing prefix from 00:00 (joined mid-stream), not a quiet opening. */
export function hasMissingPrefixFromStreamStart(coverage?: PulseCoverage | null): boolean {
  if (!coverage) return false
  if (coverage.hasFullStreamCoverage || coverage.trackedFromStart) return false
  const coverageStart = Math.max(0, coverage.coverageStartOffsetSeconds ?? 0)
  if (coverageStart <= FULL_CHART_STREAM_START_TOLERANCE_SEC) return false
  const ranges = coverage.missingRanges ?? []
  if (
    ranges.some(
      range =>
        range.fromOffsetSeconds <= FULL_CHART_STREAM_START_TOLERANCE_SEC
        && range.toOffsetSeconds >= coverageStart - 60,
    )
  ) {
    return true
  }
  if (coverage.state === 'missing_ranges_detected') {
    return true
  }
  // Late join without explicit missingRanges: a large coverage start implies 00:00 was not tracked.
  return coverageStart >= 15 * 60
}

/**
 * Full-stream chart densification start.
 * Quiet openings (chat/viewers warm up a few minutes in) still span 00:00 → now.
 * Late joins keep the honest coverage-start clip.
 */
export function resolveFullChartFromOffset(
  coverageStartOffsetSeconds: number,
  firstDataOffsetSeconds: number,
  coverage?: PulseCoverage | null,
): number {
  if (coverage?.trackedFromStart || coverage?.hasFullStreamCoverage) return 0
  const coverageStart = Math.max(0, coverageStartOffsetSeconds)
  if (coverageStart <= FULL_CHART_STREAM_START_TOLERANCE_SEC) return 0
  if (hasMissingPrefixFromStreamStart(coverage)) {
    return Math.min(coverageStart, Math.max(0, firstDataOffsetSeconds))
  }
  // Without nested coverage, treat long offsets as late join; short ones as warm-up.
  if (!coverage && coverageStart > 15 * 60) {
    return Math.min(coverageStart, Math.max(0, firstDataOffsetSeconds))
  }
  return 0
}

export function densifyRollupsForTimeline(
  rollups: ExtensionRollup[],
  options: { fromOffset: number; toOffset: number; maxPoints: number },
): ExtensionRollup[] {
  const { fromOffset, toOffset, maxPoints } = options
  if (rollups.length === 0 || toOffset <= fromOffset || maxPoints < 2) {
    return rollups
  }

  const byOffset = new Map<number, ExtensionRollup>()
  for (const rollup of rollups) {
    byOffset.set(rollup.offsetSeconds, rollup)
  }

  const step = 60
  const totalMinutes = Math.floor((toOffset - fromOffset) / step) + 1
  if (totalMinutes <= maxPoints) {
    const out: ExtensionRollup[] = []
    for (let off = fromOffset; off <= toOffset; off += step) {
      out.push(
        byOffset.get(off) ?? {
          offsetSeconds: off,
          chatCount: 0,
          sevenTvEmoteCount: 0,
        },
      )
    }
    return out
  }

  const bucketMinutes = totalMinutes / maxPoints
  const out: ExtensionRollup[] = []
  for (let i = 0; i < maxPoints; i += 1) {
    const bucketStart = fromOffset + Math.floor(i * bucketMinutes) * step
    const bucketEnd = fromOffset + Math.floor((i + 1) * bucketMinutes) * step
    let chatSum = 0
    let sevenTvSum = 0
    let totalEmoteSum = 0
    let viewerSum = 0
    let viewerSamples = 0
    const bucketTopEmotes: ExtensionEmote[][] = []
    for (let off = bucketStart; off < bucketEnd; off += step) {
      const rollup = byOffset.get(off)
      if (!rollup) continue
      chatSum += rollup.chatCount ?? 0
      sevenTvSum += rollup.sevenTvEmoteCount ?? 0
      totalEmoteSum += rollup.totalEmoteCount ?? rollup.sevenTvEmoteCount ?? 0
      const viewerCount = rollup.viewerCount ?? 0
      if (viewerCount > 0) {
        viewerSum += viewerCount
        viewerSamples += 1
      }
      if (rollup.topEmotes?.length) bucketTopEmotes.push(rollup.topEmotes)
    }
    const minutesInBucket = Math.max(1, Math.floor((bucketEnd - bucketStart) / step))
    out.push({
      offsetSeconds: bucketStart,
      chatCount: Math.round(chatSum / minutesInBucket),
      sevenTvEmoteCount: Math.round(sevenTvSum / minutesInBucket),
      totalEmoteCount: totalEmoteSum > 0 ? Math.round(totalEmoteSum / minutesInBucket) : undefined,
      viewerCount: viewerSamples > 0 ? Math.round(viewerSum / viewerSamples) : undefined,
      topEmotes: mergeTopEmotesAcrossMinutes(bucketTopEmotes),
    })
  }
  return out
}

type PrepareChartRollupsCache = {
  payload: PulsePayload
  chartWindow: ChartTimelineWindow
  currentOffsetSeconds: number
  coverageStartOffsetSeconds: number | undefined
  result: ExtensionRollup[]
}

let prepareChartRollupsCache: PrepareChartRollupsCache | null = null

export function prepareChartRollups(
  payload: PulsePayload,
  options: {
    chartWindow: ChartTimelineWindow
    currentOffsetSeconds: number
    /** When tracking started late, full-stream charts align here instead of 00:00. */
    coverageStartOffsetSeconds?: number
  },
): ExtensionRollup[] {
  const cache = prepareChartRollupsCache
  if (
    cache
    && cache.payload === payload
    && cache.chartWindow === options.chartWindow
    && cache.currentOffsetSeconds === options.currentOffsetSeconds
    && cache.coverageStartOffsetSeconds === options.coverageStartOffsetSeconds
  ) {
    return cache.result
  }

  const hasFull = hasFullTimelineRollups(payload)
  const useFullSource = hasFull || options.chartWindow === 'full'
  const raw = rollupSeries(payload, useFullSource ? 'full' : 'recent')
  let result: ExtensionRollup[]
  if (options.chartWindow === 'full' && !hasFull) {
    result = []
  } else if (options.chartWindow !== 'full') {
    const lastOffset = raw.length > 0 ? raw[raw.length - 1]!.offsetSeconds : 0
    const toOffset = Math.max(options.currentOffsetSeconds, lastOffset)
    const fromOffset = Math.max(0, toOffset - chartWindowSeconds(options.chartWindow))
    const windowed = raw.filter(
      rollup => rollup.offsetSeconds >= fromOffset && rollup.offsetSeconds <= toOffset,
    )
    // Keep latest rollups visible when the window filter is empty but tracking has data.
    const source = windowed.length > 0 ? windowed : raw
    result = source.slice(-chartMaxPoints(payload, options.chartWindow))
  } else if (!hasFull) {
    result = raw
  } else {
    const lastOffset = raw.length > 0 ? raw[raw.length - 1]!.offsetSeconds : 0
    const toOffset = Math.max(options.currentOffsetSeconds, lastOffset)
    if (toOffset <= 60) {
      result = raw
    } else {
      const fromOffset = resolveFullChartDensifyFromOffset(payload, raw, options.coverageStartOffsetSeconds)
      result = densifyRollupsForTimeline(raw, {
        fromOffset,
        toOffset,
        maxPoints: chartMaxPoints(payload, options.chartWindow),
      })
    }
  }

  prepareChartRollupsCache = {
    payload,
    chartWindow: options.chartWindow,
    currentOffsetSeconds: options.currentOffsetSeconds,
    coverageStartOffsetSeconds: options.coverageStartOffsetSeconds,
    result,
  }
  return result
}

export function chartAlignFromStart(_payload: PulsePayload, _window: ChartTimelineWindow = '60m'): boolean {
  return true
}

export function findRollupIndexByOffset(
  offsets: readonly number[],
  targetOffsetSeconds: number,
  toleranceSeconds = 90,
): number | null {
  if (offsets.length === 0 || !Number.isFinite(targetOffsetSeconds)) return null
  let bestIndex = 0
  let bestDistance = Number.POSITIVE_INFINITY
  for (let i = 0; i < offsets.length; i += 1) {
    const offset = offsets[i]
    if (offset == null) continue
    const distance = Math.abs(offset - targetOffsetSeconds)
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = i
    }
  }
  return bestDistance <= toleranceSeconds ? bestIndex : null
}

/** Map backend peak offsets to visible chart bar indices (deduped, score order preserved). */
export function mapPeakOffsetsToChartIndices(
  peakOffsets: readonly number[],
  chartOffsets: readonly number[],
  toleranceSeconds = 90,
): number[] {
  const seen = new Set<number>()
  const indices: number[] = []
  for (const offset of peakOffsets) {
    const index = findRollupIndexByOffset(chartOffsets, offset, toleranceSeconds)
    if (index != null && !seen.has(index)) {
      seen.add(index)
      indices.push(index)
    }
  }
  return indices
}

function estimateBucketWidthSeconds(chartOffsets: readonly number[]): number {
  if (chartOffsets.length < 2) return 60
  return Math.max(60, chartOffsets[1]! - chartOffsets[0]!)
}

/** Map a stream offset to a densified chart bucket index. */
export function findBucketIndexForOffset(
  chartOffsets: readonly number[],
  targetOffsetSeconds: number,
): number | null {
  if (chartOffsets.length === 0 || !Number.isFinite(targetOffsetSeconds)) return null
  const bucketWidth = estimateBucketWidthSeconds(chartOffsets)
  for (let i = 0; i < chartOffsets.length; i += 1) {
    const start = chartOffsets[i]!
    const next = chartOffsets[i + 1]
    const end = next ?? start + bucketWidth
    if (targetOffsetSeconds >= start && targetOffsetSeconds < end) return i
  }
  const last = chartOffsets.length - 1
  const lastStart = chartOffsets[last]!
  return targetOffsetSeconds >= lastStart ? last : null
}

/** Bucket-aware peak mapping for full-stream densified charts. */
export function mapPeakOffsetsToBucketedChartIndices(
  peakOffsets: readonly number[],
  chartOffsets: readonly number[],
  chatSeries?: readonly number[],
): number[] {
  const seen = new Set<number>()
  const indices: number[] = []
  for (const offset of peakOffsets) {
    const index = findBucketIndexForOffset(chartOffsets, offset)
    if (index == null || seen.has(index)) continue
    if (chatSeries && index < chatSeries.length && (chatSeries[index] ?? 0) <= 0) continue
    seen.add(index)
    indices.push(index)
  }
  return indices
}

export function findChartIndexByOffset(
  chartOffsets: readonly number[],
  targetOffsetSeconds: number,
  options?: { bucketed?: boolean; toleranceSeconds?: number },
): number | null {
  if (options?.bucketed) {
    return findBucketIndexForOffset(chartOffsets, targetOffsetSeconds)
  }
  return findRollupIndexByOffset(chartOffsets, targetOffsetSeconds, options?.toleranceSeconds ?? 90)
}

export function chartMaxPoints(payload: PulsePayload, window: ChartTimelineWindow = '30m'): number {
  if (window === '15m') return 15
  if (window === '30m') return 30
  if (window === '60m') return SPARKLINE_MAX_POINTS
  if (window === '2h') return 120
  if (window === '4h') return 240
  return hasFullTimelineRollups(payload) ? FULL_TIMELINE_MAX_POINTS : SPARKLINE_MAX_POINTS
}

export function chartEmptyMessage(options: {
  rollupCount: number
  chartWindow: ChartTimelineWindow
  hasFullRollups: boolean
  confidence: string
  currentOffsetSeconds: number
  awaitingFullRollups?: boolean
}): string {
  const {
    rollupCount,
    chartWindow,
    hasFullRollups,
    confidence,
    currentOffsetSeconds,
    awaitingFullRollups = false,
  } = options
  const fullTimelineRequested = chartWindow === 'full'
  if (awaitingFullRollups) {
    return 'Loading full stream rollups from Streamclone…'
  }
  if (rollupCount >= 1) return ''
  if (confidence === 'Waiting for first minute') {
    return 'Collecting the first minute of chat rollups. The graph appears here automatically.'
  }
  if (fullTimelineRequested && !hasFullRollups && currentOffsetSeconds > 120) {
    return 'Full stream requested, but Streamclone has no rollups for this broadcast yet. Tracking may have started late or paused.'
  }
  return 'No chat activity in the recent window yet.'
}

/** Largest hole between rollup minutes — surfaces when IRC tracking dropped mid-stream. */
export function describeRollupGap(rollups: ExtensionRollup[]): string | null {
  if (rollups.length < 2) return null
  let maxGap = 0
  let gapAfter = 0
  let gapBefore = 0
  for (let i = 1; i < rollups.length; i += 1) {
    const prev = rollups[i - 1]?.offsetSeconds ?? 0
    const next = rollups[i]?.offsetSeconds ?? 0
    const gap = next - prev
    if (gap > maxGap) {
      maxGap = gap
      gapAfter = prev
      gapBefore = next
    }
  }
  if (maxGap <= 120) return null
  return `Missing chat data from ${formatHeatOffset(gapAfter + 60)} to ${formatHeatOffset(gapBefore)}`
}

export function hasFullTimelineRollups(payload: PulsePayload | null | undefined): boolean {
  return (payload?.fullRollups?.length ?? 0) > 0
}

export function isSevenTvProvider(provider?: string): boolean {
  const value = provider?.trim().toLowerCase() ?? ''
  return value === '7tv' || value === 'seventv'
}

export function emoteSelectionKey(emote: Pick<ExtensionEmote, 'id' | 'name' | 'provider'>): string {
  const provider = isSevenTvProvider(emote.provider) ? 'seventv' : (emote.provider ?? 'seventv')
  const id = emote.id?.trim() || emote.name
  return `${provider}:${id}:${emote.name}`
}

/** Activity of an emote series inside the active chart window. */
export type EmoteWindowActivity = 'loading' | 'none' | 'active'

/**
 * Plottable only when at least one non-missing minute in `rollups` has a non-zero
 * count for this emote. Distinguishes loading (no usable minutes yet) from confirmed none.
 */
export function emoteActivityInRollups(
  rollups: ExtensionRollup[],
  emote: ExtensionEmote,
  options?: { loading?: boolean },
): EmoteWindowActivity {
  if (options?.loading) return 'loading'
  if (rollups.length === 0) return 'loading'
  const hasUsableMinute = rollups.some(rollup => !rollup.missing)
  if (!hasUsableMinute) return 'loading'

  const index = getEmoteCountIndex(rollups)
  const series = index.get(emoteSelectionKey(emote))
  if (series?.some(value => value > 0)) return 'active'
  for (const rollup of rollups) {
    if (rollup.missing) continue
    if (emoteCountAtRollup(rollup, emote) > 0) return 'active'
  }
  return 'none'
}

/** Drop selections whose series is unavailable in the current chart window. */
export function pruneUnavailableEmoteSelections(
  keys: string[],
  catalog: ExtensionEmote[],
  rollups: ExtensionRollup[],
  options?: { loading?: boolean },
): string[] {
  if (keys.length === 0) return keys
  if (options?.loading || rollups.length === 0) return keys
  const hasUsableMinute = rollups.some(rollup => !rollup.missing)
  if (!hasUsableMinute) return keys

  return keys.filter(key => {
    const emote = catalog.find(item => emoteSelectionKey(item) === key)
    if (!emote) return false
    return emoteActivityInRollups(rollups, emote) === 'active'
  })
}

/** Per-emote count series indexed by rollup minute — avoids rescanning topEmotes per trace. */
export type EmoteCountIndex = Map<string, number[]>

const emoteCountIndexCache = new WeakMap<ExtensionRollup[], EmoteCountIndex>()

export function buildEmoteCountIndex(rollups: ExtensionRollup[]): EmoteCountIndex {
  const index: EmoteCountIndex = new Map()
  const n = rollups.length
  for (let i = 0; i < n; i += 1) {
    const top = rollups[i]?.topEmotes
    if (!top?.length) continue
    for (const emote of top) {
      const key = emoteSelectionKey(emote)
      let series = index.get(key)
      if (!series) {
        series = new Array(n).fill(0)
        index.set(key, series)
      }
      series[i] = Math.max(0, emote.count ?? 0)
    }
  }
  return index
}

export function getEmoteCountIndex(rollups: ExtensionRollup[]): EmoteCountIndex {
  const cached = emoteCountIndexCache.get(rollups)
  if (cached) return cached
  const built = buildEmoteCountIndex(rollups)
  emoteCountIndexCache.set(rollups, built)
  return built
}

export function sevenTvEmotesFromRollup(rollup: ExtensionRollup): ExtensionEmote[] {
  return (rollup.topEmotes ?? []).filter(emote => isSevenTvProvider(emote.provider))
}

export function emoteCountAtRollup(rollup: ExtensionRollup, emote: ExtensionEmote): number {
  const targetKey = emoteSelectionKey(emote)
  for (const top of rollup.topEmotes ?? []) {
    if (emoteSelectionKey(top) === targetKey) {
      return Math.max(0, top.count ?? 0)
    }
  }
  return 0
}

export function buildSelectedEmoteSeries(rollups: ExtensionRollup[], emote: ExtensionEmote): number[] {
  const index = getEmoteCountIndex(rollups)
  const series = index.get(emoteSelectionKey(emote))
  if (series) return series.slice()
  return rollups.map(() => 0)
}

/** Sum emote counts per downsample bucket so trace lines stay smooth on long streams. */
export function buildBucketedEmoteSeries(
  fullRollups: ExtensionRollup[],
  displayRollups: ExtensionRollup[],
  emote: ExtensionEmote,
  countIndex?: EmoteCountIndex,
): number[] {
  if (fullRollups.length === 0) return []
  if (fullRollups.length === displayRollups.length) {
    if (countIndex) {
      const series = countIndex.get(emoteSelectionKey(emote))
      return series ? series.slice() : fullRollups.map(() => 0)
    }
    return buildSelectedEmoteSeries(fullRollups, emote)
  }
  const ranges = chartBucketRanges(fullRollups, displayRollups.length)
  if (ranges.length !== displayRollups.length) {
    return buildSelectedEmoteSeries(displayRollups, emote)
  }
  const index = countIndex ?? getEmoteCountIndex(fullRollups)
  const series = index.get(emoteSelectionKey(emote))
  if (!series) return displayRollups.map(() => 0)
  return ranges.map(({ start, end }) => {
    let sum = 0
    for (let i = start; i < end; i += 1) {
      sum += series[i] ?? 0
    }
    return sum
  })
}

export function aggregateChartEmotes(
  rollups: ExtensionRollup[],
  limit = CHAT_INSPECTOR_EMOTE_LIMIT,
): ExtensionEmote[] {
  const totals = new Map<string, ExtensionEmote>()
  for (const rollup of rollups) {
    for (const emote of rollup.topEmotes ?? []) {
      const key = emoteSelectionKey(emote)
      const existing = totals.get(key)
      if (existing) {
        totals.set(key, { ...existing, count: existing.count + Math.max(0, emote.count ?? 0) })
      } else {
        totals.set(key, { ...emote, count: Math.max(0, emote.count ?? 0) })
      }
    }
  }
  return [...totals.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit)
}

/** @deprecated use aggregateChartEmotes */
export const aggregateSevenTvEmotes = aggregateChartEmotes

export function sparklineIndexFromClick(
  clientX: number,
  canvasRect: DOMRect,
  pointCount: number,
  maxPoints: number = SPARKLINE_MAX_POINTS,
  alignFromStart = false,
): number {
  if (pointCount <= 0) return 0
  const width = Math.max(1, canvasRect.width)
  const x = Math.min(Math.max(0, clientX - canvasRect.left), width)
  const effectiveMax = alignFromStart ? pointCount : maxPoints
  const step = width / Math.max(1, effectiveMax - 1)
  const offset = alignFromStart ? 0 : maxPoints - pointCount
  const raw = Math.round(x / step) - offset
  return Math.min(pointCount - 1, Math.max(0, raw))
}

export interface EmoteOverlaySeries {
  key: string
  label: string
  color: string
  values: number[]
  primary?: boolean
  dashed?: boolean
}

export function buildBaselineEmoteOverlays(rollups: ExtensionRollup[]): EmoteOverlaySeries[] {
  const total = rollups.map(rollup =>
    Math.max(0, rollup.totalEmoteCount ?? rollup.sevenTvEmoteCount ?? 0),
  )
  const sevenTv = rollups.map(rollup => Math.max(0, rollup.sevenTvEmoteCount ?? 0))
  const out: EmoteOverlaySeries[] = []
  if (total.some(value => value > 0)) {
    out.push({
      key: 'emotes-total',
      label: 'Emotes',
      color: CHART_THEME.emote.color,
      values: total,
    })
  }
  if (sevenTv.some(value => value > 0)) {
    out.push({
      key: 'emotes-7tv',
      label: '7TV',
      color: '#6ee7b7',
      values: sevenTv,
      dashed: true,
    })
  }
  return out
}

type ProviderOverlayKey = 'twitch' | 'bttv' | 'ffz'

function normalizeProviderOverlayKey(provider?: string): ProviderOverlayKey | null {
  const value = provider?.trim().toLowerCase() ?? ''
  if (value === 'twitch') return 'twitch'
  if (value === 'bttv' || value === 'betterttv') return 'bttv'
  if (value === 'ffz' || value === 'frankerfacez') return 'ffz'
  return null
}

const PROVIDER_OVERLAY_META: Record<
  ProviderOverlayKey,
  { key: string; label: string; color: string }
> = {
  twitch: { key: 'emotes-twitch', label: 'Twitch', color: '#a78bfa' },
  bttv: { key: 'emotes-bttv', label: 'BTTV', color: '#60a5fa' },
  ffz: { key: 'emotes-ffz', label: 'FFZ', color: '#f472b6' },
}

/** Best-effort Twitch/BTTV/FFZ lines from rollup topEmotes provider tags (not dedicated rollup fields). */
export function buildProviderEmoteOverlays(rollups: ExtensionRollup[]): EmoteOverlaySeries[] {
  const series: Record<ProviderOverlayKey, number[]> = {
    twitch: rollups.map(() => 0),
    bttv: rollups.map(() => 0),
    ffz: rollups.map(() => 0),
  }
  rollups.forEach((rollup, index) => {
    for (const emote of rollup.topEmotes ?? []) {
      const key = normalizeProviderOverlayKey(emote.provider)
      if (!key) continue
      series[key][index] = (series[key][index] ?? 0) + Math.max(0, emote.count ?? 0)
    }
  })
  const out: EmoteOverlaySeries[] = []
  for (const key of ['twitch', 'bttv', 'ffz'] as ProviderOverlayKey[]) {
    const values = series[key]
    if (!values.some(value => value > 0)) continue
    const meta = PROVIDER_OVERLAY_META[key]
    out.push({
      key: meta.key,
      label: meta.label,
      color: meta.color,
      values,
      dashed: true,
    })
  }
  return out
}

export function buildEmoteOverlaySeries(
  displayRollups: ExtensionRollup[],
  emotes: ExtensionEmote[],
  fullRollups?: ExtensionRollup[],
): EmoteOverlaySeries[] {
  const source = fullRollups ?? displayRollups
  const countIndex = getEmoteCountIndex(source)
  return emotes.map((emote, index) => ({
    key: emoteSelectionKey(emote),
    label: emote.name,
    color: emoteOverlayColor(index),
    values: buildBucketedEmoteSeries(source, displayRollups, emote, countIndex),
    primary: index === 0,
    dashed: true,
  }))
}

export function mergeEmoteOverlaySeries(series: EmoteOverlaySeries[]): EmoteOverlaySeries[] {
  const seen = new Set<string>()
  const out: EmoteOverlaySeries[] = []
  for (const item of series) {
    if (seen.has(item.key)) continue
    seen.add(item.key)
    out.push(item)
  }
  return out
}
