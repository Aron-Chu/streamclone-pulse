import type { HubActivityPoint, PublicHub } from './publicHub'
import {
  chartActivityPoints,
  hasMeasuredActivitySignal,
  hasViewerSample,
  hubActivityEmoteCount,
  isViewerCoveragePartial,
  isViewerCoverageQualified,
  isMeasuredActivityPoint,
  resolveHubActivityChartState,
  type HubActivityChartState,
} from './hubActivitySummary'
import {
  boundedHubActivityPoints,
  resolveHubActivityChartWindowMinutes,
} from './hubActivityHonesty'
import { livePoolViewerSum } from './hubMetricHelpers'
import { rhythmLines as computeRhythmLines, type RhythmLines } from './hubChartGeometry'
import {
  classifyMomentMarker,
  type HubChartAnnotation,
} from './hubChartMarkers'
import type { HubActivityMomentMarker } from '../ui/components/hub/HubActivityChart'

/** Chart-only slice — excludes trust-line / refresh / poll metadata. */
export interface HubChartActivityInputs {
  points: HubActivityPoint[]
  /** Served chart window minutes (degraded live-pool vs accounted healthy). */
  windowMinutes: number
  livePoolViewerSum: number
  /** Moment markers for annotation labels; optional, falls back to marker key. */
  markers?: HubActivityMomentMarker[]
  /** Marker key → channel login, used for annotation labels. Optional. */
  markerChannelNames?: Map<string, string>
}

export interface HubChartActivityModel {
  chartPoints: HubActivityPoint[]
  chartState: HubActivityChartState
  measuredPointCount: number
  signalPointCount: number
  viewerSampleCount: number
  viewerQualifiedCount: number
  viewerPartialCount: number
  peakViewers: number
  peakViewersAt: number | null
  peakChatPerMin: number
  peakChatAt: number | null
  peakEmotesPerMin: number
  peakEmotesAt: number | null
  rhythmLines: RhythmLines | null
  annotations: HubChartAnnotation[]
}

/** Select normalized chart inputs without reading refresh/trust-line fields. */
export function selectHubChartActivityInputs(hub: PublicHub): HubChartActivityInputs {
  return {
    points: boundedHubActivityPoints(hub.activity),
    // Degraded live-pool fallback charts against availableWindowMinutes so
    // fillActivityPoints does not invent empty historical buckets. Healthy
    // accounted windows (measured + attested gaps) chart the full served span
    // so gap markers remain visible breaks — never interpolated measured zeros.
    windowMinutes: resolveHubActivityChartWindowMinutes(hub.activity),
    livePoolViewerSum: livePoolViewerSum(hub),
  }
}

/**
 * Derive the large chart series once. Peaks are taken from that series so
 * callers do not re-run chartActivityPoints for each KPI.
 */
export function deriveHubChartActivityModel(
  inputs: HubChartActivityInputs,
  nowMs?: number,
): HubChartActivityModel {
  const chartPoints = chartActivityPoints(
    inputs.points,
    inputs.windowMinutes,
    nowMs,
    inputs.livePoolViewerSum,
  )
  let peakViewers = 0
  let peakViewersAt: number | null = null
  let peakChatPerMin = 0
  let peakChatAt: number | null = null
  let peakEmotesPerMin = 0
  let peakEmotesAt: number | null = null
  const measuredPointCount = chartPoints.filter(isMeasuredActivityPoint).length
  const signalPointCount = chartPoints.filter(hasMeasuredActivitySignal).length
  const viewerSampleCount = chartPoints.filter(hasViewerSample).length
  const viewerQualifiedCount = chartPoints.filter(isViewerCoverageQualified).length
  const viewerPartialCount = chartPoints.filter(isViewerCoveragePartial).length
  for (const point of chartPoints) {
    if (isViewerCoverageQualified(point) && point.viewers > peakViewers) {
      peakViewers = point.viewers
      peakViewersAt = point.t
    }
    if (point.chat > peakChatPerMin) {
      peakChatPerMin = point.chat
      peakChatAt = point.t
    }
    const emotes = hubActivityEmoteCount(point)
    if (emotes > peakEmotesPerMin) {
      peakEmotesPerMin = emotes
      peakEmotesAt = point.t
    }
  }

  const rhythmLines = computeRhythmLines(chartPoints, {
    dims: { height: 0, paddingBottom: 0 }, // geometry renders in own coordinate space; values reused by subcomponent
  })

  const rawAnnotations: HubChartAnnotation[] = (inputs.markers ?? []).map((m) => ({
    key: m.key,
    bucketT: m.bucketT,
    at: m.at,
    kind: classifyMomentMarker(m),
    channelName: inputs.markerChannelNames?.get(m.key) ?? m.key,
    source: 'network',
  }))

  return {
    chartPoints,
    chartState: resolveHubActivityChartState(chartPoints),
    measuredPointCount,
    signalPointCount,
    viewerSampleCount,
    viewerQualifiedCount,
    viewerPartialCount,
    peakViewers,
    peakViewersAt,
    peakChatPerMin,
    peakChatAt,
    peakEmotesPerMin,
    peakEmotesAt,
    rhythmLines,
    annotations: rawAnnotations,
  }
}
