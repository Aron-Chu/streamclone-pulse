import type { HubActivityPoint } from './publicHub'
import type { PublicHub } from './publicHub'
import {
  chartActivityPoints,
  hubActivityEmoteCount,
} from './hubActivitySummary'
import { resolveHubActivityChartWindowMinutes } from './hubActivityHonesty'
import { livePoolViewerSum } from './hubMetricHelpers'

/** Chart-only slice — excludes trust-line / refresh / poll metadata. */
export interface HubChartActivityInputs {
  points: HubActivityPoint[]
  /** Served chart window (available when degraded; else requested). */
  windowMinutes: number
  livePoolViewerSum: number
}

export interface HubChartActivityModel {
  chartPoints: HubActivityPoint[]
  peakViewers: number
  peakChatPerMin: number
  peakEmotesPerMin: number
}

/** Select normalized chart inputs without reading refresh/trust-line fields. */
export function selectHubChartActivityInputs(hub: PublicHub): HubChartActivityInputs {
  return {
    points: hub.activity.points,
    // Degraded live-pool fallback charts against availableWindowMinutes so
    // fillActivityPoints does not invent empty historical buckets.
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
  return { chartPoints, peakViewers, peakChatPerMin, peakEmotesPerMin }
}
