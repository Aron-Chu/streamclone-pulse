import type { FigmaMomentRow } from '../../../lib/figmaSessionAnalytics'
import type { HubActivityPoint, HubEmote } from '../../../lib/publicHub'
import { withComputedSharePct, type HubEmoteWithShare } from '../../../lib/emoteShare'

export type InspectorMode = 'range' | 'preview' | 'selected'

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

export function bucketEmotesFromPoint(point: HubActivityPoint): HubEmote[] {
  if (!point.topEmotes?.length) return []
  return point.topEmotes.map((emote) => ({
    name: emote.name,
    provider: emote.provider,
    count: emote.count,
    sharePct: 0,
  }))
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
    ? dedupeInspectorEmotes(withComputedSharePct(bucketEmotesFromPoint(activePoint)))
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
