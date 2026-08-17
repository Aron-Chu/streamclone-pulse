import type { HubActivityPoint, PublicHub } from './publicHub'
import {
  chartActivityPoints,
  hubActivityEmoteCount,
} from './hubActivitySummary'
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
  windowMinutes: number
  livePoolViewerSum: number
  markers?: HubActivityMomentMarker[]
  /** Channel-name lookup for marker annotation. Optional — falls back to key. */
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
    windowMinutes: hub.activity.windowMinutes,
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