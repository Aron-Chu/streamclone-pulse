/**
 * Hub activity points -> SpChart data (plan §1.1 item 3, §1.5, D2).
 *
 * Built once per data change. The API sends bucket totals at
 * `activity.bucketMinutes`; the chart draws per-minute rates on that grid
 * (one sample per server bucket), so the finest bar is the server bucket and
 * is never hard-coded. Viewers are drawn only where the backend states a
 * viewer coverage (`viewerCoverage != null`); every other bucket is a hatched
 * viewer gap. Peaks are the max over the points (no client scoring); the
 * payload's `peakViewersAt` is never read.
 */
import type { SpChartData } from '@streampulse/pulse-charts/spchart'
import type { HubActivityPoint, HubBucketEmote, HubProviderCoverageMap } from '../../../lib/publicHub'
import { bucketMinutes as clientBucketMinutes, hasProviderSample, hasViewerSample, hubActivityEmoteCount } from '../../../lib/hubActivitySummary'
import { isActivityGapMarker } from '../../../lib/hubActivityHonesty'

/** Slots kept at most (1 year of 6-hour buckets is 1,460). */
export const HUB_SP_MAX_SLOTS = 1500

export interface HubSpPeak {
  value: number
  t: number
  index: number
}

export interface HubSpViewerPeak extends HubSpPeak {
  /** Channels in the viewer sum at the peak, when the backend sends it. */
  live: number | null
}

export interface HubSpLatest {
  index: number
  t: number
  point: HubActivityPoint
  chat: number
  emotes: number
  viewers: number | null
  live: number | null
  roster: number | null
}

export interface HubSpStamp {
  index: number
  t: number
  emote: HubBucketEmote
}

export interface HubActivitySpModel {
  data: SpChartData
  bucketMinutes: number
  bucketMs: number
  count: number
  /** The served point in each slot; null where the API sent none. */
  points: readonly (HubActivityPoint | null)[]
  /** 7TV and other (emotes - 7TV) uses per minute; NaN where unmeasured. */
  sevenTv: Float64Array
  other: Float64Array
  sevenTvLowerBound: boolean
  otherLowerBound: boolean
  /** 1 where the bucket's emote total is a minimum (`providerCountsLowerBound`): shown with a leading "≥". */
  emotesLowerBound: Uint8Array
  peakChat: HubSpPeak | null
  peakEmotes: HubSpPeak | null
  peakViewers: HubSpViewerPeak | null
  latest: HubSpLatest | null
  /** The busiest chat bucket's top emote (bucket total), or null. */
  stamp: HubSpStamp | null
}

export interface HubActivitySpModelOptions {
  /** `activity.bucketMinutes` from the API; the client rule only for legacy payloads without it. */
  bucketMinutes?: number | null
  providerCoverage?: HubProviderCoverageMap | null
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function coverageLowerBound(map: HubProviderCoverageMap | null | undefined, key: string): boolean {
  const entry = map?.[key]
  return entry != null && typeof entry === 'object' && (entry as { lowerBound?: unknown }).lowerBound === true
}

/**
 * The served bucket length in minutes: the API's `activity.bucketMinutes`;
 * the client rule for the window only for legacy payloads without it. When the
 * served points sit closer together than the API's value (a live-pool fallback
 * that serves a shorter window than it was asked for), the points' own spacing
 * wins, so no two served buckets ever share a slot.
 */
export function hubBucketMinutes(windowMinutes: number, apiBucketMinutes?: number | null, pointSpacingMinutes?: number | null): number {
  const api = finite(apiBucketMinutes) && apiBucketMinutes > 0 ? apiBucketMinutes : null
  const spacing = finite(pointSpacingMinutes) && pointSpacingMinutes > 0 ? pointSpacingMinutes : null
  if (api != null) return spacing != null && spacing < api ? spacing : api
  return clientBucketMinutes(Math.max(1, windowMinutes))
}

/** Smallest gap between consecutive served points, in whole minutes (at least 1), or null. */
export function pointSpacingMinutes(points: readonly HubActivityPoint[]): number | null {
  let min = Infinity
  for (let index = 1; index < points.length; index += 1) {
    const gap = points[index]!.t - points[index - 1]!.t
    if (gap > 0 && gap < min) min = gap
  }
  return Number.isFinite(min) ? Math.max(1, Math.round(min / 60_000)) : null
}

/** Top emotes of a bucket, busiest first (a copy). */
export function sortedTopEmotes(point: HubActivityPoint | null | undefined): HubBucketEmote[] {
  const list = point?.topEmotes
  if (!list?.length) return []
  return list.filter((emote) => emote && typeof emote.name === 'string' && finite(emote.count)).slice().sort((a, b) => b.count - a.count)
}

export function buildHubActivitySpModel(
  points: readonly HubActivityPoint[],
  windowMinutes: number,
  options: HubActivitySpModelOptions = {},
): HubActivitySpModel | null {
  const ordered = points.filter((point) => point && finite(point.t)).slice().sort((a, b) => a.t - b.t)
  const bucketMinutes = hubBucketMinutes(windowMinutes, options.bucketMinutes, pointSpacingMinutes(ordered))
  const bucketMs = Math.round(bucketMinutes * 60_000)
  if (!(bucketMs > 0)) return null
  // The open trailing bucket is not drawn (the chart only shows closed buckets).
  if (ordered.length && ordered[ordered.length - 1]!.bucketComplete !== true) ordered.pop()
  if (!ordered.length) return null

  const count = Math.max(2, Math.min(HUB_SP_MAX_SLOTS, Math.ceil(Math.max(1, windowMinutes) / bucketMinutes)))
  const last = ordered[ordered.length - 1]!
  const startMs = last.t - (count - 1) * bucketMs
  const slots: (HubActivityPoint | null)[] = new Array(count).fill(null)
  for (const point of ordered) {
    const index = Math.round((point.t - startMs) / bucketMs)
    if (index >= 0 && index < count) slots[index] = point
  }

  const chat = new Float64Array(count).fill(NaN)
  const emotes = new Float64Array(count).fill(NaN)
  const viewers = new Float64Array(count).fill(NaN)
  const coverage = new Uint8Array(count).fill(2)
  const sevenTv = new Float64Array(count).fill(NaN)
  const other = new Float64Array(count).fill(NaN)
  const emotesLowerBound = new Uint8Array(count)
  let peakChat: HubSpPeak | null = null
  let peakEmotes: HubSpPeak | null = null
  let peakViewers: HubSpViewerPeak | null = null
  let latestIndex = -1
  let anyCountsLowerBound = false

  for (let index = 0; index < count; index += 1) {
    const point = slots[index]
    if (!point) continue
    if (point.providerCountsLowerBound === true) anyCountsLowerBound = true
    const gap = isActivityGapMarker(point)
    const chatMeasured = !gap && point.hasChatRollup !== false && finite(point.chat)
    const viewerState = point.viewerCoverage ?? point.viewerCoverageDetail?.state
    const viewerShown = !gap && viewerState != null && hasViewerSample(point) && finite(point.viewers)
    if (chatMeasured) {
      const chatRate = point.chat / bucketMinutes
      const total = hubActivityEmoteCount(point)
      chat[index] = chatRate
      emotes[index] = total / bucketMinutes
      if (point.providerCountsLowerBound === true) emotesLowerBound[index] = 1
      if (hasProviderSample(point, 'sevenTv')) {
        sevenTv[index] = point.seventv / bucketMinutes
        other[index] = Math.max(0, total - point.seventv) / bucketMinutes
      }
      if (!peakChat || chatRate > peakChat.value) peakChat = { value: chatRate, t: point.t, index }
      if (!peakEmotes || emotes[index]! > peakEmotes.value) peakEmotes = { value: emotes[index]!, t: point.t, index }
      latestIndex = index
    }
    if (viewerShown) {
      viewers[index] = point.viewers
      if (!peakViewers || point.viewers > peakViewers.value) {
        peakViewers = { value: point.viewers, t: point.t, index, live: finite(point.viewerContributors) ? point.viewerContributors : null }
      }
    }
    coverage[index] = gap || (!chatMeasured && !viewerShown) ? 2 : viewerShown && viewerState !== 'complete' ? 1 : 0
  }

  const activityCoverage = options.providerCoverage ?? null
  const pointLowerBound = (keys: readonly string[]) =>
    ordered.some((point) => keys.some((key) => coverageLowerBound(point.providerCoverage, key)))
  // As the bucket card (hubBucketCardModel): 7TV is a lower bound only when its
  // own coverage says so; "other" when the provider counts are lower bounds.
  const sevenTvLowerBound = coverageLowerBound(activityCoverage, 'seventv') || pointLowerBound(['seventv'])
  const otherLowerBound = anyCountsLowerBound

  let latest: HubSpLatest | null = null
  if (latestIndex >= 0) {
    const point = slots[latestIndex]!
    const v = viewers[latestIndex]!
    latest = {
      index: latestIndex,
      t: point.t,
      point,
      chat: chat[latestIndex]!,
      emotes: emotes[latestIndex]!,
      viewers: Number.isFinite(v) ? v : null,
      live: Number.isFinite(v) && finite(point.viewerContributors) ? point.viewerContributors : null,
      roster: Number.isFinite(v) && finite(point.viewerExpectedContributors) ? point.viewerExpectedContributors : null,
    }
  }

  let stamp: HubSpStamp | null = null
  if (peakChat) {
    const top = sortedTopEmotes(slots[peakChat.index])[0]
    if (top && top.count > 0) stamp = { index: peakChat.index, t: peakChat.t, emote: top }
  }

  return {
    data: { startMs, stepMs: bucketMs, chat, emotes, viewers, coverage },
    bucketMinutes,
    bucketMs,
    count,
    points: slots,
    sevenTv,
    other,
    sevenTvLowerBound,
    otherLowerBound,
    emotesLowerBound,
    peakChat,
    peakEmotes,
    peakViewers,
    latest,
    stamp,
  }
}

/** Top emotes over a bar's buckets (bucket totals summed by name), busiest first. */
export function barTopEmotes(model: HubActivitySpModel, fromIndex: number, toIndex: number, limit = 3): HubBucketEmote[] {
  const byName = new Map<string, HubBucketEmote>()
  for (let index = Math.max(0, fromIndex); index < Math.min(model.count, toIndex); index += 1) {
    for (const emote of sortedTopEmotes(model.points[index])) {
      const known = byName.get(emote.name)
      if (known) known.count += emote.count
      else byName.set(emote.name, { ...emote })
    }
  }
  return [...byName.values()].sort((a, b) => b.count - a.count).slice(0, limit)
}

/** True when any bucket of [fromIndex, toIndex) has an emote total that is only a minimum. */
export function emotesLowerBoundIn(model: HubActivitySpModel, fromIndex: number, toIndex: number): boolean {
  for (let index = Math.max(0, fromIndex); index < Math.min(model.count, toIndex); index += 1) {
    if (model.emotesLowerBound[index]) return true
  }
  return false
}

/** Viewer channels over a bar's measured buckets: the mean live count and the roster, or null. */
export function barViewerChannels(model: HubActivitySpModel, fromIndex: number, toIndex: number): { live: number; roster: number | null; members: number } | null {
  let sum = 0
  let members = 0
  let roster: number | null = null
  for (let index = Math.max(0, fromIndex); index < Math.min(model.count, toIndex); index += 1) {
    const point = model.points[index]
    if (!point || !Number.isFinite(model.data.viewers[index]!) || !finite(point.viewerContributors)) continue
    sum += point.viewerContributors
    members += 1
    if (roster == null && finite(point.viewerExpectedContributors)) roster = point.viewerExpectedContributors
  }
  return members ? { live: Math.round(sum / members), roster, members } : null
}
