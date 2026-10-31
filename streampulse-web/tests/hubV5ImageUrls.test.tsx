import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MomentsFeedItem, MomentsFeedSnapshot } from '../src/lib/momentsFeed'
import type { HubActivityPoint, HubLiveChannel, HubLivePulseMoment, PublicHub } from '../src/lib/publicHub'
import { HubV5Avatar } from '../src/ui/components/hub/v5/HubV5Avatar'
import { HubV5Busiest } from '../src/ui/components/hub/v5/HubV5Busiest'
import { HubV5Conveyor, type HubV5ConveyorRefs } from '../src/ui/components/hub/v5/HubV5Conveyor'
import { HubV5EmoteMap } from '../src/ui/components/hub/v5/HubV5EmoteMap'
import { HubV5Rack } from '../src/ui/components/hub/v5/HubV5Rack'
import { HubV5TopMoments, useTopToday } from '../src/ui/components/hub/v5/HubV5TopMoments'
import type { HubWhereChatIs } from '../src/ui/components/hub/v5/hubV5Model'

// The sanitizer resolves relative URLs against the backend, so the tests pin it.
vi.mock('../src/lib/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/apiClient')>()),
  getBackendUrl: () => 'https://api.streampulse.stream',
}))
// Top moments reads the Moments list where a test turns the switch on; otherwise its rows are the hub's.
const feed = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('../src/lib/momentsFeed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/momentsFeed')>()),
  loadMomentsWindow: feed.load,
}))
vi.mock('../src/lib/momentsFeedVod', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/momentsFeedVod')>()),
  momentVods: { peek: () => undefined, read: () => Promise.resolve(null) },
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

const SAFE = 'https://cdn.7tv.app/emote/01HXYZ/1x.webp'
/** What the emote map binds for a 24 px picture: the same file at 2x. */
const SAFE_2X = 'https://cdn.7tv.app/emote/01HXYZ/2x.webp'
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

const W1 = Date.UTC(2026, 9, 19, 18, 0)
const MIN = 60_000

const imgSrcs = (root: ParentNode) => [...root.querySelectorAll('img')].map((img) => img.getAttribute('src'))

/** Keyboard focus opens a hub card at once; jsdom has no :focus-visible, so the element reports it. */
function focusVisible() {
  const matches = Element.prototype.matches
  vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
    return selector === ':focus-visible' ? true : matches.call(this, selector)
  })
}

/** One of the hub's live moments: KEKW led xQc's chat at 3x its emote average, four minutes before W1. */
const pulse = (imageUrl: string | undefined): HubLivePulseMoment => ({
  offsetSeconds: 3600,
  score: 9,
  label: 'Emote spike',
  kind: 'emote_spike',
  login: 'xqc',
  displayName: 'xQc',
  streamId: 's1',
  at: W1 - 4 * MIN,
  chatPerMin: 90,
  emotesPerMin: 100,
  topEmoteCode: 'KEKW',
  topEmotes: [{ name: 'KEKW', count: 80, imageUrl, provider: '7tv' }],
  profileImageUrl: PROFILE,
  comparison: { emotes: { state: 'ready', multiplier: 3, currentPerMin: 100, baselinePerMin: 33, baselineMeasuredMinutes: 40 } },
} as unknown as HubLivePulseMoment)

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

function Top({ hub, nowMs }: { hub: PublicHub | null; nowMs: number }) {
  const top = useTopToday({ hub, savedAt: null, reading: true, attempt: 1, nowMs })
  return <HubV5TopMoments top={top} nowMs={nowMs} />
}
const topRow = () => document.querySelector<HTMLElement>('#latest .hv5-tm-list > .hv5-tm-it')

describe('Top moments images from the hub', () => {
  function renderHubTop(imageUrl: string | undefined) {
    const hub = { generatedAt: new Date(W1).toISOString(), liveChannels: [], moments: [], livePulseMoments: [pulse(imageUrl)] } as unknown as PublicHub
    render(<MemoryRouter><div className="hub-v5"><Top hub={hub} nowMs={W1} /></div></MemoryRouter>)
    expect(topRow()).not.toBeNull()
    return topRow()!
  }

  it('a row and its open numbers ask for the 70 px avatar and bind an allowlisted emote URL unchanged', async () => {
    const row = renderHubTop(SAFE)
    expect(imgSrcs(row.querySelector('.hv5-tm-face')!)).toEqual([PROFILE_70])
    expect(imgSrcs(row.querySelector('.hv5-f2-em')!)).toEqual([SAFE])
    await act(async () => { fireEvent.click(row.querySelector('button')!) })
    expect(imgSrcs(row.querySelector('.hv5-tm-em')!)).toEqual([SAFE])
    fireEvent.error(row.querySelector('.hv5-tm-face img')!)
    expect(imgSrcs(row.querySelector('.hv5-tm-face')!)).toEqual([PROFILE])
  })

  it.each(REJECTED)('a row and its open numbers name the emote without a picture for %s', async (_label, url) => {
    const row = renderHubTop(url)
    const em = row.querySelector('.hv5-f2-em')!
    expect(em.querySelector('img')).toBeNull()
    expect(em.textContent).toBe('KEKW')
    await act(async () => { fireEvent.click(row.querySelector('button')!) })
    expect(row.querySelector('.hv5-tm-em img')).toBeNull()
    expect(row.querySelector('.hv5-tm-em')!.textContent).toContain('KEKW')
  })
})

describe('Top moments images from the Moments list', () => {
  const fixture = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/moments_feed_v1.json'), 'utf8')) as { items: MomentsFeedItem[] }
  const base = fixture.items.find((i) => i.verdict === 'ok' && i.label.kind === 'emotes')!
  const NOW = base.minuteStart + 10 * MIN
  function renderTop(imageUrl: string | undefined) {
    vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', '1')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    const item: MomentsFeedItem = { ...base, profileImageUrl: PROFILE, topEmotes: [{ name: 'KEKW', count: 80, imageUrl, provider: '7tv' }] }
    const snap = { items: [item], generatedAt: NOW, stale: false, total: 1, verdicts: { ok: 1, warn: 0, bad: 0 }, categories: [], nextCursor: null } as MomentsFeedSnapshot
    feed.load.mockReset().mockResolvedValue(snap)
    render(<MemoryRouter><div className="hub-v5"><Top hub={null} nowMs={NOW} /></div></MemoryRouter>)
  }
  const row = topRow

  it('a row and its open minute ask for the 70 px avatar and bind an allowlisted emote URL unchanged', async () => {
    renderTop(SAFE)
    await waitFor(() => expect(row()).not.toBeNull())
    await act(async () => {})
    expect(imgSrcs(row()!.querySelector('.hv5-tm-face')!)).toEqual([PROFILE_70])
    expect(imgSrcs(row()!.querySelector('.hv5-f2-em')!)).toEqual([SAFE])
    await act(async () => { fireEvent.click(row()!.querySelector('button')!) })
    expect(imgSrcs(row()!.querySelector('.hv5-tm-em')!)).toEqual([SAFE])
  })

  it.each(REJECTED)('a row and its open minute name the emote without a picture for %s', async (_label, url) => {
    renderTop(url)
    await waitFor(() => expect(row()).not.toBeNull())
    await act(async () => {})
    expect(row()!.querySelector('.hv5-f2-em img')).toBeNull()
    expect(row()!.querySelector('.hv5-f2-em')!.textContent).toBe('KEKW')
    await act(async () => { fireEvent.click(row()!.querySelector('button')!) })
    expect(row()!.querySelector('.hv5-tm-em img')).toBeNull()
    expect(row()!.querySelector('.hv5-tm-em')!.textContent).toContain('KEKW')
  })
})

describe('Emote map pictures', () => {
  const points = (imageUrl: string | undefined) => [3, 2, 1].map((k) => ({
    t: W1 - k * 6 * MIN,
    bucketComplete: true,
    emotes: 100,
    topEmotes: [{ name: 'KEKW', count: 80, imageUrl, provider: '7tv' }],
  })) as unknown as HubActivityPoint[]
  const renderMap = (imageUrl: string | undefined) => render(
    <MemoryRouter><HubV5EmoteMap points={points(imageUrl)} bucketMinutes={6} moments={[pulse(imageUrl)]} avatars={new Map()} nowMs={W1} /></MemoryRouter>,
  )

  it('Most used and a selected emote bind an allowlisted https URL at their size; its moments ask for the 70 px avatar', () => {
    const { container } = renderMap(SAFE)
    expect(imgSrcs(container.querySelector('.hv5-el-cols')!)).toEqual([SAFE_2X])
    fireEvent.click(container.querySelector('.hv5-el-cols button')!)
    expect(imgSrcs(container.querySelector('.hv5-el-ti')!)).toEqual([SAFE_2X])
    expect(imgSrcs(container.querySelector('.hv5-el-cols')!)).toEqual([PROFILE_70])
  })

  it.each(REJECTED)('Most used and a selected emote draw no picture for %s, as for a missing URL', (_label, url) => {
    const { container } = renderMap(url)
    const list = container.querySelector('.hv5-el-cols')!
    expect(list.querySelector('img')).toBeNull()
    expect(list.querySelector('.hv5-el-n')!.textContent).toContain('KEKW')
    fireEvent.click(list.querySelector('button')!)
    expect(container.querySelector('.hv5-el-ti img')).toBeNull()
    expect(container.querySelector('.hv5-el-ti')!.textContent).toContain('KEKW')
  })
})

describe('Where chat is card avatars', () => {
  const channel = { login: 'xqc', displayName: 'xQc', category: 'Just Chatting', viewers: 1000, chatPerMin: 120 } as HubLiveChannel
  const game = { name: 'Just Chatting', chat: 120, viewers: 1000, chatShare: 100, viewerShare: 100, rows: [channel] }
  const games: HubWhereChatIs = { top: [game], rest: [], all: [game], counted: 1, noWindow: 0 }

  it('a game card asks for the 70 px avatar and falls back to the original', () => {
    const { container } = render(<HubV5Rack games={games} game={null} onGame={() => {}} art={new Map()} avatars={new Map([['xqc', PROFILE]])} />)
    focusVisible()
    act(() => container.querySelector<HTMLElement>('.hv5-gr')!.focus())
    const top = document.querySelector('.hv5-gp-card .hv5-gc-top')!
    expect(imgSrcs(top)).toEqual([PROFILE_70])
    fireEvent.error(top.querySelector('img')!)
    expect(imgSrcs(top)).toEqual([PROFILE])
  })
})

describe('Conveyor pictures', () => {
  const points = (urls: ReadonlyArray<string>) => [{
    t: W1,
    bucketComplete: true,
    topEmotes: urls.map((imageUrl, i) => ({ name: `E${i}`, count: 50 - i, imageUrl })),
  }] as unknown as HubActivityPoint[]
  /** The picture URLs the conveyor loads to bake its sprites. */
  function loads(urls: ReadonlyArray<string>) {
    const set = vi.spyOn(HTMLImageElement.prototype, 'src', 'set')
    const ctx = { setTransform() {}, clearRect() {}, save() {}, restore() {}, translate() {}, rotate() {}, drawImage() {} }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
    const mast = document.body.appendChild(document.createElement('header'))
    const refs: HubV5ConveyorRefs = { mast: { current: mast }, kicker: { current: null }, field: { current: null }, tryRow: { current: null }, foot: { current: null } }
    render(<HubV5Conveyor points={points(urls)} refs={refs} />)
    mast.remove()
    return set.mock.calls.map((c) => c[0])
  }

  it('loads an allowlisted https picture unchanged', () => {
    expect(loads([SAFE])).toEqual([SAFE])
  })

  it('leaves out every picture the allowlist rejects', () => {
    expect(loads([SAFE, ...REJECTED.map(([, url]) => url)])).toEqual([SAFE])
  })
})

describe('Busiest now faces', () => {
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
    expect(container.querySelector('.hv5-bzc-it img.hv5-bzv-fa')).toBeNull()
    expect(container.querySelector('.hv5-bzv-fam')).not.toBeNull()
  })
})
