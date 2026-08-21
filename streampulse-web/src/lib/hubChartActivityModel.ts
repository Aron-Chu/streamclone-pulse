import type { HubActivityPoint, PublicHub } from './publicHub'
import {
  chartActivityPoints,
  hubActivityEmoteCount,
} from './hubActivitySummary'
import { resolveHubActivityChartWindowMinutes } from './hubActivityHonesty'
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
  peakViewers: number
  peakChatPerMin: number
  peakEmotesPerMin: number
  rhythmLines: RhythmLines | null
  annotations: HubChartAnnotation[]
}

/** Select normalized chart inputs without reading refresh/trust-line fields. */
export function selectHubChartActivityInputs(hub: PublicHub): HubChartActivityInputs {
  return {
    points: hub.activity.points,
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
  let peakChatPerMin = 0
  let peakEmotesPerMin = 0
  for (const point of chartPoints) {
    if (point.viewers > peakViewers) peakViewers = point.viewers
    if (point.chat > peakChatPerMin) peakChatPerMin = point.chat
    const emotes = hubActivityEmoteCount(point)
    if (emotes > peakEmotesPerMin) peakEmotesPerMin = emotes
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
    peakViewers,
    peakChatPerMin,
    peakEmotesPerMin,
    rhythmLines,
    annotations: rawAnnotations,
  }
}