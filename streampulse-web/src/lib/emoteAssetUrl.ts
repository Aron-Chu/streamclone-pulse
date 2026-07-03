import { getBackendUrl } from './apiClient'

/** Resolve backend-relative emote paths (`/emotes/{id}/1x.webp`) for img src. */
export function absolutizeEmoteAssetUrl(url: string | undefined): string | undefined {
  if (!url?.trim()) return url
  const trimmed = url.trim()
  if (/^(https?:|data:|blob:)/i.test(trimmed)) return trimmed
  if (trimmed.startsWith('/')) return `${getBackendUrl()}${trimmed}`
  return trimmed
}
