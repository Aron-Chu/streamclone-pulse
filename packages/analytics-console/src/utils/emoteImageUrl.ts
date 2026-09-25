import { resolveEmoteAssetUrl } from '../configureApi.ts'

const TWITCH_CDN_TEMPLATE = 'https://static-cdn.jtvnw.net/emoticons/v2/%s/default/dark/2.0'
const SEVEN_TV_CDN_TEMPLATE = 'https://cdn.7tv.app/emote/%s/2x.webp'
const FFZ_CDN_TEMPLATE = 'https://cdn.frankerfacez.com/emoticon/%s/4'
const BTTV_CDN_TEMPLATE = 'https://cdn.betterttv.net/emote/%s/3x'

const LOCAL_EMOTE_ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const SEVEN_TV_EMOTE_ID = /^[0-9A-HJKMNP-TV-Z]{20,32}$/i

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

export interface EmoteDisplaySources {
  src: string
  srcSet?: string
}

const DISPLAY_SCALES: Array<{ host: string; path: RegExp; one: string; two: string }> = [
  { host: 'cdn.7tv.app', path: /^(\/emote\/[^/]+\/)(?:1x|2x|3x|4x)(\.(?:webp|avif|gif|png))$/i, one: '1x', two: '2x' },
  { host: 'static-cdn.jtvnw.net', path: /^(\/emoticons\/v[12]\/.+\/)(?:1\.0|2\.0|3\.0)()$/, one: '1.0', two: '2.0' },
  { host: 'cdn.frankerfacez.com', path: /^(\/emot(?:e|icon)\/[^/]+\/)(?:1|2|4)()$/, one: '1', two: '2' },
  { host: 'cdn.betterttv.net', path: /^(\/emote\/[^/]+\/)(?:1x|2x|3x)(\.webp)?$/, one: '1x', two: '2x' },
]

/**
 * Console emotes render at ≤ 24 CSS px, but payloads often carry the provider's
 * largest scale (a single animated 7TV 4x asset can exceed 1 MB). Request the
 * 1x asset with a 2x candidate for high-density screens.
 */
export function emoteDisplaySources(url: string): EmoteDisplaySources {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { src: url }
  }
  const rule = DISPLAY_SCALES.find(candidate => candidate.host === parsed.hostname.toLowerCase())
  const match = rule ? parsed.pathname.match(rule.path) : null
  if (!rule || !match) return { src: url }
  const withScale = (scale: string) => {
    const next = new URL(parsed.toString())
    next.pathname = `${match[1]}${scale}${match[2] ?? ''}`
    return next.toString()
  }
  const one = withScale(rule.one)
  return { src: one, srcSet: `${one} 1x, ${withScale(rule.two)} 2x` }
}

/** HTTPS emote CDNs and the hosted emote proxy the console may bind to an <img>. */
export const ALLOWED_CONSOLE_EMOTE_HOSTS = Object.freeze([
  'cdn.7tv.app',
  'static-cdn.jtvnw.net',
  'cdn.frankerfacez.com',
  'cdn.betterttv.net',
  'api.streampulse.stream',
])

/**
 * Return a URL's href only after https + host allowlist validation. Relative
 * `/emotes/` paths resolve against the configured asset base first. Bind this
 * return value, never the raw payload URL, to img src.
 */
export function sanitizeConsoleEmoteUrl(url: string | undefined): string | undefined {
  const trimmed = url?.trim()
  if (!trimmed) return undefined
  try {
    const parsed = new URL(resolveEmoteAssetUrl(trimmed))
    if (parsed.protocol !== 'https:') return undefined
    if (!ALLOWED_CONSOLE_EMOTE_HOSTS.includes(parsed.hostname.toLowerCase())) return undefined
    return parsed.href
  } catch {
    return undefined
  }
}

/**
 * Rebuild an `emoteDisplaySources` srcset (`<1x> 1x, <2x> 2x`) from sanitized
 * candidates only; refusing either candidate drops the srcset.
 */
export function sanitizeConsoleEmoteSrcSet(srcSet: string | undefined): string | undefined {
  if (!srcSet) return undefined
  const [one, two] = srcSet.split(',').map(candidate => candidate.trim().split(/\s+/)[0])
  const safeOne = sanitizeConsoleEmoteUrl(one)
  const safeTwo = sanitizeConsoleEmoteUrl(two)
  return safeOne && safeTwo ? `${safeOne} 1x, ${safeTwo} 2x` : undefined
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
  const safeImageUrl = imageUrl && !isBrokenLocalEmotePath(imageUrl) ? imageUrl : ''

  if (safeImageUrl && !isBackendEmoteProxyUrl(safeImageUrl)) {
    return safeImageUrl
  }
  if (!id) {
    return safeImageUrl
  }

  const provider = (opts.provider ?? '').trim().toLowerCase()

  switch (provider) {
    case 'twitch':
      return TWITCH_CDN_TEMPLATE.replace('%s', id)
    case 'seventv':
    case '7tv':
      if (isLocalEmoteUuid(id)) return localEmotePath(id, scale)
      return SEVEN_TV_EMOTE_ID.test(id) ? SEVEN_TV_CDN_TEMPLATE.replace('%s', id) : safeImageUrl
    case 'ffz':
    case 'frankerfacez':
      return isLocalEmoteUuid(id) ? localEmotePath(id, scale) : FFZ_CDN_TEMPLATE.replace('%s', id)
    case 'bttv':
    case 'betterttv':
      return isLocalEmoteUuid(id) ? localEmotePath(id, scale) : BTTV_CDN_TEMPLATE.replace('%s', id)
    default:
      return isLocalEmoteUuid(id) ? localEmotePath(id, scale) : safeImageUrl
  }
}
