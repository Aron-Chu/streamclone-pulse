import { isBrokenLocalEmotePath, resolveEmoteImageUrl } from '@streampulse/pulse-core'
import type { ExtensionEmote } from './messages.ts'
import { safeImageUrl } from './safeUrl.ts'

const LEGACY_SEVEN_TV_ID = /^[0-9a-fA-F]{24}$/

function normalizeEmoteProvider(provider?: string): string | undefined {
  if (!provider) return undefined
  const lower = provider.trim().toLowerCase()
  if (lower === '7tv') return 'seventv'
  return lower
}

function backendProxyUrl(path: string, backendUrl: string): string | undefined {
  const base = backendUrl.replace(/\/+$/, '')
  return safeImageUrl(`${base}${path}`, backendUrl)
}

function sevenTvCdnUrl(id: string): string {
  return `https://cdn.7tv.app/emote/${id}/4x.webp`
}

const SAFE_PROVIDER_ID = /^[A-Za-z0-9_-]{1,128}$/

function providerCdnUrl(provider: string | undefined, providerId: string): string | undefined {
  if (!SAFE_PROVIDER_ID.test(providerId)) return undefined
  switch (provider) {
    case 'twitch':
      return `https://static-cdn.jtvnw.net/emoticons/v2/${providerId}/default/dark/3.0`
    case 'seventv':
      return `https://cdn.7tv.app/emote/${providerId}/4x.webp`
    case 'ffz':
      return `https://cdn.frankerfacez.com/emoticon/${providerId}/4`
    case 'bttv':
      return `https://cdn.betterttv.net/emote/${providerId}/3x`
    default:
      return undefined
  }
}

function pushUnique(candidates: string[], candidate: string | undefined): void {
  if (candidate && !candidates.includes(candidate)) candidates.push(candidate)
}

/** Resolve BFF emote metadata into ordered, validated image candidates. */
export function extensionEmoteImageUrls(
  emote: Pick<ExtensionEmote, 'id' | 'providerEmoteId' | 'imageUrl' | 'provider'>,
  backendUrl: string,
): string[] {
  const provider = normalizeEmoteProvider(emote.provider)
  const id = emote.id?.trim() ?? ''
  const providerEmoteId = emote.providerEmoteId?.trim() ?? ''
  const raw = emote.imageUrl?.trim()
  const candidates: string[] = []

  if (raw && /^https?:\/\//i.test(raw)) {
    pushUnique(candidates, safeImageUrl(raw, backendUrl))
  }

  if (providerEmoteId) {
    pushUnique(candidates, providerCdnUrl(provider, providerEmoteId))
  }

  if (provider === 'seventv' && id && LEGACY_SEVEN_TV_ID.test(id)) {
    pushUnique(candidates, sevenTvCdnUrl(id))
  }

  if (raw && raw.startsWith('/') && !isBrokenLocalEmotePath(raw)) {
    pushUnique(candidates, backendProxyUrl(raw, backendUrl))
  }

  const resolved = resolveEmoteImageUrl({ provider, id, imageUrl: raw, scale: '1x' }).trim()
  if (resolved) {
    pushUnique(
      candidates,
      resolved.startsWith('/') ? backendProxyUrl(resolved, backendUrl) : safeImageUrl(resolved, backendUrl),
    )
  }

  return candidates
}

/** Backwards-compatible first candidate for callers that only need one URL. */
export function extensionEmoteImageUrl(
  emote: Pick<ExtensionEmote, 'id' | 'providerEmoteId' | 'imageUrl' | 'provider'>,
  backendUrl: string,
): string | undefined {
  return extensionEmoteImageUrls(emote, backendUrl)[0]
}
