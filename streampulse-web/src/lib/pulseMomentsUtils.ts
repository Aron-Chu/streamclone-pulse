import type { FigmaMomentRow } from './figmaSessionAnalytics'
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

export type PulseMomentSortKey = 'newest' | 'oldest' | 'strongest'

/**
 * Sort moments by the chosen key.
 * - newest: wall-clock `at` descending, score descending, offset descending, stable backend order
 * - oldest: wall-clock `at` ascending, score descending, offset ascending, stable backend order
 * - strongest: backend score descending, wall-clock descending, offset descending, stable backend order
 * Undated moments go after timestamped moments in both newest and oldest modes,
 * preserving backend order among ties. Does not fabricate timestamps.
 */
export function sortPulseMoments(moments: FigmaMomentRow[], sortKey: PulseMomentSortKey): FigmaMomentRow[] {
  const withIndex = moments.map((m, i) => ({ m, i }))
  withIndex.sort((a, b) => {
    const aAt = a.m.at != null && Number.isFinite(a.m.at) && a.m.at > 0 ? a.m.at : null
    const bAt = b.m.at != null && Number.isFinite(b.m.at) && b.m.at > 0 ? b.m.at : null
    const aScore = a.m.score != null && Number.isFinite(a.m.score) ? a.m.score : null
    const bScore = b.m.score != null && Number.isFinite(b.m.score) ? b.m.score : null
    const aOffset = a.m.offsetSeconds != null && Number.isFinite(a.m.offsetSeconds) ? a.m.offsetSeconds : null
    const bOffset = b.m.offsetSeconds != null && Number.isFinite(b.m.offsetSeconds) ? b.m.offsetSeconds : null

    switch (sortKey) {
      case 'newest': {
        if (aAt !== bAt) {
          if (aAt === null) return 1
          if (bAt === null) return -1
          return bAt - aAt
        }
        if (aScore !== bScore) return (bScore ?? 0) - (aScore ?? 0)
        if (aOffset !== bOffset) return (bOffset ?? 0) - (aOffset ?? 0)
        return a.i - b.i
      }
      case 'oldest': {
        if (aAt !== bAt) {
          if (aAt === null) return 1
          if (bAt === null) return -1
          return aAt - bAt
        }
        if (aScore !== bScore) return (bScore ?? 0) - (aScore ?? 0)
        if (aOffset !== bOffset) return (aOffset ?? 0) - (bOffset ?? 0)
        return a.i - b.i
      }
      case 'strongest': {
        if (aScore !== bScore) return (bScore ?? 0) - (aScore ?? 0)
        if (aAt !== bAt) {
          if (aAt === null) return 1
          if (bAt === null) return -1
          return bAt - aAt
        }
        if (aOffset !== bOffset) return (bOffset ?? 0) - (aOffset ?? 0)
        return a.i - b.i
      }
    }
  })
  return withIndex.map(({ m }) => m)
}

/** Build channel filter options from the complete loaded snapshot. */
export function buildChannelFilterOptions(
  moments: FigmaMomentRow[],
): Array<{ login: string; displayName: string }> {
  const seen = new Map<string, { login: string; displayName: string }>()
  for (const m of moments) {
    const key = m.login?.trim().toLowerCase()
    if (!key) continue
    if (seen.has(key)) continue
    seen.set(key, {
      login: key,
      displayName: m.displayName ?? m.login ?? key,
    })
  }
  return [...seen.values()]
}

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
): ResolvedMomentEmote {
  const key = name.trim().toLowerCase()
  const hit = lookup.get(emoteLookupKey(name, provider)) ?? lookup.get(key)
  const resolvedUrl = preferResolvableEmoteUrl(imageUrl, hit?.imageUrl)
  return {
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
    return resolveByName(fromRow.name, fromRow.provider, fromRow.count, fromRow.imageUrl, lookup)
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
  return provider?.trim() || '7TV'
}

export function momentEmoteExternalUrl(name: string, provider?: string): string {
  const trimmed = name.trim()
  const q = encodeURIComponent(trimmed)
  const p = (provider ?? '').trim().toLowerCase()
  if (p === 'twitch') {
    return `https://www.twitch.tv/emotes?query=${q}`
  }
  if (p === 'ffz' || p === 'frankerfacez') {
    return `https://www.frankerfacez.com/emoticons?q=${q}`
  }
  if (p === 'bttv' || p === 'betterttv') {
    return `https://betterttv.com/emotes/${q}`
  }
  return `https://7tv.app/emotes?query=${q}`
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
  liveChannels: Array<Pick<HubLiveChannel, 'login' | 'startedAt'>>,
): number | undefined {
  if (moment.at != null && Number.isFinite(moment.at) && moment.at > 0) {
    return moment.at
  }
  if (
    moment.streamStartedAt != null &&
    Number.isFinite(moment.streamStartedAt) &&
    moment.streamStartedAt > 0 &&
    moment.offsetSeconds != null &&
    Number.isFinite(moment.offsetSeconds)
  ) {
    return moment.streamStartedAt + moment.offsetSeconds * 1000
  }
  const login = moment.login?.trim().toLowerCase()
  if (!login || moment.offsetSeconds == null || !Number.isFinite(moment.offsetSeconds)) {
    return undefined
  }
  const channel = liveChannels.find((ch) => ch.login.trim().toLowerCase() === login)
  const startedAt = channel?.startedAt?.trim()
  if (!startedAt) return undefined
  const startMs = Date.parse(startedAt)
  if (!Number.isFinite(startMs)) return undefined
  return startMs + moment.offsetSeconds * 1000
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
  liveChannels: Array<Pick<HubLiveChannel, 'login'> & { viewers?: number }> = [],
): number | undefined {
  if (moment.viewers != null && Number.isFinite(moment.viewers) && moment.viewers > 0) {
    return moment.viewers
  }
  const login = moment.login?.trim().toLowerCase()
  if (!login) return undefined
  const channel = liveChannels.find((ch) => ch.login.trim().toLowerCase() === login)
  if (channel?.viewers != null && channel.viewers > 0) return channel.viewers
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
  return `${label} viewers (live pool snapshot — minute rollup unavailable)`
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
  liveChannels: Array<Pick<HubLiveChannel, 'login' | 'startedAt'>> = [],
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
  liveChannels: Array<Pick<HubLiveChannel, 'login' | 'startedAt'>> = [],
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
  liveChannels: Array<Pick<HubLiveChannel, 'login' | 'startedAt'>> = [],
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
  liveChannels: Array<Pick<HubLiveChannel, 'login' | 'startedAt'>> = [],
): boolean {
  return moments.some((moment) => resolveMomentWallClockAt(moment, liveChannels) != null)
}

/** Match a moment's wall-clock time to the nearest hub activity chart bucket `t`. */
export function resolveMomentChartBucketT(
  moment: FigmaMomentRow,
  windowMinutes: number,
  liveChannels: Array<Pick<HubLiveChannel, 'login' | 'startedAt'>>,
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
