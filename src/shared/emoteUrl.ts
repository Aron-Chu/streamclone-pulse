import { isBrokenLocalEmotePath, resolveEmoteImageUrl } from '@streamclone/pulse-core'
import type { ExtensionEmote } from './messages.ts'

const LEGACY_SEVEN_TV_ID = /^[0-9a-fA-F]{24}$/

function normalizeEmoteProvider(provider?: string): string | undefined {
  if (!provider) return undefined
  const lower = provider.trim().toLowerCase()
  if (lower === '7tv') return 'seventv'
  return lower
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

  if (raw && raw.startsWith('/') && !isBrokenLocalEmotePath(raw)) {
    if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
      return undefined
    }
    const base = backendUrl.replace(/\/+$/, '')
    return `${base}${raw}`
  }

  const resolved = resolveEmoteImageUrl({
    provider,
    id,
    imageUrl: raw,
    scale: '1x',
  }).trim()
  if (!resolved) return undefined

  if (resolved.startsWith('/')) {
    if (provider === 'seventv' && id && LEGACY_SEVEN_TV_ID.test(id)) {
      return `https://cdn.7tv.app/emote/${id}/4x.webp`
    }
    if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
      return undefined
    }
    const base = backendUrl.replace(/\/+$/, '')
    return `${base}${resolved}`
  }
  return resolved
}
