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

function sevenTvCdnUrls(id: string): string[] {
  return ['4x', '2x', '1x'].map(scale => `https://cdn.7tv.app/emote/${id}/${scale}.webp`)
}

const SAFE_PROVIDER_ID = /^[A-Za-z0-9_-]{1,128}$/

function providerCdnUrls(provider: string | undefined, providerId: string): string[] {
  if (!SAFE_PROVIDER_ID.test(providerId)) return []
  switch (provider) {
    case 'twitch':
      return [`https://static-cdn.jtvnw.net/emoticons/v2/${providerId}/default/dark/3.0`]
    case 'seventv':
      return sevenTvCdnUrls(providerId)
    case 'ffz':
      return [`https://cdn.frankerfacez.com/emoticon/${providerId}/4`]
    case 'bttv':
      return [`https://cdn.betterttv.net/emote/${providerId}/3x`]
    default:
      return []
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
    for (const candidate of providerCdnUrls(provider, providerEmoteId)) {
      pushUnique(candidates, candidate)
    }
  }

  if (provider === 'seventv' && id && LEGACY_SEVEN_TV_ID.test(id)) {
    for (const candidate of sevenTvCdnUrls(id)) {
      pushUnique(candidates, candidate)
    }
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
