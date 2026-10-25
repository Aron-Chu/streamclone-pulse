export type EmoteProviderKind = 'seventv' | 'twitch' | 'ffz' | 'bttv' | 'unknown'

export function parseEmoteKey(key: string): { provider: EmoteProviderKind; id: string; name: string } {
  const parts = key.split(':')
  if (parts.length >= 3) {
    const provider = parts[0].toLowerCase()
    const normalized: EmoteProviderKind =
      provider === '7tv' ? 'seventv'
        : provider === 'seventv' || provider === 'twitch' || provider === 'ffz' || provider === 'bttv' ? provider : 'unknown'
    return { provider: normalized, id: parts[1], name: parts.slice(2).join(':') }
  }
  return { provider: 'unknown', id: '', name: key }
}

/**
 * Whether two emote keys name the same emote. Minute rollups key an emote as
 * "seventv:LOL:LOL" while summaries use "seventv:<id>:LOL", so ids may differ;
 * the name must match, and so must the provider (7TV and BTTV can both have a
 * "Clap"). A key without a provider matches on name alone.
 */
export function sameEmoteKey(a: string, b: string): boolean {
  if (a === b) return true
  const left = parseEmoteKey(a)
  const right = parseEmoteKey(b)
  const name = left.name.trim().toLowerCase()
  if (!name || name !== right.name.trim().toLowerCase()) return false
  return left.provider === 'unknown' || right.provider === 'unknown' || left.provider === right.provider
}
