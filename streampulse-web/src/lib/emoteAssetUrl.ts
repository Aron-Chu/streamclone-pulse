import { getBackendUrl } from './apiClient'

export type EmoteDisplayScale = '1x' | '2x' | '4x'

/** HTTPS CDN / hosted hosts permitted for <img src> emote rendering. */
export const ALLOWED_EMOTE_IMAGE_HOSTS = Object.freeze([
  'cdn.7tv.app',
  'static-cdn.jtvnw.net',
  'cdn.frankerfacez.com',
  'cdn.betterttv.net',
  'api.streampulse.stream',
])

/**
 * Allow only https emote CDN / hosted proxy URLs (or relative /emotes/ paths).
 * Strengthens img-src binding against javascript:/data: and arbitrary hosts.
 */
export function isAllowedEmoteImageUrl(url: string | undefined): boolean {
  return sanitizeEmoteImageUrl(url) !== undefined
}

/**
 * Return a URL.href only after https + host allowlist validation.
 * Callers must bind this return value (not the raw input) to img src.
 */
export function sanitizeEmoteImageUrl(url: string | undefined): string | undefined {
  if (!url?.trim()) return undefined
  const trimmed = url.trim()
  try {
    const parsed = trimmed.startsWith('/emotes/')
      ? new URL(trimmed, getBackendUrl())
      : new URL(trimmed, getBackendUrl())
    if (parsed.protocol !== 'https:') return undefined
    if (!ALLOWED_EMOTE_IMAGE_HOSTS.includes(parsed.hostname.toLowerCase())) return undefined
    return parsed.href
  } catch {
    return undefined
  }
}

/** Resolve backend-relative emote paths (`/emotes/{id}/1x.webp`) for img src. */
export function absolutizeEmoteAssetUrl(url: string | undefined): string | undefined {
  if (!url?.trim()) return url
  const trimmed = url.trim()
  if (/^(https?:|data:|blob:)/i.test(trimmed)) return trimmed
  if (trimmed.startsWith('/')) return `${getBackendUrl()}${trimmed}`
  return trimmed
}

/** True when URL points at the Streamclone emote proxy (often 404 for unsynced UUIDs). */
export function isBackendEmoteProxyUrl(url: string | undefined): boolean {
  if (!url?.trim()) return false
  const trimmed = url.trim()
  if (trimmed.startsWith('/emotes/')) return true
  try {
    const parsed = new URL(trimmed, getBackendUrl())
    return parsed.pathname.startsWith('/emotes/')
  } catch {
    return false
  }
}

/** Prefer a direct CDN URL; fall back to catalog when bucket rows only have proxy paths. */
export function preferResolvableEmoteUrl(
  direct: string | undefined,
  fallback: string | undefined,
): string | undefined {
  const absDirect = absolutizeEmoteAssetUrl(direct)
  if (absDirect && !isBackendEmoteProxyUrl(absDirect)) {
    const safe = sanitizeEmoteImageUrl(absDirect)
    if (safe) return safe
  }
  const absFallback = absolutizeEmoteAssetUrl(fallback)
  if (absFallback && !isBackendEmoteProxyUrl(absFallback)) {
    const safe = sanitizeEmoteImageUrl(absFallback)
    if (safe) return safe
  }
  return sanitizeEmoteImageUrl(absDirect) ?? sanitizeEmoteImageUrl(absFallback)
}

/**
 * Provider-aware scale swap for responsive emote delivery.
 * 7TV / hosted proxy: …/{1x|2x|4x}.webp
 * Twitch static CDN: …/{1.0|2.0|3.0}
 * FFZ: trailing /{1|2|4}
 */
export function emoteUrlForScale(url: string | undefined, scale: EmoteDisplayScale): string | undefined {
  const abs = absolutizeEmoteAssetUrl(url)
  if (!abs) return abs
  try {
    const u = new URL(abs)
    const host = u.hostname.toLowerCase()
    if (host === 'cdn.7tv.app' || u.pathname.startsWith('/emotes/')) {
      u.pathname = u.pathname.replace(/\/[124]x\.webp$/i, `/${scale}.webp`)
      return u.toString()
    }
    if (host === 'static-cdn.jtvnw.net') {
      const twScale = scale === '1x' ? '1.0' : scale === '2x' ? '2.0' : '3.0'
      u.pathname = u.pathname.replace(/\/(1\.0|2\.0|3\.0)$/i, `/${twScale}`)
      return u.toString()
    }
    if (host === 'cdn.frankerfacez.com') {
      const ffz = scale === '1x' ? '1' : scale === '2x' ? '2' : '4'
      u.pathname = u.pathname.replace(/\/[124]$/i, `/${ffz}`)
      return u.toString()
    }
  } catch {
    return abs
  }
  return abs
}

/** Build srcset for ordinary card/row sizes (prefer 1x/2x; include 4x for high-DPI). */
export function emoteSrcSet(url: string | undefined): string | undefined {
  const u1 = emoteUrlForScale(url, '1x')
  const u2 = emoteUrlForScale(url, '2x')
  const u4 = emoteUrlForScale(url, '4x')
  if (!u1 || !u2) return undefined
  if (u1 === u2 && u2 === u4) return undefined
  const parts = [`${u1} 1x`, `${u2} 2x`]
  if (u4 && u4 !== u2) parts.push(`${u4} 4x`)
  return parts.join(', ')
}

/** Default display URL for small cards/rows — 1x, not 4x. */
export function emoteDisplaySrc(url: string | undefined, cssPx = 28): string | undefined {
  const scaled =
    cssPx >= 64
      ? emoteUrlForScale(url, '4x') ?? absolutizeEmoteAssetUrl(url)
      : cssPx >= 40
        ? emoteUrlForScale(url, '2x') ?? absolutizeEmoteAssetUrl(url)
        : emoteUrlForScale(url, '1x') ?? absolutizeEmoteAssetUrl(url)
  return sanitizeEmoteImageUrl(scaled)
}
