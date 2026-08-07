import { isBrokenLocalEmotePath, resolveEmoteImageUrl } from '@streampulse/pulse-core'
import type { ExtensionEmote } from './messages.ts'

const LEGACY_SEVEN_TV_ID = /^[0-9a-fA-F]{24}$/
const SEVEN_TV_ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/i
const SEVEN_TV_UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const SEVEN_TV_HEX_ID = /^[0-9a-fA-F]{32}$/

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

function isSevenTvEmoteId(id: string): boolean {
  return LEGACY_SEVEN_TV_ID.test(id) || SEVEN_TV_ULID.test(id) || SEVEN_TV_UUID.test(id) || SEVEN_TV_HEX_ID.test(id)
}

function sevenTvCdnUrl(id: string): string {
  return `https://cdn.7tv.app/emote/${id}/4x.webp`
}

/** Build the official 7TV emote page URL from an upstream emote ID. */
export function sevenTvEmoteUrl(providerEmoteId?: string): string | undefined {
  const id = providerEmoteId?.trim() ?? ''
  if (!id || !isSevenTvEmoteId(id)) return undefined
  return `https://7tv.app/emotes/${encodeURIComponent(id)}`
}

/** Resolve BFF emote metadata to a URL the extension can load (absolute CDN or backend proxy). */
export function extensionEmoteImageUrl(
  emote: Pick<ExtensionEmote, 'id' | 'providerEmoteId' | 'imageUrl' | 'provider'>,
  backendUrl: string,
): string | undefined {
  const provider = normalizeEmoteProvider(emote.provider)
  const id = emote.id?.trim() ?? ''
  const providerEmoteId = emote.providerEmoteId?.trim() ?? ''
  const raw = emote.imageUrl?.trim()

  if (provider === 'seventv') {
    if (providerEmoteId && isSevenTvEmoteId(providerEmoteId)) {
      return sevenTvCdnUrl(providerEmoteId)
    }
    if (id && LEGACY_SEVEN_TV_ID.test(id)) {
      return sevenTvCdnUrl(id)
    }
  }

  if (raw && /^https?:\/\//i.test(raw)) {
    return raw
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
