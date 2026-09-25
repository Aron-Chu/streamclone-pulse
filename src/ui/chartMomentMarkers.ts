import { reactionAnalyticalOffset } from '@streampulse/pulse-core'
import type { ExtensionPeak } from '../shared/messages.ts'

export const MAX_CHART_MOMENT_MARKERS = 12
export const CHART_MOMENT_VIEWPORT_PADDING_SECONDS = 60

export type ChartMomentSignal = 'chat' | 'emotes' | 'viewers'

export interface ChartMomentMarkerBand {
  top: number
  bottom: number
}

export interface ChartMomentMarkerPresentation {
  /** Resting markers stay as dots; only active markers receive a guide line. */
  showGuide: boolean
  guideOpacity: number
  guideDasharray: string | undefined
  dotRadius: number
  dotOpacity: number
  haloRadius: number
  haloOpacity: number
}

/**
 * Convert a signal value into the chart-space y coordinate for its lane.
 * Missing values get a quiet near-baseline position rather than a fabricated
 * point on the signal. The fallback keeps a ranked marker discoverable when a
 * backend peak has no sample for that particular lane.
 */
export function chartMomentMarkerY({
  value,
  axisMin = 0,
  axisMax,
  band,
}: {
  value: number | null | undefined
  axisMin?: number
  axisMax: number
  band: ChartMomentMarkerBand
}): number {
  const top = Math.min(band.top, band.bottom)
  const bottom = Math.max(band.top, band.bottom)
  const height = Math.max(1, bottom - top)
  const safeMin = Number.isFinite(axisMin) ? axisMin : 0
  const safeMax = Number.isFinite(axisMax) && axisMax > safeMin ? axisMax : safeMin + 1
  const numericValue = typeof value === 'number' && Number.isFinite(value) ? value : null
  if (numericValue == null) {
    return bottom - Math.min(10, Math.max(4, height * 0.18))
  }
  const normalized = Math.min(1, Math.max(0, (numericValue - safeMin) / (safeMax - safeMin)))
  return bottom - normalized * height
}

/**
 * Keep the default marker field calm in a narrow sidebar. A focused marker
 * may still provide a full-height guide because it is the user's active
 * inspection target, but resting markers never form a dashed rail.
 */
export function chartMomentMarkerPresentation(active: boolean): ChartMomentMarkerPresentation {
  if (active) {
    return {
      showGuide: true,
      guideOpacity: 0.78,
      guideDasharray: '2 3',
      dotRadius: 4.25,
      dotOpacity: 1,
      haloRadius: 8,
      haloOpacity: 0.18,
    }
  }
  return {
    showGuide: false,
    guideOpacity: 0,
    guideDasharray: undefined,
    dotRadius: 3.25,
    dotOpacity: 0.78,
    haloRadius: 0,
    haloOpacity: 0,
  }
}

export function chartMomentMarkerKey(offsetSeconds: number, score: number, rank: number): string {
  return `${offsetSeconds}-${score}-${rank}`
}

export interface ChartMomentSelection {
  /** All valid backend-ranked moments intersecting the visible coverage. */
  inView: ExtensionPeak[]
  /** The ranked subset rendered on the plot after the display cap. */
  visible: ExtensionPeak[]
}

function momentScore(peak: ExtensionPeak): number {
  if (Number.isFinite(peak.reactionScore)) return peak.reactionScore ?? 0
  if (Number.isFinite(peak.compositeScore)) return peak.compositeScore ?? 0
  return peak.score
}

/**
 * Keep viewport filtering and marker capping in one place. The backend owns
 * peak ranking; this helper only filters the already-ranked candidates by
 * plotted coverage and applies the presentation cap.
 */
export function selectVisibleChartMomentPeaks(
  peaks: readonly ExtensionPeak[],
  startSeconds: number,
  endSeconds: number,
  maxMarkers = MAX_CHART_MOMENT_MARKERS,
): ChartMomentSelection {
  const lower = Math.min(startSeconds, endSeconds) - CHART_MOMENT_VIEWPORT_PADDING_SECONDS
  const upper = Math.max(startSeconds, endSeconds) + CHART_MOMENT_VIEWPORT_PADDING_SECONDS
  const inView = peaks
    .filter(peak => Number.isFinite(peak.offsetSeconds) && Number.isFinite(peak.score))
    .sort((left, right) => (
      momentScore(right) - momentScore(left)
      || left.offsetSeconds - right.offsetSeconds
    ))
    .filter(peak => {
      const offset = reactionAnalyticalOffset(peak)
      return offset >= lower && offset <= upper
    })

  return {
    inView,
    visible: inView.slice(0, Math.max(0, maxMarkers)),
  }
}
