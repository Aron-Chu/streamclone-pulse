import type { FigmaMomentRow } from './figmaSessionAnalytics'
import { measurementTimeMs } from '@streampulse/pulse-core'
import { formatOffsetLabel } from './figmaSessionAnalytics'
import { activityBucketKey, activityBucketMs } from './hubActivitySummary'
import { absolutizeEmoteAssetUrl, preferResolvableEmoteUrl } from './emoteAssetUrl'
import type { HubEmote, HubLiveChannel } from './publicHub'
import {
  formatChatRate,
  formatMomentViewers,
  formatMomentViewersLabel,
} from './momentMetricLabels'

export type PulseMomentFilter = 'all' | 'chat' | 'emotes' | 'mixed' | 'synced' | 'stream_opening'

export const PULSE_MOMENT_FILTER_HINT = 'Filters narrow spike type, not data source.'

export const ROLLUP_CONFIDENCE_LABEL = 'Data conf.'
export const ROLLUP_CONFIDENCE_TITLE =
  'Confidence is backend rollup/data quality, not emote image availability.'

export const SCORE_EXPLANATION =
  'Score = weighted spike strength across chat, emotes, viewers, provider burst, dominance, and novelty.'

/** Network live peaks are a current snapshot — not a full activityWindow archive. */
export const LIVE_PULSE_RECENT_WINDOW_MS = 3 * 60 * 60 * 1000

export function isBucketWithinLiveHorizon(bucketT: number | undefined, nowMs = Date.now()): boolean {
  if (bucketT == null || !Number.isFinite(bucketT)) return true
  return bucketT >= nowMs - LIVE_PULSE_RECENT_WINDOW_MS
}

export interface ResolvedMomentEmote {
  id?: string
  name: string
  provider?: string
  count?: number
  imageUrl?: string
  imageUnavailable: boolean
}

export function emoteLookupKey(name: string, provider?: string): string {
  const n = name.trim().toLowerCase()
  const p = (provider ?? '').trim().toLowerCase()
  return p ? `${p}:${n}` : n
}

function providerAliasKeys(provider: string | undefined): string[] {
  const p = (provider ?? '').trim().toLowerCase()
  if (p === 'seventv' || p === '7tv') return ['seventv', '7tv']
  if (p === 'ffz' || p === 'frankerfacez') return ['ffz', 'frankerfacez']
  if (p === 'bttv' || p === 'betterttv') return ['bttv', 'betterttv']
  return p ? [p] : []
}

export function buildEmoteLookup(emotes: HubEmote[]): Map<string, HubEmote> {
  const map = new Map<string, HubEmote>()
  for (const emote of emotes) {
    const nameKey = emote.name.trim().toLowerCase()
    if (!nameKey) continue
    const normalized: HubEmote = {
      ...emote,
      imageUrl: absolutizeEmoteAssetUrl(emote.imageUrl),
    }
    if (!map.has(nameKey)) map.set(nameKey, normalized)
    for (const alias of providerAliasKeys(emote.provider)) {
      const providerKey = `${alias}:${nameKey}`
      if (!map.has(providerKey)) map.set(providerKey, normalized)
    }
  }
  return map
}

function resolveByName(
  name: string,
  provider: string | undefined,
  count: number | undefined,
  imageUrl: string | undefined,
  lookup: Map<string, HubEmote>,
  id?: string,
): ResolvedMomentEmote {
  const key = name.trim().toLowerCase()
  const hit = lookup.get(emoteLookupKey(name, provider)) ?? lookup.get(key)
  const resolvedUrl = preferResolvableEmoteUrl(imageUrl, hit?.imageUrl)
  return {
    id: id?.trim() || hit?.id?.trim() || undefined,
    name,
    provider: provider ?? hit?.provider,
    count: count ?? hit?.count,
    imageUrl: resolvedUrl,
    imageUnavailable: !resolvedUrl,
  }
}

export function momentEmoteTitle(emote: ResolvedMomentEmote): string {
  const parts = [emote.name]
  if (emote.provider) parts.push(emote.provider)
  if (emote.count != null) parts.push(`${emote.count} uses`)
  if (emote.imageUnavailable) {
    return `Image unavailable from backend · ${parts.join(' · ')}`
  }
  return parts.join(' · ')
}

export function resolveMomentEmote(
  moment: FigmaMomentRow,
  lookup: Map<string, HubEmote>,
): ResolvedMomentEmote | null {
  const fromRow = moment.topEmotes?.[0]
  if (fromRow?.name) {
    return resolveByName(
      fromRow.name,
      fromRow.provider,
      fromRow.count,
      fromRow.imageUrl,
      lookup,
      (fromRow as typeof fromRow & { id?: string }).id,
    )
  }
  const code = moment.topEmoteCode?.trim()
  if (!code) return null
  return resolveByName(code, undefined, undefined, undefined, lookup)
}

export function countIrcRollupChannels(
  liveChannels: Array<{ coverageState?: string }>,
): number {
  return liveChannels.filter((ch) => {
    const state = (ch.coverageState ?? '').trim().toLowerCase()
    return state === 'synced' || state === 'chat_only' || state === 'chat' || state === 'partial' || state === 'collecting' || state === 'warming'
  }).length
}

export function resolveBurstEmote(
  burst: { code: string; provider?: string; imageUrl?: string },
  lookup: Map<string, HubEmote>,
): { name: string; provider?: string; imageUrl?: string } {
  const key = burst.code.trim().toLowerCase()
  const hit = lookup.get(key)
  return {
    name: burst.code,
    provider: burst.provider ?? hit?.provider,
    imageUrl: absolutizeEmoteAssetUrl(burst.imageUrl ?? hit?.imageUrl),
  }
}

/** True when the backend attached per-minute emote rollups to this peak. */
export function momentHasEmoteRollups(moment: FigmaMomentRow): boolean {
  if (moment.topEmotes?.some((emote) => emote.name?.trim())) return true
  return Boolean(moment.topEmoteCode?.trim())
}

export function isEmoteSpikeMoment(moment: FigmaMomentRow): boolean {
  const kind = momentKind(moment)
  const label = moment.label.toLowerCase()
  return (
    kind === 'seventv' ||
    kind === 'emote' ||
    kind === 'emote_spike' ||
    label.includes('emote') ||
    label.includes('7tv')
  )
}

export function momentEmoteRollupsEmptyHint(moment: FigmaMomentRow): string {
  if (momentEmoteBreakdownUnavailable(moment)) {
    return 'Emote breakdown unavailable — backend has emote counts but no emote names for this minute.'
  }
  const tag = (moment.activityTag ?? '').trim().toLowerCase()
  const opening =
    momentKind(moment) === 'stream_opening' ||
    tag === 'early_stream' ||
    moment.label.toLowerCase().includes('just went live')
  if (opening) {
    return 'Opening minute — emote breakdown not ready yet.'
  }
  if (isEmoteSpikeMoment(moment)) {
    return 'No emote rollups for this minute yet — spike detected from chat velocity, not emote counts.'
  }
  return 'Viewer/chat spike — no emote breakdown for this minute.'
}

/** True when backend reports emote volume but no renderable emote identities. */
export function momentEmoteBreakdownUnavailable(moment: FigmaMomentRow): boolean {
  const rate = resolveMomentEmotesPerMin(moment)
  if (rate == null || rate <= 0) return false
  return !momentHasEmoteRollups(moment)
}

export function momentEmoteProviderLabel(provider?: string): string {
  const p = (provider ?? '').trim().toLowerCase()
  if (p === 'twitch') return 'Twitch'
  if (p === 'ffz' || p === 'frankerfacez') return 'FFZ'
  if (p === 'bttv' || p === 'betterttv') return 'BetterTTV'
  if (p === 'seventv' || p === '7tv') return '7TV'
  return provider?.trim() || 'Unknown'
}

export function momentEmoteExternalUrl(provider?: string, id?: string): string | null {
  const p = (provider ?? '').trim().toLowerCase()
  const providerID = (id ?? '').trim()
  const validID =
    (p === 'twitch' && /^\d{1,24}$/.test(providerID)) ||
    ((p === 'ffz' || p === 'frankerfacez') && /^\d{1,24}$/.test(providerID)) ||
    ((p === 'bttv' || p === 'betterttv') && /^[a-f0-9]{24}$/i.test(providerID)) ||
    ((p === 'seventv' || p === '7tv') && /^[a-z0-9_-]{20,64}$/i.test(providerID))
  if (!validID) return null
  const encodedID = encodeURIComponent(providerID)
  if (p === 'twitch') {
    return `https://www.twitch.tv/emotes/${encodedID}`
  }
  if (p === 'ffz' || p === 'frankerfacez') {
    return `https://www.frankerfacez.com/emoticon/${encodedID}`
  }
  if (p === 'bttv' || p === 'betterttv') {
    return `https://betterttv.com/emotes/${encodedID}`
  }
  if (p === 'seventv' || p === '7tv') return `https://7tv.app/emotes/${encodedID}`
  return null
}

export function momentContextParts(moment: FigmaMomentRow, channelLive?: boolean): string[] {
  const parts: string[] = []
  const source = sourceLabel(moment.source)
  parts.push(source)
  if (moment.confidence != null && Number.isFinite(moment.confidence)) {
    parts.push(`${Math.round(moment.confidence)}% conf`)
  }
  const vod = vodStateLabel(moment.vodState, channelLive)
  if (vod !== '—' && vod.toLowerCase() !== source.toLowerCase()) {
    parts.push(vod)
  }
  return parts
}

function momentActivityBadge(moment: FigmaMomentRow): string | null {
  const tag = (moment.activityTag ?? '').trim().toLowerCase()
  if ((moment.kind ?? '').trim().toLowerCase() === 'stream_opening') return 'Just went live'
  if (tag === 'early_stream') return 'Early stream'
  if (tag === 'late_stream') return 'Late stream'
  return null
}

export function momentWhatHappenedSummary(moment: FigmaMomentRow, category?: string): string {
  const parts: string[] = [moment.label.trim()]
  const chat = formatChatRate(moment.chatPerMin)
  if (chat !== '—') parts.push(chat)
  const top = moment.topEmotes?.[0]?.name ?? moment.topEmoteCode
  if (top) parts.push(top)
  const game = (category ?? moment.category)?.trim()
  if (game) parts.push(game)
  return parts.join(' · ')
}

function momentKind(moment: FigmaMomentRow): string {
  return (moment.kind ?? '').trim().toLowerCase()
}

export { momentActivityBadge }

export function filterPulseMoments(moments: FigmaMomentRow[], filter: PulseMomentFilter): FigmaMomentRow[] {
  if (filter === 'all') return moments
  return moments.filter((moment) => {
    const kind = momentKind(moment)
    const label = moment.label.toLowerCase()
    switch (filter) {
      case 'chat':
        // startsWith keeps "Chat spike"/"Chat velocity" but not labels that merely mention chat.
        return kind === 'chat' || kind === 'chat_spike' || label.startsWith('chat')
      case 'emotes':
        return (
          kind === 'seventv' ||
          kind === 'emote' ||
          kind === 'emote_spike' ||
          label.includes('emote') ||
          label.includes('7tv')
        )
      case 'mixed':
        return kind === 'mixed' || (label.includes('chat') && label.includes('emote'))
      case 'synced':
        return (moment.vodState ?? '').toLowerCase() === 'synced'
      case 'stream_opening':
        return (
          kind === 'stream_opening' ||
          (moment.activityTag ?? '').trim().toLowerCase() === 'early_stream' ||
          label.includes('just went live')
        )
      default:
        return true
    }
  })
}

/** Resolve wall-clock peak time from backend `at` or stream start + offset. */
export function resolveMomentWallClockAt(
  moment: FigmaMomentRow,
  liveChannels: Array<Pick<HubLiveChannel, 'login' | 'startedAt' | 'streamId'>>,
): number | undefined {
  if (moment.at != null) return measurementTimeMs(moment.at) ?? undefined
  if (
    moment.streamStartedAt != null &&
    measurementTimeMs(moment.streamStartedAt) != null &&
    moment.offsetSeconds != null &&
    Number.isFinite(moment.offsetSeconds)
  ) {
    return moment.offsetSeconds >= 0 ? measurementTimeMs(moment.streamStartedAt + moment.offsetSeconds * 1000) ?? undefined : undefined
  }
  const login = moment.login?.trim().toLowerCase()
  if (!login || moment.offsetSeconds == null || !Number.isFinite(moment.offsetSeconds)) {
    return undefined
  }
  if (!moment.streamId || moment.offsetSeconds < 0) return undefined
  const channel = liveChannels.find((ch) => ch.login.trim().toLowerCase() === login && ch.streamId === moment.streamId)
  const startedAt = channel?.startedAt?.trim()
  if (!startedAt) return undefined
  const startMs = measurementTimeMs(startedAt)
  if (startMs == null) return undefined
  return measurementTimeMs(startMs + moment.offsetSeconds * 1000) ?? undefined
}

/** Sum of backend top-emote counts for the selected minute (partial when API caps rows). */
export function momentTotalEmoteUses(moment: FigmaMomentRow): number | undefined {
  const rollups = moment.topEmotes?.filter((emote) => emote.count != null && Number.isFinite(emote.count)) ?? []
  if (rollups.length === 0) return undefined
  return rollups.reduce((sum, emote) => sum + (emote.count ?? 0), 0)
}

/** Total emote uses/min — prefers backend emotesPerMin, falls back to summed top-emote rows. */
export function resolveMomentEmotesPerMin(moment: FigmaMomentRow): number | undefined {
  if (moment.emotesPerMin != null && Number.isFinite(moment.emotesPerMin) && moment.emotesPerMin > 0) {
    return moment.emotesPerMin
  }
  return momentTotalEmoteUses(moment)
}

/** CCU at the spike minute — prefers backend viewers, falls back to live pool snapshot. */
export function resolveMomentViewers(
  moment: FigmaMomentRow,
  _liveChannels: Array<Pick<HubLiveChannel, 'login'> & { viewers?: number }> = [],
): number | undefined {
  if (moment.viewers != null && Number.isFinite(moment.viewers) && moment.viewers > 0) {
    return moment.viewers
  }
  return undefined
}

export function momentViewersTitle(
  moment: FigmaMomentRow,
  liveChannels: Array<Pick<HubLiveChannel, 'login'> & { viewers?: number }> = [],
): string {
  const resolved = resolveMomentViewers(moment, liveChannels)
  if (resolved == null) return 'Viewer count unavailable for this minute'
  const label = formatMomentViewers(resolved)
  if (moment.viewers != null && moment.viewers > 0) {
    return `${label} viewers at this minute`
  }
  return `${label} viewers at this minute`
}

export interface MomentViewerTableCell {
  text: string
  title: string
  muted?: boolean
}

/** Pulse Moments table: concurrent viewers at the spike minute (not viewer delta). */
export function resolveMomentViewerTableCell(
  moment: FigmaMomentRow,
  liveChannels: Array<Pick<HubLiveChannel, 'login'> & { viewers?: number }> = [],
): MomentViewerTableCell {
  const count = resolveMomentViewers(moment, liveChannels)
  if (count == null) {
    return {
      text: '—',
      title: 'Viewer count unavailable for this minute',
      muted: true,
    }
  }
  const fromMinute = moment.viewers != null && Number.isFinite(moment.viewers) && moment.viewers > 0
  return {
    text: formatMomentViewers(count),
    title: momentViewersTitle(moment, liveChannels),
    muted: !fromMinute,
  }
}

/** Wall-clock label for inspector header; falls back to stream offset when unknown. */
export function momentWallClockLabel(
  moment: FigmaMomentRow,
  liveChannels: Array<Pick<HubLiveChannel, 'login' | 'startedAt' | 'streamId'>> = [],
): { primary: string; secondary?: string } {
  const wallMs = resolveMomentWallClockAt(moment, liveChannels)
  if (wallMs != null) {
    const primary = new Date(wallMs).toLocaleString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    })
    return { primary, secondary: `${formatOffsetLabel(moment.offsetSeconds)} into stream` }
  }
  return { primary: formatOffsetLabel(moment.offsetSeconds) }
}

/** Wall-clock time for bucket-filtered tables; falls back to stream offset. */
export function formatMomentTableTime(
  moment: FigmaMomentRow,
  liveChannels: Array<Pick<HubLiveChannel, 'login' | 'startedAt' | 'streamId'>> = [],
): string {
  const wallMs = resolveMomentWallClockAt(moment, liveChannels)
  if (wallMs != null) {
    return new Date(wallMs).toLocaleString([], {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    })
  }
  return formatOffsetLabel(moment.offsetSeconds)
}

/** Keep moments whose wall-clock peak falls inside the selected activity bucket. */
export function filterMomentsByBucket(
  moments: FigmaMomentRow[],
  bucketT: number | undefined,
  windowMinutes: number,
  liveChannels: Array<Pick<HubLiveChannel, 'login' | 'startedAt' | 'streamId'>> = [],
): FigmaMomentRow[] {
  if (bucketT == null || !Number.isFinite(bucketT)) return moments
  const bucketStart = activityBucketKey(bucketT, windowMinutes)
  return moments.filter((moment) => {
    const at = resolveMomentWallClockAt(moment, liveChannels)
    if (at == null || !Number.isFinite(at)) return false
    return activityBucketKey(at, windowMinutes) === bucketStart
  })
}

export function momentsHaveWallClockAt(
  moments: FigmaMomentRow[],
  liveChannels: Array<Pick<HubLiveChannel, 'login' | 'startedAt' | 'streamId'>> = [],
): boolean {
  return moments.some((moment) => resolveMomentWallClockAt(moment, liveChannels) != null)
}

/** Match a moment's wall-clock time to the nearest hub activity chart bucket `t`. */
export function resolveMomentChartBucketT(
  moment: FigmaMomentRow,
  windowMinutes: number,
  liveChannels: Array<Pick<HubLiveChannel, 'login' | 'startedAt' | 'streamId'>>,
  activityPoints: Array<{ t: number }>,
): number | null {
  const wallMs = resolveMomentWallClockAt(moment, liveChannels)
  if (wallMs == null || !Number.isFinite(wallMs) || activityPoints.length === 0) return null
  const targetKey = activityBucketKey(wallMs, windowMinutes)
  let best: { t: number; delta: number } | null = null
  for (const point of activityPoints) {
    if (!Number.isFinite(point.t)) continue
    const pointKey = activityBucketKey(point.t, windowMinutes)
    if (pointKey !== targetKey) continue
    const delta = Math.abs(point.t - wallMs)
    if (!best || delta < best.delta) best = { t: point.t, delta }
  }
  if (best) return best.t
  let nearest: { t: number; delta: number } | null = null
  for (const point of activityPoints) {
    if (!Number.isFinite(point.t)) continue
    const delta = Math.abs(point.t - wallMs)
    if (!nearest || delta < nearest.delta) nearest = { t: point.t, delta }
  }
  return nearest?.t ?? null
}

export function scoreTone(score: number): 'high' | 'mid' | 'low' {
  if (score >= 90) return 'high'
  if (score >= 75) return 'mid'
  return 'low'
}

export function confidenceTone(confidence?: number): 'high' | 'mid' | 'low' {
  if (confidence == null) return 'low'
  if (confidence >= 90) return 'high'
  if (confidence >= 80) return 'mid'
  return 'low'
}

/**
 * `channelLive === false` means the channel is known to be offline — an ended
 * stream without an indexed VOD should not keep claiming "Live IRC".
 */
export function vodStateLabel(vodState?: string, channelLive?: boolean): string {
  const value = (vodState ?? '').trim().toLowerCase()
  if (value === 'synced') return 'Synced'
  if (value === 'vod_ready') return 'VOD ready'
  if (value === 'partial') return 'Partial'
  if (value === 'live_only' || value === 'live' || value === 'no_vod') {
    return channelLive === false ? 'IRC (VOD pending)' : 'Live IRC'
  }
  if (!value) return '—'
  return value.replace(/_/g, ' ')
}

export function sourceLabel(source?: string): string {
  const value = (source ?? '').trim().toLowerCase()
  if (value === 'corpus_historical') return 'Corpus historical'
  if (value === 'gql_gold') return 'Gold VOD corpus'
  if (value === 'vod_synced') return 'VOD synced'
  if (value === 'partial') return 'Partial IRC'
  if (value === 'live_irc') return 'Live IRC'
  if (!value) return 'Unknown source'
  return value.replace(/_/g, ' ')
}
