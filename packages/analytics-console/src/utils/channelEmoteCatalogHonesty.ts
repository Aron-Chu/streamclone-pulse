/**
 * Channel 30-day emote catalog honesty helpers.
 * Partial/low-confidence empty catalogs must never render as authoritative zero usage.
 */

export type ChannelEmoteCatalogHonesty =
  | 'ready'
  | 'degraded'
  | 'unavailable'
  | 'unknown'

export function resolveChannelEmoteCatalogHonesty(input: {
  partial?: boolean
  lowConfidence?: boolean
  totalEmoteUses?: number
  topEmotes?: unknown[]
  providerState?: string
}): ChannelEmoteCatalogHonesty {
  const tops = Array.isArray(input.topEmotes) ? input.topEmotes.length : 0
  const uses = Number(input.totalEmoteUses ?? 0)
  const partial = input.partial === true
  const low = input.lowConfidence === true
  const provider = (input.providerState ?? '').toLowerCase()

  if (partial && low && tops === 0 && uses <= 0) {
    return 'unavailable'
  }
  if (partial || low || provider === 'unknown' || provider === 'stale') {
    return 'degraded'
  }
  if (tops > 0 || uses > 0) {
    return 'ready'
  }
  return 'unknown'
}

export function channelEmoteCatalogLabel(honesty: ChannelEmoteCatalogHonesty): string {
  switch (honesty) {
    case 'unavailable':
      return 'Emote catalog unavailable'
    case 'degraded':
      return 'Emote catalog partial'
    case 'ready':
      return 'Emote catalog ready'
    default:
      return 'Emote catalog unknown'
  }
}
