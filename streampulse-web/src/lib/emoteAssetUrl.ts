import { getBackendUrl } from './apiClient'

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
  if (absDirect && !isBackendEmoteProxyUrl(absDirect)) return absDirect
  const absFallback = absolutizeEmoteAssetUrl(fallback)
  if (absFallback && !isBackendEmoteProxyUrl(absFallback)) return absFallback
  return absDirect ?? absFallback
}
