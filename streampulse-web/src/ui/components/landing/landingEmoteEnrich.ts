import {
  findLandingEmote,
  landingEmoteImageUrl,
} from './landingEmotes.ts'

export interface LandingFixtureEmote {
  id?: string
  name: string
  provider?: string
  count: number
  imageUrl?: string
}

export function toFixtureEmote(name: string, count: number): LandingFixtureEmote {
  const mapped = findLandingEmote(name)
  if (!mapped) {
    return { name, count, provider: '7TV' }
  }
  return {
    id: mapped.id,
    name: mapped.name,
    provider: mapped.provider === 'twitch' ? 'Twitch' : '7TV',
    count,
    imageUrl: landingEmoteImageUrl(mapped, '2x'),
  }
}

export function fixtureEmoteImageUrl(emote: LandingFixtureEmote): string | undefined {
  if (emote.imageUrl?.startsWith('https://')) return emote.imageUrl
  const mapped = findLandingEmote(emote.name)
  return mapped ? landingEmoteImageUrl(mapped, '2x') : undefined
}
