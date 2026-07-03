import type { FigmaMomentRow } from './figmaSessionAnalytics'
import { activityBucketKey, activityBucketMs } from './hubActivitySummary'
import { absolutizeEmoteAssetUrl } from './emoteAssetUrl'
import type { HubEmote, HubLiveChannel } from './publicHub'

export type PulseMomentFilter = 'all' | 'chat' | 'emotes' | 'mixed' | 'synced'

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
    const providerKey = emoteLookupKey(emote.name, emote.provider)
    if (!map.has(providerKey)) map.set(providerKey, normalized)
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
  const resolvedUrl = absolutizeEmoteAssetUrl(imageUrl ?? hit?.imageUrl)
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
  if (isEmoteSpikeMoment(moment)) {
    return 'No emote rollups for this minute yet — spike detected from chat velocity, not emote counts.'
  }
  return 'Viewer/chat spike — no emote breakdown for this minute.'
}

export function momentContextParts(moment: FigmaMomentRow): string[] {
  const parts: string[] = []
  const source = sourceLabel(moment.source)
  parts.push(source)
  if (moment.confidence != null && Number.isFinite(moment.confidence)) {
    parts.push(`${Math.round(moment.confidence)}% conf`)
  }
  const vod = vodStateLabel(moment.vodState)
  if (vod !== '—' && vod.toLowerCase() !== source.toLowerCase()) {
    parts.push(vod)
  }
  return parts
}

function momentKind(moment: FigmaMomentRow): string {
  return (moment.kind ?? '').trim().toLowerCase()
}

export function filterPulseMoments(moments: FigmaMomentRow[], filter: PulseMomentFilter): FigmaMomentRow[] {
  if (filter === 'all') return moments
  return moments.filter((moment) => {
    const kind = momentKind(moment)
    const label = moment.label.toLowerCase()
    switch (filter) {
      case 'chat':
        return kind === 'chat' || kind === 'chat_spike' || label.includes('chat')
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
      default:
        return true
    }
  })
}

/** Resolve wall-clock peak time from backend `at` or channel stream start + offset. */
export function resolveMomentWallClockAt(
  moment: FigmaMomentRow,
  liveChannels: Array<Pick<HubLiveChannel, 'login' | 'startedAt'>>,
): number | undefined {
  if (moment.at != null && Number.isFinite(moment.at) && moment.at > 0) {
    return moment.at
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

export function vodStateLabel(vodState?: string): string {
  const value = (vodState ?? '').trim().toLowerCase()
  if (value === 'synced') return 'Synced'
  if (value === 'vod_ready') return 'VOD ready'
  if (value === 'partial') return 'Partial'
  if (value === 'live_only' || value === 'live' || value === 'no_vod') return 'Live IRC'
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
