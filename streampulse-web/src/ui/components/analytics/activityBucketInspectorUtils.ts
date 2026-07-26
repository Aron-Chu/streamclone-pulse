import type { FigmaMomentRow } from '../../../lib/figmaSessionAnalytics'
import type {
  HubActivityPoint,
  HubEmote,
  HubEmoteIntel,
  HubLiveChannel,
} from '../../../lib/publicHub'
import { absolutizeEmoteAssetUrl, preferResolvableEmoteUrl } from '../../../lib/emoteAssetUrl'
import { buildEmoteLookup } from '../../../lib/pulseMomentsUtils'
import { withComputedSharePct, type HubEmoteWithShare } from '../../../lib/emoteShare'
import { compact } from './hubFormat'

export type InspectorMode = 'range' | 'preview' | 'selected'

export interface InspectorRangeStats {
  stat1Label: string
  stat1Value: string
  stat2Label: string
  stat2Value: string
  stat3Label: string
  stat3Value: string
  headMetaExtra?: string | null
}

const EMPTY_RANGE_STATS: InspectorRangeStats = {
  stat1Label: 'Unique emotes',
  stat1Value: '—',
  stat2Label: 'Avg emotes/min',
  stat2Value: '—',
  stat3Label: 'Top emote share',
  stat3Value: '—',
  headMetaExtra: null,
}

/** 24h window emote-economy KPIs for the inspector when no chart bucket is selected. */
export function resolveInspectorRangeStats(
  intel: HubEmoteIntel | undefined,
  topEmoteName?: string,
): InspectorRangeStats {
  if (!intel) return EMPTY_RANGE_STATS

  const uniqueEmotes = intel.uniqueEmotes > 0 ? compact(intel.uniqueEmotes) : '—'
  const avgEmotesPerMin = intel.emotesPerMin > 0 ? `${compact(intel.emotesPerMin)}/m` : '—'
  const topShare = intel.topEmoteSharePct > 0 ? `${intel.topEmoteSharePct.toFixed(1)}%` : '—'

  const trimmedName = topEmoteName?.trim()
  const headMetaExtra =
    trimmedName && intel.topEmoteSharePct > 0 ? `${trimmedName} leads` : null

  return {
    stat1Label: 'Unique emotes',
    stat1Value: uniqueEmotes,
    stat2Label: 'Avg emotes/min',
    stat2Value: avgEmotesPerMin,
    stat3Label: 'Top emote share',
    stat3Value: topShare,
    headMetaExtra,
  }
}

export interface BucketStreamerPeak {
  login: string
  displayName?: string
  profileImageUrl?: string
  chatPerMin: number
  emotesPerMin: number
}

/** Shared activity comparator — Hottest live rail and inspector footer must stay aligned. */
export function compareLiveChannelsByActivity(a: HubLiveChannel, b: HubLiveChannel): number {
  const chatA = a.chatPerMin ?? 0
  const emotesA = a.emotesPerMin ?? 0
  const chatB = b.chatPerMin ?? 0
  const emotesB = b.emotesPerMin ?? 0
  const peakA = Math.max(chatA, emotesA)
  const peakB = Math.max(chatB, emotesB)
  if (peakB !== peakA) return peakB - peakA
  const viewersA = a.viewers ?? 0
  const viewersB = b.viewers ?? 0
  if (viewersB !== viewersA) return viewersB - viewersA
  return chatB + emotesB - (chatA + emotesA)
}

/** Full live-channel rows ranked by chat/emote activity (not raw viewers). */
export function rankLiveChannelsByActivity(
  channels: HubLiveChannel[],
  limit?: number,
): HubLiveChannel[] {
  const sorted = [...channels]
    .filter((channel) => channel.login?.trim())
    .sort(compareLiveChannelsByActivity)
  return limit != null ? sorted.slice(0, limit) : sorted
}

/** Display-only reason label — not a Pulse score. */
export function hottestLiveReason(channel: HubLiveChannel): string {
  const chat = channel.chatPerMin ?? 0
  const emotes = channel.emotesPerMin ?? 0
  if (emotes >= chat && emotes > 0) return 'emote-led'
  if (chat > 0) return 'chat-led'
  if ((channel.viewers ?? 0) > 0) return 'viewer-led'
  return 'quiet'
}

/** Top live pool channels by chat/emote rate (range-mode inspector footer). */
export function resolveTopLiveStreamers(channels: HubLiveChannel[], limit = 5): BucketStreamerPeak[] {
  return rankLiveChannelsByActivity(channels, limit).map((channel) => ({
    login: channel.login.trim().toLowerCase(),
    displayName: channel.displayName,
    profileImageUrl: channel.profileImageUrl,
    chatPerMin: channel.chatPerMin ?? 0,
    emotesPerMin: channel.emotesPerMin ?? 0,
  }))
}

export function aggregateEmotesFromMoments(moments: FigmaMomentRow[], max = 10): HubEmote[] {
  const totals = new Map<string, HubEmote>()
  for (const moment of moments) {
    for (const emote of moment.topEmotes ?? []) {
      const name = emote.name?.trim()
      const count = emote.count ?? 0
      if (!name || count <= 0) continue
      const provider = emote.provider?.trim() || undefined
      const key = `${(provider ?? 'emote').toLowerCase()}:${name.toLowerCase()}`
      const existing = totals.get(key)
      if (existing) {
        existing.count += count
        if (!existing.imageUrl && emote.imageUrl) existing.imageUrl = emote.imageUrl
      } else {
        totals.set(key, {
          name,
          provider,
          count,
          sharePct: 0,
          imageUrl: emote.imageUrl,
        })
      }
    }
  }
  return [...totals.values()].sort((a, b) => b.count - a.count).slice(0, max)
}

function enrichBucketEmotesFromRange(bucketEmotes: HubEmote[], rangeEmotes: HubEmote[]): HubEmote[] {
  if (bucketEmotes.length === 0) return bucketEmotes
  const lookup = buildEmoteLookup(rangeEmotes)
  return bucketEmotes.map((emote) => {
    const nameKey = emote.name.trim().toLowerCase()
    const providerKey = `${(emote.provider ?? '').trim().toLowerCase()}:${nameKey}`
    const hit = lookup.get(providerKey) ?? lookup.get(nameKey)
    const imageUrl = preferResolvableEmoteUrl(emote.imageUrl, hit?.imageUrl)
    return {
      ...emote,
      imageUrl,
      provider: emote.provider ?? hit?.provider,
    }
  })
}

export function bucketEmotesFromPoint(point: HubActivityPoint, rangeEmotes: HubEmote[] = []): HubEmote[] {
  if (!point.topEmotes?.length) return []
  const bucketEmotes = point.topEmotes.map((emote) => ({
    name: emote.name,
    provider: emote.provider,
    count: emote.count,
    sharePct: 0,
    imageUrl: absolutizeEmoteAssetUrl(emote.imageUrl),
  }))
  return enrichBucketEmotesFromRange(bucketEmotes, rangeEmotes)
}

export function dedupeInspectorEmotes(emotes: HubEmoteWithShare[]): HubEmoteWithShare[] {
  const seen = new Set<string>()
  return emotes.filter((emote) => {
    const key = `${emote.provider ?? 'emote'}-${emote.name.toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Stable key for memoizing emote list renders. */
export function inspectorEmoteListSignature(emotes: HubEmoteWithShare[]): string {
  return emotes.map((e) => `${e.provider ?? ''}:${e.name}:${e.count}`).join('|')
}

export function resolveInspectorTableEmotes(
  mode: InspectorMode,
  activePoint: HubActivityPoint | null,
  rangeEmotes: HubEmote[],
  momentFallback: HubEmote[] = [],
): HubEmoteWithShare[] {
  const bucketHasEmotes = (activePoint?.topEmotes?.length ?? 0) > 0
  const showBucketEmoteList =
    (mode === 'selected' || mode === 'preview') && bucketHasEmotes && activePoint != null

  const rangeDeduped = dedupeInspectorEmotes(withComputedSharePct(rangeEmotes))
  const bucketDeduped = showBucketEmoteList
    ? dedupeInspectorEmotes(withComputedSharePct(bucketEmotesFromPoint(activePoint, rangeEmotes)))
    : []

  if (mode === 'selected' || mode === 'preview') {
    if (bucketDeduped.length > 0) return bucketDeduped
    if (momentFallback.length > 0) {
      return dedupeInspectorEmotes(withComputedSharePct(momentFallback))
    }
    return []
  }
  return rangeDeduped
}
