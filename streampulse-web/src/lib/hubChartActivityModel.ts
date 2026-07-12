import type { HubActivityPoint } from './publicHub'
import type { PublicHub } from './publicHub'
import {
  chartActivityPoints,
  hubActivityEmoteCount,
} from './hubActivitySummary'
import { livePoolViewerSum } from './hubMetricHelpers'

/** Chart-only slice — excludes trust-line / refresh / poll metadata. */
export interface HubChartActivityInputs {
  points: HubActivityPoint[]
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
  return { chartPoints, peakViewers, peakChatPerMin, peakEmotesPerMin }
}
