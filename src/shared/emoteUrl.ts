import { isBrokenLocalEmotePath, resolveEmoteImageUrl } from '@streampulse/pulse-core'
import type { ExtensionEmote } from './messages.ts'

const LEGACY_SEVEN_TV_ID = /^[0-9a-fA-F]{24}$/

function normalizeEmoteProvider(provider?: string): string | undefined {
  if (!provider) return undefined
  const lower = provider.trim().toLowerCase()
  if (lower === '7tv') return 'seventv'
  return lower
}

function backendProxyUrl(path: string, backendUrl: string): string {
  const base = backendUrl.replace(/\/+$/, '')
  return `${base}${path}`
}

function sevenTvCdnUrl(id: string): string {
  return `https://cdn.7tv.app/emote/${id}/4x.webp`
}

/** Resolve BFF emote metadata to a URL the extension can load (absolute CDN or backend proxy). */
export function extensionEmoteImageUrl(
  emote: Pick<ExtensionEmote, 'id' | 'imageUrl' | 'provider'>,
  backendUrl: string,
): string | undefined {
  const provider = normalizeEmoteProvider(emote.provider)
  const id = emote.id?.trim() ?? ''
  const raw = emote.imageUrl?.trim()

  if (raw && /^https?:\/\//i.test(raw)) {
    return raw
  }

  if (provider === 'seventv' && id && LEGACY_SEVEN_TV_ID.test(id)) {
    return sevenTvCdnUrl(id)
  }

  if (raw && raw.startsWith('/') && !isBrokenLocalEmotePath(raw)) {
    return backendProxyUrl(raw, backendUrl)
  }

  const resolved = resolveEmoteImageUrl({
    provider,
    id,
    imageUrl: raw,
    scale: '1x',
  }).trim()
  if (!resolved) return undefined

  if (resolved.startsWith('/')) {
    return backendProxyUrl(resolved, backendUrl)
  }
  return resolved
}
