import { fireEvent, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { HubLiveChannel } from '../src/lib/publicHub'
import { HubV5Avatar } from '../src/ui/components/hub/v5/HubV5Avatar'
import { HubV5Busiest } from '../src/ui/components/hub/v5/HubV5Busiest'

// The sanitizer resolves relative URLs against the backend, so the tests pin it.
vi.mock('../src/lib/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/apiClient')>()),
  getBackendUrl: () => 'https://api.streampulse.stream',
}))

const PROFILE = 'https://static-cdn.jtvnw.net/jtv_user_pictures/abc-profile_image-300x300.png'
const PROFILE_70 = 'https://static-cdn.jtvnw.net/jtv_user_pictures/abc-profile_image-70x70.png'
const PROFILE_150 = 'https://static-cdn.jtvnw.net/jtv_user_pictures/abc-profile_image-150x150.png'

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
