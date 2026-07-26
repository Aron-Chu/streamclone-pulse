const TWITCH_CDN_TEMPLATE = 'https://static-cdn.jtvnw.net/emoticons/v2/%s/default/dark/2.0'
const SEVEN_TV_CDN_TEMPLATE = 'https://cdn.7tv.app/emote/%s/4x.webp'
const FFZ_CDN_TEMPLATE = 'https://cdn.frankerfacez.com/emoticon/%s/4'
const BTTV_CDN_TEMPLATE = 'https://cdn.betterttv.net/emote/%s/3x'

const LOCAL_EMOTE_ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const SEVEN_TV_EMOTE_ID = /^[0-9A-HJKMNP-TV-Z]{20,32}$/i

export const ALLOWED_EMOTE_IMAGE_HOSTS = Object.freeze([
  'cdn.7tv.app',
  'static-cdn.jtvnw.net',
  'cdn.frankerfacez.com',
  'cdn.betterttv.net',
  'api.streampulse.stream',
])

/** Allow only https emote CDN / hosted proxy URLs (or relative /emotes/ paths). */
export function isAllowedEmoteImageUrl(url: string | undefined, assetBase = ''): boolean {
  return sanitizeEmoteImageUrl(url, assetBase) !== undefined
}

/**
 * Return URL.href only after https + host allowlist validation for img src binding.
 */
export function sanitizeEmoteImageUrl(url: string | undefined, assetBase = ''): string | undefined {
  if (!url?.trim()) return undefined
  const trimmed = url.trim()
  try {
    const parsed = new URL(trimmed, assetBase || 'https://api.streampulse.stream')
    if (parsed.protocol !== 'https:') return undefined
    if (!ALLOWED_EMOTE_IMAGE_HOSTS.includes(parsed.hostname.toLowerCase())) return undefined
    return parsed.href
  } catch {
    return undefined
  }
}

export function localEmotePath(id: string, scale = '1x'): string {
  const resolvedScale = scale.trim() || '1x'
  return `/emotes/${id}/${resolvedScale}.webp`
}

export function isLocalEmoteUuid(id: string): boolean {
  return LOCAL_EMOTE_ID.test(id.trim())
}

export function isBrokenLocalEmotePath(url: string): boolean {
  const match = url.match(/^\/emotes\/([^/]+)\//)
  if (!match) return false
  return !isLocalEmoteUuid(match[1])
}

/** True when URL points at the Streamclone emote proxy (often 403 for unsynced UUIDs). */
export function isBackendEmoteProxyUrl(url: string | undefined, assetBase = ''): boolean {
  if (!url?.trim()) return false
  const trimmed = url.trim()
  if (trimmed.startsWith('/emotes/')) return true
  try {
    const parsed = new URL(trimmed, assetBase || 'https://api.streampulse.stream')
    return parsed.pathname.startsWith('/emotes/')
  } catch {
    return false
  }
}

/** Prefer a direct CDN URL; fall back when bucket rows only have proxy paths. */
export function preferResolvableEmoteUrl(
  direct: string | undefined,
  fallback: string | undefined,
  assetBase = '',
): string | undefined {
  const absDirect = direct?.trim() || undefined
  if (absDirect && !isBackendEmoteProxyUrl(absDirect, assetBase)) {
    const safe = sanitizeEmoteImageUrl(absDirect, assetBase)
    if (safe) return safe
  }
  const absFallback = fallback?.trim() || undefined
  if (absFallback && !isBackendEmoteProxyUrl(absFallback, assetBase)) {
    const safe = sanitizeEmoteImageUrl(absFallback, assetBase)
    if (safe) return safe
  }
  return (
    sanitizeEmoteImageUrl(absDirect, assetBase) ?? sanitizeEmoteImageUrl(absFallback, assetBase)
  )
}

export interface ResolveEmoteImageUrlOptions {
  provider?: string
  id?: string
  imageUrl?: string
  scale?: string
}

export function resolveEmoteImageUrl(opts: ResolveEmoteImageUrlOptions): string {
  const scale = opts.scale?.trim() || '1x'
  const id = opts.id?.trim() ?? ''
  const imageUrl = opts.imageUrl?.trim()

  if (imageUrl && !isBrokenLocalEmotePath(imageUrl) && !isBackendEmoteProxyUrl(imageUrl)) {
    return imageUrl
  }
  if (!id) {
    return imageUrl ?? ''
  }

  const provider = (opts.provider ?? '').trim().toLowerCase()

  switch (provider) {
    case 'twitch':
      return TWITCH_CDN_TEMPLATE.replace('%s', id)
    case 'seventv':
    case '7tv':
      if (isLocalEmoteUuid(id)) return localEmotePath(id, scale)
      return SEVEN_TV_EMOTE_ID.test(id) ? SEVEN_TV_CDN_TEMPLATE.replace('%s', id) : imageUrl ?? ''
    case 'ffz':
    case 'frankerfacez':
      return isLocalEmoteUuid(id) ? localEmotePath(id, scale) : FFZ_CDN_TEMPLATE.replace('%s', id)
    case 'bttv':
    case 'betterttv':
      return isLocalEmoteUuid(id) ? localEmotePath(id, scale) : BTTV_CDN_TEMPLATE.replace('%s', id)
    default:
      return localEmotePath(id, scale)
  }
}
