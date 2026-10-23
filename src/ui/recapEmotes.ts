import type { ExtensionEmote, PulsePayload, PulseRecapEmote } from '../shared/messages.ts'
import { pickRecapRollups } from './recapMomentMetrics.ts'

export function recapEmoteToExtensionEmote(emote: PulseRecapEmote): ExtensionEmote {
  return {
    id: emote.id,
    name: emote.code,
    imageUrl: emote.imageUrl,
    count: emote.count,
    provider: emote.provider,
  }
}

function catalogKey(name: string): string {
  return name.trim().toLowerCase()
}

/** Prefer backend id/imageUrl; fall back to case-insensitive join against payload.topEmotes. */
export function resolveRecapEmotes(
  recapEmotes: PulseRecapEmote[],
  catalog?: ExtensionEmote[],
): ExtensionEmote[] {
  const catalogByName = new Map<string, ExtensionEmote>()
  for (const entry of catalog ?? []) {
    const key = catalogKey(entry.name)
    if (key && !catalogByName.has(key)) {
      catalogByName.set(key, entry)
    }
  }

  return recapEmotes.map(emote => {
    const base = recapEmoteToExtensionEmote(emote)
    if (base.imageUrl || base.id) return base
    const fallback = catalogByName.get(catalogKey(emote.code))
    if (!fallback) return base
    return {
      ...base,
      id: base.id ?? fallback.id,
      imageUrl: base.imageUrl ?? fallback.imageUrl,
      provider: base.provider ?? fallback.provider,
      zeroWidth: fallback.zeroWidth,
      animated: fallback.animated,
    }
  })
}

/** Merge payload + rollup emotes for recap moment image fallback. */
export function buildRecapEmoteCatalog(payload: PulsePayload): ExtensionEmote[] {
  const byKey = new Map<string, ExtensionEmote>()
  const add = (emote: ExtensionEmote | undefined) => {
    if (!emote?.name?.trim()) return
    const key = catalogKey(emote.name)
    const existing = byKey.get(key)
    if (!existing || (!existing.imageUrl && emote.imageUrl) || (!existing.id && emote.id)) {
      byKey.set(key, emote)
    }
  }
  for (const emote of payload.topEmotes ?? []) add(emote)
  for (const rollup of pickRecapRollups(payload)) {
    for (const emote of rollup.topEmotes ?? []) add(emote)
  }
  for (const peak of payload.peaks ?? []) {
    for (const emote of peak.topEmotes ?? []) add(emote)
  }
  const recap = payload.recap
  if (recap) {
    for (const emote of recap.topEmotes ?? []) add(recapEmoteToExtensionEmote(emote))
    for (const moment of recap.topMoments ?? []) {
      for (const emote of moment.topEmotes ?? []) add(recapEmoteToExtensionEmote(emote))
    }
  }
  return [...byKey.values()]
}
