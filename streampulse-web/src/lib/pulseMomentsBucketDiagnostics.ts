import type { HubActivityPoint, HubLiveChannel } from './publicHub'
import type { FigmaMomentRow } from './figmaSessionAnalytics'
import {
  activityBucketKey,
  activityBucketMs,
  activityPointRates,
} from './hubActivitySummary'
import { filterMomentsByBucket, isBucketWithinLiveHorizon } from './pulseMomentsUtils'

export interface PulseMomentsBucketDiagnosticsInput {
  selectedBucketT: number
  activityWindowMinutes: number
  activityPoints: HubActivityPoint[]
  liveMoments: FigmaMomentRow[]
  liveChannels: HubLiveChannel[]
  historicalStatus: 'idle' | 'ready' | 'empty' | 'error'
  historicalReason?: string
  historicalCount: number
  historicalLoading: boolean
}

export interface PulseMomentsBucketDiagnostics {
  bucketStartMs: number
  bucketEndMs: number
  bucketLabel: string
  chartHasActivity: boolean
  chartViewers: number
  chartChatPerMin: number
  withinLiveHorizon: boolean
  livePeaksInBucket: number
  historicalStatus: string
  historicalReason?: string
  historicalCount: number
  historicalLoading: boolean
  summary: string
}

function formatRange(startMs: number, endMs: number): string {
  const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' }
  const start = new Date(startMs).toLocaleTimeString([], opts)
  const end = new Date(endMs).toLocaleTimeString([], opts)
  return `${start} – ${end}`
}

function findActivityPoint(
  points: HubActivityPoint[],
  bucketT: number,
  windowMinutes: number,
): HubActivityPoint | null {
  const key = activityBucketKey(bucketT, windowMinutes)
  let best: HubActivityPoint | null = null
  for (const point of points) {
    if (activityBucketKey(point.t, windowMinutes) !== key) continue
    if (!best || point.t >= best.t) best = point
  }
  return best
}

function chartPointActive(point: HubActivityPoint | null): boolean {
  if (!point) return false
  return (
    point.viewers > 0 ||
    point.chat > 0 ||
    point.seventv > 0 ||
    (point.emotes ?? 0) > 0 ||
    (point.twitch ?? 0) > 0
  )
}

export function buildPulseMomentsBucketDiagnostics(
  input: PulseMomentsBucketDiagnosticsInput,
): PulseMomentsBucketDiagnostics {
  const bucketStartMs = activityBucketKey(input.selectedBucketT, input.activityWindowMinutes)
  const bucketEndMs = bucketStartMs + activityBucketMs(input.activityWindowMinutes) - 1
  const chartPoint = findActivityPoint(
    input.activityPoints,
    input.selectedBucketT,
    input.activityWindowMinutes,
  )
  const normalized = chartPoint
    ? activityPointRates(chartPoint, input.activityWindowMinutes)
    : null
  const chartHasActivity = chartPointActive(chartPoint)
  const livePeaksInBucket = filterMomentsByBucket(
    input.liveMoments,
    input.selectedBucketT,
    input.activityWindowMinutes,
    input.liveChannels,
  ).length
  const withinLiveHorizon = isBucketWithinLiveHorizon(input.selectedBucketT)

  let summary: string
  if (input.historicalLoading) {
    summary = 'Loading corpus peaks for this bucket…'
  } else if (input.historicalCount > 0) {
    summary = `${input.historicalCount} corpus peak${input.historicalCount === 1 ? '' : 's'} matched this bucket.`
  } else if (livePeaksInBucket > 0) {
    summary = `${livePeaksInBucket} live IRC peak${livePeaksInBucket === 1 ? '' : 's'} in this bucket.`
  } else if (!chartHasActivity) {
    summary = 'No chart activity in this bucket — selection may not be meaningful.'
  } else if (!withinLiveHorizon) {
    summary =
      input.historicalReason === 'no_corpus_peaks_in_bucket' || input.historicalStatus === 'empty'
        ? 'Chart shows activity but no stored corpus peaks for this period.'
        : 'Outside the live IRC window — corpus historical peaks are used when indexed.'
  } else {
    summary = 'Chart activity present but no IRC peaks matched this bucket yet.'
  }

  return {
    bucketStartMs,
    bucketEndMs,
    bucketLabel: formatRange(bucketStartMs, bucketEndMs),
    chartHasActivity,
    chartViewers: chartPoint?.viewers ?? 0,
    chartChatPerMin: normalized?.chat ?? 0,
    withinLiveHorizon,
    livePeaksInBucket,
    historicalStatus: input.historicalStatus,
    historicalReason: input.historicalReason,
    historicalCount: input.historicalCount,
    historicalLoading: input.historicalLoading,
    summary,
  }
}
