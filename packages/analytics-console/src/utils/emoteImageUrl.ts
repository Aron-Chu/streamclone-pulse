const TWITCH_CDN_TEMPLATE = 'https://static-cdn.jtvnw.net/emoticons/v2/%s/default/dark/2.0'
const SEVEN_TV_CDN_TEMPLATE = 'https://cdn.7tv.app/emote/%s/2x.webp'
const FFZ_CDN_TEMPLATE = 'https://cdn.frankerfacez.com/emoticon/%s/4'
const BTTV_CDN_TEMPLATE = 'https://cdn.betterttv.net/emote/%s/3x'

const LOCAL_EMOTE_ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const SEVEN_TV_EMOTE_ID = /^[0-9A-HJKMNP-TV-Z]{20,32}$/i
const PROVIDER_ASSET_ID = /^[A-Za-z0-9_-]{1,128}$/

export function preferSmallerSevenTVAsset(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.hostname.toLowerCase() !== 'cdn.7tv.app') return url
    parsed.pathname = parsed.pathname.replace(/\/(?:1x|3x|4x)\.(webp|avif)$/i, '/2x.$1')
    return parsed.toString()
  } catch {
    return url
  }
}

/**
 * Return an image source only after validating its scheme, host, and path.
 * Backend-relative emote paths remain relative so local consumers keep their
 * configured API origin; arbitrary protocols and third-party hosts are denied.
 */
export function safeConsoleEmoteImageUrl(url: string | undefined): string {
  const trimmed = url?.trim() ?? ''
  if (!trimmed) return ''

  try {
    const relative = trimmed.startsWith('/emotes/') && !trimmed.startsWith('//')
    const parsed = new URL(trimmed, 'https://api.streampulse.stream')
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return ''

    const host = parsed.hostname.toLowerCase()
    if (host === 'api.streampulse.stream') {
      const match = parsed.pathname.match(/^\/emotes\/([0-9a-fA-F-]{36})\/([124]x)\.webp$/)
      if (!match || !LOCAL_EMOTE_ID.test(match[1])) return ''
      const safePath = `/emotes/${encodeURIComponent(match[1])}/${match[2]}.webp`
      return relative ? safePath : `https://api.streampulse.stream${safePath}`
    }

    if (host === 'cdn.7tv.app') {
      const match = parsed.pathname.match(/^\/emote\/([A-Za-z0-9_-]{1,128})\/([124]x)\.(webp|avif)$/)
      if (!match || !PROVIDER_ASSET_ID.test(match[1])) return ''
      return `https://cdn.7tv.app/emote/${encodeURIComponent(match[1])}/${match[2]}.${match[3]}`
    }

    if (host === 'static-cdn.jtvnw.net') {
      const match = parsed.pathname.match(/^\/emoticons\/v2\/([A-Za-z0-9_-]{1,128})\/default\/dark\/(1\.0|2\.0|3\.0)$/)
      if (!match || !PROVIDER_ASSET_ID.test(match[1])) return ''
      return `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(match[1])}/default/dark/${match[2]}`
    }

    if (host === 'cdn.frankerfacez.com') {
      const match = parsed.pathname.match(/^\/(emote|emoticon)\/([A-Za-z0-9_-]{1,128})\/([124])$/)
      if (!match || !PROVIDER_ASSET_ID.test(match[2])) return ''
      return `https://cdn.frankerfacez.com/${match[1]}/${encodeURIComponent(match[2])}/${match[3]}`
    }

    if (host === 'cdn.betterttv.net') {
      const match = parsed.pathname.match(/^\/emote\/([A-Za-z0-9_-]{1,128})\/([123]x)$/)
      if (!match || !PROVIDER_ASSET_ID.test(match[1])) return ''
      return `https://cdn.betterttv.net/emote/${encodeURIComponent(match[1])}/${match[2]}`
    }

    return ''
  } catch {
    return ''
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
  if (absDirect && !isBackendEmoteProxyUrl(absDirect, assetBase)) return absDirect
  const absFallback = fallback?.trim() || undefined
  if (absFallback && !isBackendEmoteProxyUrl(absFallback, assetBase)) return absFallback
  return absDirect ?? absFallback
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
      // Unknown legacy keys often carry the display name in the ID slot.
      // Never turn that into a fabricated backend UUID request.
      return isLocalEmoteUuid(id) ? localEmotePath(id, scale) : imageUrl ?? ''
  }
}
