/**
 * Busiest now's live pictures (mockup §5, Aron 10-31). While the 5-minute numbers are Live, each tile loads
 * Twitch's live picture with CORS, hidden over the face tile until the offline check clears it: Twitch answers a
 * channel that isn't live with its offline picture (HTTP 200), so a proven offline picture or a failed load keeps
 * the face. The picture moves every 5 minutes, and the last proven one stays up while the next is checked.
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HubLiveChannel } from '../src/lib/publicHub'

const check = vi.hoisted(() => ({ offline: vi.fn(async (_img: HTMLImageElement) => false) }))

vi.mock('../../packages/analytics-console/src/utils/twitchBoxArt.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../packages/analytics-console/src/utils/twitchBoxArt.ts')>()),
  isTwitchOfflinePreview: check.offline,
}))

import { HubV5Busiest } from '../src/ui/components/hub/v5/HubV5Busiest'

afterEach(() => {
  cleanup()
  check.offline.mockReset()
  check.offline.mockImplementation(async () => false)
  vi.unstubAllGlobals()
})

const MIN = 60_000
const W1 = Date.UTC(2026, 9, 19, 18, 0)
const PROFILE = 'https://static-cdn.jtvnw.net/jtv_user_pictures/abc-profile_image-300x300.png'
const PROFILE_70 = 'https://static-cdn.jtvnw.net/jtv_user_pictures/abc-profile_image-70x70.png'
const preview = (t: number, size = '440x248') =>
  `https://static-cdn.jtvnw.net/previews-ttv/live_user_xqc-${size}.jpg?t=${Math.floor(t / (5 * MIN))}`

/** xQc with a full 5-minute window ending at `end`. */
const live = (end: number, profileImageUrl: string | undefined = PROFILE): HubLiveChannel[] => [{
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
    measuredAt: end,
    baselineKind: 'current_stream_measured_average',
    state: 'ready',
    currentWindow: { start: end - 5 * MIN, end, expectedMinutes: 5, measuredMinutes: 5, coveragePct: 100 },
    baselineWindow: null,
    baselineMeasuredMinutes: 40,
    evidence: null,
    chat: { state: 'ready', currentPerMin: 120, baselinePerMin: 60, multiplier: 2, baselineMeasuredMinutes: 40 },
    emotes: null,
  },
} as HubLiveChannel]

function busiest(end: number, nowMs = end, profileImageUrl: string | undefined = PROFILE) {
  const view = render(<MemoryRouter><HubV5Busiest live={live(end, profileImageUrl)} nowMs={nowMs} /></MemoryRouter>)
  const at = (nextEnd: number, nextNow = nextEnd) =>
    view.rerender(<MemoryRouter><HubV5Busiest live={live(nextEnd, profileImageUrl)} nowMs={nextNow} /></MemoryRouter>)
  const pictures = () => [...view.container.querySelectorAll<HTMLImageElement>('img.hv5-bzv-prev')]
  const shown = () => view.container.querySelector<HTMLImageElement>('img.hv5-bzv-prev[data-shown]')
  const tile = () => view.container.querySelector('.hv5-bzt-t')!
  return { ...view, at, pictures, shown, tile }
}

const load = async (img: HTMLImageElement) => {
  await act(async () => { fireEvent.load(img) })
}

describe('Busiest now live pictures (mockup §5, 10-31)', () => {
  it('while Live, loads Twitch’s live picture with CORS, hidden over the face until it is checked', () => {
    const view = busiest(W1)
    const [img, more] = view.pictures()
    expect(more).toBeUndefined()
    expect(img!.getAttribute('src')).toBe(preview(W1))
    expect(img!.getAttribute('crossorigin')).toBe('anonymous')
    expect(img!.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(img!.getAttribute('loading')).toBe('lazy')
    expect(view.shown()).toBeNull()
    expect(view.container.querySelector('img.hv5-bzv-fa')).not.toBeNull()
    expect(view.tile().getAttribute('aria-label')).toMatch(/\. Profile picture\.$/)
  })

  it('asks for 640×360 at a pixel ratio of 2 or more', () => {
    vi.stubGlobal('devicePixelRatio', 2)
    const view = busiest(W1)
    expect(view.pictures()[0]!.getAttribute('src')).toBe(preview(W1, '640x360'))
  })

  it('shows the picture once the check clears it, with the small face in the caption', async () => {
    const view = busiest(W1)
    const img = view.pictures()[0]!
    await load(img)
    expect(check.offline).toHaveBeenCalledWith(img)
    expect(view.shown()).toBe(img)
    expect(view.container.querySelector('img.hv5-bzv-av')!.getAttribute('src')).toBe(PROFILE_70)
    expect(view.container.querySelector('.hv5-bzt-cap')!.classList.contains('hf')).toBe(true)
    expect(view.tile().getAttribute('aria-label')).toBe('xQc, 120 chat messages per minute, Just Chatting, rank 1 of 1. Twitch’s live picture, can be a few minutes old.')
  })

  it('keeps the face when the picture is Twitch’s offline picture', async () => {
    check.offline.mockImplementation(async () => true)
    const view = busiest(W1)
    await load(view.pictures()[0]!)
    expect(view.pictures()).toEqual([])
    expect(view.container.querySelector('img.hv5-bzv-av')).toBeNull()
    expect(view.tile().getAttribute('aria-label')).toMatch(/\. Profile picture\.$/)
  })

  it('keeps the face when the picture does not load', () => {
    const view = busiest(W1)
    fireEvent.error(view.pictures()[0]!)
    expect(view.pictures()).toEqual([])
  })

  it('shows the picture when the check cannot tell', async () => {
    check.offline.mockImplementation(async () => { throw new Error('tainted canvas') })
    const view = busiest(W1)
    await load(view.pictures()[0]!)
    expect(view.shown()).not.toBeNull()
  })

  it('leaves the small face out without a real profile picture, or when it fails', async () => {
    const bare = busiest(W1, W1, '')
    await load(bare.pictures()[0]!)
    expect(bare.shown()).not.toBeNull()
    expect(bare.container.querySelector('img.hv5-bzv-av')).toBeNull()
    expect(bare.container.querySelector('.hv5-bzt-cap')!.classList.contains('hf')).toBe(false)
    bare.unmount()

    const view = busiest(W1)
    await load(view.pictures()[0]!)
    const small = () => view.container.querySelector('img.hv5-bzv-av')
    fireEvent.error(small()!)
    expect(small()!.getAttribute('src')).toBe(PROFILE)
    fireEvent.error(small()!)
    expect(small()).toBeNull()
    expect(view.container.querySelector('.hv5-bzt-cap')!.classList.contains('hf')).toBe(false)
  })

  it('asks again only in the next 5 minutes, keeping the proven picture until the next one is checked', async () => {
    const view = busiest(W1)
    const first = view.pictures()[0]!
    await load(first)
    view.at(W1, W1 + MIN)
    expect(view.pictures()).toEqual([first])
    view.at(W1 + 5 * MIN)
    const [kept, next] = view.pictures()
    expect(kept).toBe(view.shown())
    expect(kept!.getAttribute('src')).toBe(preview(W1))
    expect(next!.getAttribute('src')).toBe(preview(W1 + 5 * MIN))
    expect(next!.hasAttribute('data-shown')).toBe(false)
    await load(next!)
    expect(view.pictures()).toEqual([next])
    expect(view.shown()).toBe(next)
  })

  it('drops back to the face when the next picture is offline, and the old one does not come back', async () => {
    const view = busiest(W1)
    await load(view.pictures()[0]!)
    check.offline.mockImplementation(async () => true)
    view.at(W1 + 5 * MIN)
    await load(view.pictures()[1]!)
    expect(view.pictures()).toEqual([])
    view.at(W1 + 10 * MIN)
    expect(view.pictures().map((img) => img.getAttribute('src'))).toEqual([preview(W1 + 10 * MIN)])
    expect(view.shown()).toBeNull()
  })

  it('a check that ends after its 5 minutes have passed changes nothing', async () => {
    let finish: (offline: boolean) => void = () => {}
    check.offline.mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve }))
    const view = busiest(W1)
    await load(view.pictures()[0]!)
    view.at(W1 + 5 * MIN)
    await act(async () => { finish(false) })
    expect(view.shown()).toBeNull()
    expect(view.pictures().map((img) => img.getAttribute('src'))).toEqual([preview(W1 + 5 * MIN)])
  })

  it('old numbers show faces only, and a picture is checked again when they are Live again', async () => {
    const view = busiest(W1, W1 + 10 * MIN)
    expect(view.pictures()).toEqual([])
    view.at(W1)
    await load(view.pictures()[0]!)
    view.at(W1, W1 + 4 * MIN)
    expect(view.pictures()).toEqual([])
    expect(view.tile().getAttribute('aria-label')).toMatch(/\. Profile picture\.$/)
    view.at(W1 + 5 * MIN)
    expect(view.shown()).toBeNull()
    expect(view.pictures().map((img) => img.getAttribute('src'))).toEqual([preview(W1 + 5 * MIN)])
  })
})
