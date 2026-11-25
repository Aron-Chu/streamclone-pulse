import { createElement } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HubActivityPoint } from '../src/lib/publicHub'
import { HubV5Conveyor, type HubV5ConveyorRefs } from '../src/ui/components/hub/v5/HubV5Conveyor'
import { emoteFlagKey } from '../src/ui/components/hub/v5/hubV5EmoteMapModel'

// The sanitizer resolves relative URLs against the backend, so the tests pin it.
vi.mock('../src/lib/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/apiClient')>()),
  getBackendUrl: () => 'https://api.streampulse.stream',
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const MOVING = 'https://cdn.7tv.app/emote/01HMOVE/4x.webp'
const STILL = 'https://cdn.7tv.app/emote/01HSTILL/4x.webp'
const TWITCH = 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/3.0'

const points = [{
  t: Date.UTC(2026, 10, 19, 12, 0),
  bucketComplete: true,
  topEmotes: [
    { name: 'catJAM', provider: 'seventv', count: 90, imageUrl: MOVING },
    { name: 'OMEGALUL', provider: 'seventv', count: 80, imageUrl: STILL },
    { name: 'Kappa', provider: 'twitch', count: 70, imageUrl: TWITCH },
  ],
}] as unknown as HubActivityPoint[]

/** Renders the conveyor, lets the page go idle (jsdom: a timer), and returns its picture loads. */
function bakeConveyor(animated?: ReadonlySet<string>) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const set = vi.spyOn(HTMLImageElement.prototype, 'src', 'set')
  const ctx = { setTransform() {}, clearRect() {}, save() {}, restore() {}, translate() {}, rotate() {}, drawImage() {} }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
  const mast = document.body.appendChild(document.createElement('header'))
  const refs: HubV5ConveyorRefs = { mast: { current: mast }, title: { current: null }, field: { current: null }, tryRow: { current: null }, foot: { current: null } }
  render(createElement(HubV5Conveyor, { points, refs, animated }))
  act(() => { vi.advanceTimersByTime(1000) })
  mast.remove()
  const urls = () => set.mock.calls.map((c) => c[0])
  const imageFor = (url: string) => set.mock.contexts[set.mock.calls.findIndex((c) => c[0] === url)] as HTMLImageElement
  return { urls, imageFor }
}

describe('the conveyor pictures', () => {
  it('asks 7TV for the 2x still of an emote the hub flags as animated, and the 2x file of the rest', () => {
    const got = bakeConveyor(new Set([emoteFlagKey('seventv', 'catJAM')]))
    expect(got.urls()).toEqual([
      'https://cdn.7tv.app/emote/01HMOVE/2x_static.webp',
      'https://cdn.7tv.app/emote/01HSTILL/2x.webp',
      'https://static-cdn.jtvnw.net/emoticons/v2/25/static/dark/2.0',
    ])
  })

  it('keeps every 7TV emote on its 2x file without flags', () => {
    expect(bakeConveyor().urls()).toEqual([
      'https://cdn.7tv.app/emote/01HMOVE/2x.webp',
      'https://cdn.7tv.app/emote/01HSTILL/2x.webp',
      'https://static-cdn.jtvnw.net/emoticons/v2/25/static/dark/2.0',
    ])
  })

  it('falls back to the moving file once when the still fails, then gives up', () => {
    const got = bakeConveyor(new Set([emoteFlagKey('seventv', 'catJAM'), emoteFlagKey('seventv', 'OMEGALUL')]))
    const still = 'https://cdn.7tv.app/emote/01HMOVE/2x_static.webp'
    const img = got.imageFor(still)
    const before = got.urls().length
    act(() => { img.onerror?.(new Event('error')) })
    expect(got.urls().slice(before)).toEqual(['https://cdn.7tv.app/emote/01HMOVE/2x.webp'])
    act(() => { img.onerror?.(new Event('error')) })
    expect(got.urls()).toHaveLength(before + 1)
  })
})
