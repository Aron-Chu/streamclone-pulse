import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { PublicHub } from '../src/lib/publicHub'
import { EmoteTicker } from '../src/ui/components/landing/EmoteTicker'
import {
  TICKER_PICTURE_PX,
  buildEmoteTicker,
  buildMoverTicker,
  type TickerItem,
} from '../src/ui/components/landing/landingData'

afterEach(cleanup)

const AVATAR_300 = 'https://static-cdn.jtvnw.net/jtv_user_pictures/abc-profile_image-300x300.png'
const AVATAR_70 = 'https://static-cdn.jtvnw.net/jtv_user_pictures/abc-profile_image-70x70.png'

function mover(login: string) {
  return { login, displayName: login, seventvPerMin: 30, trendPct: 12, profileImageUrl: AVATAR_300 }
}

function hubWith(overrides: Record<string, unknown>): PublicHub {
  return { topEmotes: [], topMovers: [], ...overrides } as unknown as PublicHub
}

// The strip draws every lead picture at 20 px, so it must not download the 300 px avatar or a 4x animated emote.
describe('home ticker pictures', () => {
  it('draws pictures at 20 px', () => {
    expect(TICKER_PICTURE_PX).toBe(20)
  })

  it('asks for the 70 px avatar and keeps the full file as the fallback', () => {
    const movers = buildMoverTicker(hubWith({ topMovers: [mover('a'), mover('b'), mover('c')] }))
    expect(movers).toHaveLength(3)
    for (const item of movers) {
      expect(item.image).toBe(AVATAR_70)
      expect(item.imageFallback).toBe(AVATAR_300)
    }
  })

  it('asks for the smallest emote file, a still one for Twitch', () => {
    const items = buildEmoteTicker(hubWith({
      topEmotes: [
        { name: 'KEKW', provider: '7tv', count: 900, sharePct: 22, imageUrl: 'https://cdn.7tv.app/emote/01ABC/4x.webp' },
        { name: 'Kappa', provider: 'twitch', count: 500, sharePct: 12, imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0' },
      ],
    }))
    expect(items.map((item) => item.image)).toEqual([
      'https://cdn.7tv.app/emote/01ABC/1x.webp',
      'https://static-cdn.jtvnw.net/emoticons/v2/25/static/dark/1.0',
    ])
  })

  it('maps an emote with no picture of its own to the landing emote at the same size', () => {
    const items = buildEmoteTicker(hubWith({
      topEmotes: [
        { name: 'peepoHappy', provider: '7tv', count: 10, sharePct: 1 },
        { name: 'KEKW', provider: 'twitch', count: 9, sharePct: 1 },
      ],
    }))
    expect(items.map((item) => item.image)).toEqual([
      'https://cdn.7tv.app/emote/01GAZ199Z8000FEWHS6AT5QZV0/1x.webp',
      'https://static-cdn.jtvnw.net/emoticons/v2/305954168/static/dark/1.0',
    ])
  })

  it('shows the resized avatar, then the full one if it fails, then the initial', () => {
    const items: TickerItem[] = [{ lead: 'A', label: 'abc', value: '30/min', tone: 'up', image: AVATAR_70, imageFallback: AVATAR_300 }]
    const { container } = render(<EmoteTicker variant="b" label="Trending" items={items} />)
    // The strip repeats its track for a seamless loop; follow the first.
    const track = container.querySelector('.sl-ticker__track') as HTMLElement
    const first = track.querySelector('img') as HTMLImageElement
    expect(first.src).toBe(AVATAR_70)
    expect(first.getAttribute('width')).toBe('20')
    expect(first.getAttribute('height')).toBe('20')
    fireEvent.error(first)
    expect((track.querySelector('img') as HTMLImageElement).src).toBe(AVATAR_300)
    fireEvent.error(track.querySelector('img') as HTMLImageElement)
    expect(track.querySelector('img')).toBeNull()
    expect(track.querySelector('.sl-ticker__lead')?.textContent).toBe('A')
  })
})
