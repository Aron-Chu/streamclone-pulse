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

export type InspectorMode = 'range' | 'preview' | 'selected' | 'moment'

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

/** Top live pool channels by chat/emote rate (range-mode inspector footer). */
export function resolveTopLiveStreamers(channels: HubLiveChannel[], limit = 5): BucketStreamerPeak[] {
  return [...channels]
    .filter((channel) => channel.login?.trim())
    .map((channel) => ({
      login: channel.login.trim().toLowerCase(),
      displayName: channel.displayName,
      profileImageUrl: channel.profileImageUrl,
      chatPerMin: channel.chatPerMin ?? 0,
      emotesPerMin: channel.emotesPerMin ?? 0,
      viewers: channel.viewers ?? 0,
    }))
    .sort((a, b) => {
      const peakA = Math.max(a.chatPerMin, a.emotesPerMin)
      const peakB = Math.max(b.chatPerMin, b.emotesPerMin)
      if (peakB !== peakA) return peakB - peakA
      if (b.viewers !== a.viewers) return b.viewers - a.viewers
      return b.chatPerMin + b.emotesPerMin - (a.chatPerMin + a.emotesPerMin)
    })
    .slice(0, limit)
    .map(({ viewers: _viewers, ...row }) => row)
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
