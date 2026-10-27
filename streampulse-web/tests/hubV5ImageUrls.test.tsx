import { act, fireEvent, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { HubEmote, HubLiveChannel, HubLivePulseMoment } from '../src/lib/publicHub'
import { HubV5Avatar } from '../src/ui/components/hub/v5/HubV5Avatar'
import { HubV5Busiest } from '../src/ui/components/hub/v5/HubV5Busiest'
import { HubV5TopEmotes } from '../src/ui/components/hub/v5/HubV5Lists'
import { HubV5Moments } from '../src/ui/components/hub/v5/HubV5Moments'

// The sanitizer resolves relative URLs against the backend, so the tests pin it.
vi.mock('../src/lib/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/apiClient')>()),
  getBackendUrl: () => 'https://api.streampulse.stream',
}))

const SAFE = 'https://cdn.7tv.app/emote/01HXYZ/1x.webp'
const PROFILE = 'https://static-cdn.jtvnw.net/jtv_user_pictures/abc-profile_image-300x300.png'
const PROFILE_70 = 'https://static-cdn.jtvnw.net/jtv_user_pictures/abc-profile_image-70x70.png'
const PROFILE_150 = 'https://static-cdn.jtvnw.net/jtv_user_pictures/abc-profile_image-150x150.png'

/** Emote URLs the hub must never bind to <img src>. */
const REJECTED: ReadonlyArray<readonly [string, string]> = [
  ['javascript:', 'javascript:alert(1)'],
  ['data:', 'data:image/svg+xml,<svg onload="alert(1)"/>'],
  ['http: on an allowlisted host', 'http://cdn.7tv.app/emote/01HXYZ/1x.webp'],
  ['https: on an unknown host', 'https://evil.example/emote.webp'],
  ['https: on a look-alike host', 'https://cdn.7tv.app.evil.example/emote.webp'],
]

const imgSrcs = (root: ParentNode) => [...root.querySelectorAll('img')].map((img) => img.getAttribute('src'))

describe('HubV5Avatar', () => {
  it('asks for the 70 px Twitch rendition and falls back to the original, then the monogram', () => {
    const { container } = render(<HubV5Avatar login="xqc" name="xQc" src={PROFILE} size={24} />)
    const img = container.querySelector('img.hv5-av')!
    expect(img.getAttribute('src')).toBe(PROFILE_70)
    expect(img.getAttribute('width')).toBe('24')
    fireEvent.error(img)
    expect(container.querySelector('img.hv5-av')!.getAttribute('src')).toBe(PROFILE)
    fireEvent.error(container.querySelector('img.hv5-av')!)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('.hv5-mono')!.textContent).toBe('XQ')
  })

  it('binds a URL that is not a Twitch rendition unchanged, and draws the monogram without one', () => {
    const other = 'https://static-cdn.jtvnw.net/user-default-pictures-uv/abc.png'
    const { container, rerender } = render(<HubV5Avatar login="xqc" src={other} size={28} />)
    expect(imgSrcs(container)).toEqual([other])
    rerender(<HubV5Avatar login="xqc" src={null} size={28} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('.hv5-mono')).not.toBeNull()
  })
})

describe('Top emotes images', () => {
  const emotes = (imageUrl: string | undefined): HubEmote[] => [{ name: 'KEKW', provider: '7tv', count: 40, sharePct: 12, imageUrl } as HubEmote]

  it('binds an allowlisted https URL unchanged', () => {
    const { container } = render(<HubV5TopEmotes topEmotes={emotes(SAFE)} windowMinutes={5} />)
    expect(imgSrcs(container.querySelector('#emotes')!)).toEqual([SAFE])
    expect(container.querySelector('.hv5-te5-x')).toBeNull()
  })

  it.each(REJECTED)('draws the empty tile for %s, as for a missing URL', (_label, url) => {
    const { container } = render(<HubV5TopEmotes topEmotes={emotes(url)} windowMinutes={5} />)
    expect(container.querySelector('#emotes img')).toBeNull()
    expect(container.querySelector('.hv5-te5-x')).not.toBeNull()
    expect(container.querySelector('.hv5-te5-nm')!.textContent).toBe('KEKW')
  })
})

describe('Moments images', () => {
  const AT = Date.UTC(2026, 9, 19, 18, 0)
  const moment = (imageUrl: string | undefined): HubLivePulseMoment => ({
    offsetSeconds: 600,
    score: 1,
    label: 'Emote spike',
    login: 'xqc',
    displayName: 'xQc',
    streamId: 's1',
    at: AT,
    emotesPerMin: 100,
    topEmoteCode: 'KEKW',
    topEmotes: [{ name: 'KEKW', count: 80, imageUrl }],
    profileImageUrl: PROFILE,
  } as HubLivePulseMoment)

  /** Keyboard focus opens the card at once; jsdom has no :focus-visible, so the row reports it. */
  function openCard(imageUrl: string | undefined) {
    const matches = Element.prototype.matches
    vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
      return selector === ':focus-visible' ? true : matches.call(this, selector)
    })
    const view = render(<MemoryRouter><HubV5Moments moments={[moment(imageUrl)]} /></MemoryRouter>)
    act(() => view.container.querySelector<HTMLElement>('.hv5-mo')!.focus())
    const card = document.querySelector('[data-hv5-moment-card]')
    expect(card).not.toBeNull()
    return { view, card: card! }
  }

  it('the row and the card ask for the 70 px avatar, and the card binds an allowlisted emote URL unchanged', () => {
    const { view, card } = openCard(SAFE)
    expect(imgSrcs(view.container.querySelector('.hv5-mo')!)).toEqual([PROFILE_70])
    expect(imgSrcs(card.querySelector('.hv5-mc-e')!)).toEqual([SAFE])
    expect(imgSrcs(card.querySelector('.hv5-mc-h')!)).toEqual([PROFILE_70])
  })

  it.each(REJECTED)('the card names the top emote without a picture for %s', (_label, url) => {
    const { card } = openCard(url)
    const line = card.querySelector('.hv5-mc-e')!
    expect(line.querySelector('img')).toBeNull()
    expect(line.textContent).toContain('KEKW')
  })
})

describe('Busiest now faces', () => {
  const W1 = Date.UTC(2026, 9, 19, 18, 0)
  const live = (profileImageUrl: string | undefined): HubLiveChannel[] => [{
    login: 'xqc',
    displayName: 'xQc',
    category: 'Just Chatting',
    streamId: 's1',
    viewers: 1000,
    chatPerMin: 0,
    seventvPerMin: 0,
    coverageState: 'synced',
    trendPct: 0,
    profileImageUrl,
    screenerV1: {
      version: 1,
      measuredAt: W1,
      baselineKind: 'current_stream_measured_average',
      state: 'ready',
      currentWindow: { start: W1 - 5 * 60_000, end: W1, expectedMinutes: 5, measuredMinutes: 5, coveragePct: 100 },
      baselineWindow: null,
      baselineMeasuredMinutes: 40,
      evidence: null,
      chat: { state: 'ready', currentPerMin: 120, baselinePerMin: 60, multiplier: 2, baselineMeasuredMinutes: 40 },
      emotes: null,
    },
  } as HubLiveChannel]

  it('a face asks for the 150 px rendition and falls back to the original, then the monogram', () => {
    const { container } = render(<MemoryRouter><HubV5Busiest live={live(PROFILE)} nowMs={W1} /></MemoryRouter>)
    const face = () => container.querySelector('img.hv5-bzv-fa')
    expect(face()!.getAttribute('src')).toBe(PROFILE_150)
    fireEvent.error(face()!)
    expect(face()!.getAttribute('src')).toBe(PROFILE)
    fireEvent.error(face()!)
    expect(face()).toBeNull()
    expect(container.querySelector('.hv5-bzv-fam')!.textContent).toBe('XQ')
  })

  it('a channel without a picture keeps the monogram', () => {
    const { container } = render(<MemoryRouter><HubV5Busiest live={live(undefined)} nowMs={W1} /></MemoryRouter>)
    expect(container.querySelector('.hv5-bzc-it img')).toBeNull()
    expect(container.querySelector('.hv5-bzv-fam')).not.toBeNull()
  })
})
