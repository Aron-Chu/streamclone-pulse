import {
  heatmapEmoteToRollupHit,
  normalizeMinuteBucket,
  topEmotesFromRollup,
  recapMomentAnalyticalOffset,
  type RollupEmoteHit,
} from '@streampulse/pulse-core'
import type {
  AnalyticsMinuteRollup,
  AnalyticsTopEmote,
  PulseRecapEmote,
  PulseRecapMoment,
} from '../apiTypes.ts'
import { viewerReadoutValue } from '@streampulse/pulse-charts'
import type { ReplayHeatmapPoint } from '../types/heatmap.ts'
import { minuteEmoteTotal } from '../components/analytics/chartRollupUtils.ts'
import { enrichRecapEmotesFromCatalog, resolveMomentEmotesForOffset } from './recapEmoteEnrich.ts'

export interface MomentRowStats {
  viewers: number | null
  chatPerMin: number | null
  emotesPerMin: number | null
}

export function recapEmoteToRollupHit(emote: PulseRecapEmote): RollupEmoteHit {
  const code = emote.code.trim()
  const provider = (emote.provider ?? 'unknown').trim().toLowerCase()
  const id = emote.id?.trim()
  const key = id ? `${provider}:${id}` : `${provider}:${code}`
  return {
    key,
    name: code,
    count: emote.count ?? 0,
    provider: emote.provider ?? provider,
    image_url: emote.imageUrl,
  }
}

export function recapEmotesToRollupHits(
  emotes: PulseRecapEmote[],
  catalog?: AnalyticsTopEmote[],
): RollupEmoteHit[] {
  return enrichRecapEmotesFromCatalog(emotes, catalog).map(recapEmoteToRollupHit)
}

/** Resolve only the exact analytical minute; never substitute a nearby minute. */
export function resolveMomentRowRollup(args: {
  moment?: PulseRecapMoment
  rollups?: AnalyticsMinuteRollup[]
  streamStartedAt?: string
}): AnalyticsMinuteRollup | null {
  const { moment, rollups, streamStartedAt } = args
  const start = streamStartedAt ? Date.parse(streamStartedAt) : NaN
  const exact = Number.isFinite(start) && moment && Number.isFinite(moment.offsetSeconds) && moment.offsetSeconds >= 0
    ? (rollups ?? []).filter(row => {
      const at = Date.parse(row.minuteTs)
      return Number.isFinite(at) && at >= Math.floor(start / 60_000) * 60_000
        && Math.max(0, Math.trunc((at - start) / 1000)) === recapMomentAnalyticalOffset(moment)
    }) : []
  return exact.length === 1 && !exact[0].missing ? exact[0] : null
}

/** Match the selected-minute inspector. A detection snapshot is fallback only. */
export function resolveMomentRowStats(args: {
  moment?: PulseRecapMoment
  rollups?: AnalyticsMinuteRollup[]
  streamStartedAt?: string
}): MomentRowStats {
  const { moment } = args
  const rollup = resolveMomentRowRollup(args)
  const measured = (value: number | undefined | null): number | null => value != null && Number.isFinite(value) && value >= 0 ? value : null
  const viewers = rollup ? measured(viewerReadoutValue(rollup)) : measured(moment?.viewerCount)
  const chatPerMin = rollup ? measured(rollup.chatCount) : measured(moment?.chatCount)
  // An absent emote map is not a measured zero. Explicit totals, including zero,
  // retain authority over fallback map values.
  const rollupEmotes = measured(rollup?.totalEmoteCount) ?? (rollup?.emotes ? measured(minuteEmoteTotal(rollup)) : null)
  const emotesPerMin = rollup ? rollupEmotes : measured(moment?.emoteCount)

  return { viewers, chatPerMin, emotesPerMin }
}

/** Rollup → heatmap point → recap topEmotes for display chips. */
export function resolveRollupDisplayEmotes(args: {
  rollup: AnalyticsMinuteRollup
  rollups?: AnalyticsMinuteRollup[]
  streamStartedAt?: string
  heatmapPoints?: ReplayHeatmapPoint[]
  recapMoment?: PulseRecapMoment | null
  topEmotesCatalog?: AnalyticsTopEmote[]
  limit?: number
}): RollupEmoteHit[] {
  const {
    rollup,
    rollups,
    streamStartedAt,
    heatmapPoints,
    recapMoment,
    topEmotesCatalog,
    limit = 3,
  } = args

  const fromRollup = topEmotesFromRollup(rollup, limit, topEmotesCatalog)
  if (fromRollup.length > 0) return fromRollup

  if (heatmapPoints?.length) {
    const bucket = normalizeMinuteBucket(rollup.minuteTs)
    const point = heatmapPoints.find(
      (entry) =>
        entry.minuteTs === rollup.minuteTs
        || normalizeMinuteBucket(entry.minuteTs) === bucket,
    )
    if (point?.topEmotes?.length) {
      const fromHeatmap = point.topEmotes
        .slice(0, limit)
        .map((emote) => heatmapEmoteToRollupHit(emote, topEmotesCatalog))
        .filter((emote): emote is RollupEmoteHit => Boolean(emote))
      if (fromHeatmap.length > 0) return fromHeatmap
    }
  }

  if (recapMoment?.topEmotes?.length) {
    return recapEmotesToRollupHits(recapMoment.topEmotes, topEmotesCatalog).slice(0, limit)
  }

  if (recapMoment && rollups?.length && streamStartedAt) {
    const fromOffset = resolveMomentEmotesForOffset({
      moment: recapMoment,
      rollups,
      streamStartedAt,
      heatmapPoints,
      topEmotesCatalog,
      limit,
    })
    if (fromOffset.length > 0) {
      return recapEmotesToRollupHits(fromOffset, topEmotesCatalog)
    }
  }

  return []
}

// ---- Session moment rows (d3-v2 session-original moment-rows.js, 2026-10-15) ----

/** The rows' offset: H:MM:SS, no leading zero on the hour ("0:50:54"). */
export function momentRowHms(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * Wall clock of a stream offset in the viewer's zone ("6:37 AM"), with the
 * weekday in front when it falls on another day than the stream's start.
 */
export function momentRowClock(startedAtIso: string | undefined, offsetSeconds: number): string | null {
  const start = startedAtIso ? Date.parse(startedAtIso) : NaN
  if (!Number.isFinite(start) || !Number.isFinite(offsetSeconds)) return null
  const at = start + offsetSeconds * 1000
  const clock = new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const otherDay = new Date(at).toDateString() !== new Date(start).toDateString()
  return otherDay ? `${new Date(at).toLocaleDateString([], { weekday: 'short' })} ${clock}` : clock
}

export type MomentRowSeries = 'emotes' | 'chat'

/** The row's series: chat for a chat spike, emotes otherwise (moment-rows.js `ser`). */
export function momentRowSeries(reasonCode: string | undefined | null): MomentRowSeries {
  return String(reasonCode ?? '').trim().toLowerCase() === 'chat_spike' ? 'chat' : 'emotes'
}

/** The reason pill reads as a label ("Viewer surge", not "viewer surge"); the words stay the backend's. */
export function momentRowReasonLabel(reasonLabel: string): string {
  const label = reasonLabel.trim()
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : label
}

/** The reason pill's dot colour (moment-rows.js `tone`). */
export function momentRowReasonTone(reasonLabel: string): 'emotes' | 'chat' | 'other' {
  return reasonLabel === 'Chat spike' ? 'chat' : reasonLabel === 'Emote spike' ? 'emotes' : 'other'
}

function measuredCount(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) && value >= 0 ? value : null
}

/** A minute's rate on the row's series; null when the minute did not measure it. */
export function momentRowRate(rollup: AnalyticsMinuteRollup | null | undefined, series: MomentRowSeries): number | null {
  if (!rollup || rollup.missing) return null
  if (series === 'chat') return measuredCount(rollup.chatCount)
  return measuredCount(rollup.totalEmoteCount) ?? (rollup.emotes ? measuredCount(minuteEmoteTotal(rollup)) : null)
}

/** A rollup's stream offset, the way resolveMomentRowRollup derives it; null before the start minute. */
export function momentRowRollupOffset(rollup: AnalyticsMinuteRollup, startMs: number): number | null {
  const at = Date.parse(rollup.minuteTs)
  if (!Number.isFinite(at) || !Number.isFinite(startMs) || at < Math.floor(startMs / 60_000) * 60_000) return null
  return Math.max(0, Math.trunc((at - startMs) / 1000))
}

export interface MomentRowSparkBar {
  /** 0-16: the minute's place in the ±8 min window. */
  slot: number
  value: number
  /** The minute that holds the moment. */
  at: boolean
}

/** Minutes either side of the moment in the row spark. */
export const MOMENT_ROW_SPARK_HALF_SECONDS = 480

/**
 * The row spark (moment-rows.js spikeSVG): the series' measured minutes 8 minutes
 * either side of the moment. Missing minutes are left out, never filled.
 */
export function momentRowSparkBars(args: {
  offsetSeconds: number
  rollups?: AnalyticsMinuteRollup[]
  streamStartedAt?: string
  series: MomentRowSeries
}): MomentRowSparkBar[] {
  const { offsetSeconds, rollups, streamStartedAt, series } = args
  const start = streamStartedAt ? Date.parse(streamStartedAt) : NaN
  if (!Number.isFinite(start) || !Number.isFinite(offsetSeconds) || !rollups?.length) return []
  const from = offsetSeconds - MOMENT_ROW_SPARK_HALF_SECONDS
  const to = offsetSeconds + MOMENT_ROW_SPARK_HALF_SECONDS
  const bars: MomentRowSparkBar[] = []
  const used = new Set<number>()
  for (const rollup of rollups) {
    if (rollup.missing) continue
    const offset = momentRowRollupOffset(rollup, start)
    if (offset == null || offset < from || offset > to) continue
    const value = momentRowRate(rollup, series)
    if (value == null) continue
    const slot = Math.round((offset - from) / 60)
    if (slot < 0 || slot > 16 || used.has(slot)) continue
    used.add(slot)
    bars.push({ slot, value, at: offsetSeconds >= offset && offsetSeconds < offset + 60 })
  }
  return bars.sort((a, b) => a.slot - b.slot)
}

/** Under this share of a minute's emote uses named, the row names no emote (card-model NAMED_MIN_PCT). */
export const MOMENT_ROW_NAMED_MIN_PCT = 25

/**
 * "emote names not captured": the measured minute names under 25 % of its
 * emote uses. Returns the row's title, or null when names are fine or unknown.
 */
export function momentRowNamesNotCaptured(rollup: AnalyticsMinuteRollup | null | undefined): string | null {
  const total = measuredCount(rollup?.totalEmoteCount)
  if (!rollup || !total || total <= 0) return null
  const named = Object.values(rollup.emotes ?? {}).reduce((sum, value) => sum + (Number.isFinite(value) && value > 0 ? value : 0), 0)
  const pct = (named / total) * 100
  if (pct >= MOMENT_ROW_NAMED_MIN_PCT) return null
  return `Names for ${pct < 1 ? '<1' : Math.round(pct)}% of ${Math.round(total).toLocaleString('en-US')} emote uses in this minute`
}

export interface MomentRowGameSegment {
  gameName: string
  boxArtUrl?: string
  categoryId?: string
  offsetSeconds: number
  durationSeconds: number
}

/** The game segment holding an offset (gameNameAtOffset's rule, the segment itself). */
export function momentRowGameAt<T extends MomentRowGameSegment>(games: T[] | null | undefined, offsetSeconds: number): T | null {
  if (!games?.length || !Number.isFinite(offsetSeconds)) return null
  for (const game of games) {
    if (!Number.isFinite(game.offsetSeconds) || !Number.isFinite(game.durationSeconds) || !game.gameName?.trim()) continue
    if (offsetSeconds >= game.offsetSeconds && offsetSeconds < game.offsetSeconds + Math.max(0, game.durationSeconds)) return game
  }
  const last = games[games.length - 1]
  return last && Number.isFinite(last.offsetSeconds) && offsetSeconds >= last.offsetSeconds && last.gameName?.trim() ? last : null
}

/** Whole numbers the way the rows print them ("1,536"). */
export function momentRowInt(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '—' : Math.round(value).toLocaleString('en-US')
}

/** Twitch's `time=` form for the embedded player ("1h2m3s"). */
export function momentRowTwitchTime(seconds: number): string {
  const x = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  const h = Math.floor(x / 3600)
  const m = Math.floor((x % 3600) / 60)
  const s = x % 60
  return `${h ? `${h}h` : ''}${h || m ? `${m}m` : ''}${s}s`
}
