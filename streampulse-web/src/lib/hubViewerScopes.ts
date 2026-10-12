import { assessViewerCoverage } from './hubActivitySummary'
import type { HubActivityPoint, PublicHub } from './publicHub'
import { livePoolViewerSum } from './hubMetricHelpers'

/**
 * The hub carries two viewer populations that must never sit side by side as
 * if they measured the same thing:
 *
 * - **Watching now** (`activity.livePoolViewerSum`, else the sum of
 *   `liveChannels[].viewers`): the current Twitch viewer counts of the live
 *   channels listed in this hub snapshot (the backend caps the list at 500).
 * - **Sampled viewers** (the chart's viewer line): for each time bucket, the
 *   sum of viewer counts in one complete viewer-sampling pass over the configured
 *   channel roster (`viewerExpectedContributors` channels, of which
 *   `viewerContributors` were live). Its population is usually much smaller
 *   than the live list, so its peak can sit far below "watching now".
 *
 * One strip shows one of them, with its scope in the label and definition.
 */

export const WATCHING_NOW_LABEL = 'Watching now'
export const SAMPLED_PEAK_LABEL = 'Peak sampled viewers'

export function watchingNowDefinition(liveChannelCount: number): string {
  const channels = liveChannelCount > 0 ? `${liveChannelCount.toLocaleString('en-US')} ` : ''
  return `Current Twitch viewer counts added up across the ${channels}tracked channels live in this snapshot. Not all of Twitch. The chart's viewer line samples a different roster, so its numbers are not comparable.`
}

export const SAMPLED_VIEWERS_DEFINITION =
  "Each bucket adds up the viewer counts from one complete sampling pass over the configured roster of tracked channels, counting only the channels live at that moment. Buckets without a complete pass are left out. Fewer of these channels are usually live than in the live channel list, so these numbers are not comparable with 'Watching now'."

export interface HubSampledViewerPoint {
  viewers: number
  t: number
  /** Live channels counted in this bucket, when the backend says. */
  liveChannels?: number
  /** Channels in the sampled roster, when the backend says. */
  rosterChannels?: number
}

export interface HubViewerScopes {
  watchingNow: { viewers: number; liveChannels: number }
  /** Highest fully sampled bucket of the chart's viewer line. */
  sampledPeak: HubSampledViewerPoint | null
  /** Newest fully sampled bucket of the same line. */
  sampledLatest: HubSampledViewerPoint | null
}

function sampledPoint(point: HubActivityPoint): HubSampledViewerPoint {
  const coverage = assessViewerCoverage(point)
  return {
    viewers: point.viewers,
    t: point.t,
    liveChannels: coverage.contributors,
    rosterChannels: coverage.expectedContributors,
  }
}

/**
 * Peak and newest value of the chart's viewer line, read only from buckets the
 * chart itself treats as coverage-qualified. Both come from the same series, so
 * the peak is never below the newest value.
 */
export function hubSampledViewerExtremes(chartPoints: readonly HubActivityPoint[]): {
  peak: HubSampledViewerPoint | null
  latest: HubSampledViewerPoint | null
} {
  let peak: HubActivityPoint | null = null
  let latest: HubActivityPoint | null = null
  for (const point of chartPoints) {
    const coverage = assessViewerCoverage(point)
    if (!coverage.qualified || !Number.isFinite(point.viewers) || point.viewers < 0) continue
    if (!peak || point.viewers > peak.viewers) peak = point
    if (!latest || point.t > latest.t) latest = point
  }
  return {
    peak: peak && peak.viewers > 0 ? sampledPoint(peak) : null,
    latest: latest ? sampledPoint(latest) : null,
  }
}

export function hubLiveChannelCount(hub: Pick<PublicHub, 'liveChannels'>): number {
  return hub.liveChannels.filter((channel) => (channel.viewers ?? 0) > 0).length
}

export function hubViewerScopes(hub: PublicHub, chartPoints: readonly HubActivityPoint[]): HubViewerScopes {
  const extremes = hubSampledViewerExtremes(chartPoints)
  return {
    watchingNow: { viewers: livePoolViewerSum(hub), liveChannels: hubLiveChannelCount(hub) },
    sampledPeak: extremes.peak,
    sampledLatest: extremes.latest,
  }
}

/** "41 live of 500 sampled channels", or null when the backend gave no counts. */
export function sampledRosterLabel(point: Pick<HubSampledViewerPoint, 'liveChannels' | 'rosterChannels'> | null): string | null {
  if (!point || point.liveChannels == null || point.rosterChannels == null || point.rosterChannels <= 0) return null
  return `${point.liveChannels.toLocaleString('en-US')} live of ${point.rosterChannels.toLocaleString('en-US')} sampled channels`
}
