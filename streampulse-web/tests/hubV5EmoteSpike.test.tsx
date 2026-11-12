import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearBucketMomentsCache, writeBucketMomentsCache } from '../src/lib/bucketMomentsCache'
import { resetHubIntervalMomentsForTests } from '../src/lib/hubIntervalMoments'
import type { HubApiWindow } from '../src/lib/hubWindows'
import { normalizePublicHub, type HubActivityPoint, type HubLivePulseMoment, type PublicHubMomentsResponse } from '../src/lib/publicHub'
import AnalyticsHubV5Page from '../src/routes/analytics/AnalyticsHubV5Page'
import { HubV5EmoteMap } from '../src/ui/components/hub/v5/HubV5EmoteMap'
import { hubClock, hubClockRange } from '../src/ui/components/hub/v5/hubV5Model'

const requestHubBucketMoments = vi.hoisted(() => vi.fn())
vi.mock('../src/lib/prefetchHubBucketMoments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/prefetchHubBucketMoments')>()),
  requestHubBucketMoments,
}))

// the page test's hub answer; the map tests above render the map alone
const hubState = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))
vi.mock('../src/hooks/usePublicHubData', () => ({ usePublicHubData: () => hubState.value }))

const MIN = 60_000
const BM = 6
const T0 = Date.UTC(2026, 9, 29, 12, 0)
/** A 24 h answer: 239 closed six-minute intervals, then the open edge. */
const T1 = T0 + 239 * BM * MIN
const SPIKE = T0 + 100 * BM * MIN
/** In the last hour, not the last 30 minutes. */
const RECENT = T0 + 233 * BM * MIN

/** KEKW leads every interval; Pog made a top 10 twice: 60 uses at SPIKE, 24 at RECENT. */
function points(): HubActivityPoint[] {
  return Array.from({ length: 240 }, (_, i) => ({
    t: T0 + i * BM * MIN,
    bucketComplete: i < 239,
    emotes: 1000,
    topEmotes: [
      { name: 'KEKW', provider: 'seventv', count: 100 },
      ...(i === 100 ? [{ name: 'Pog', provider: 'twitch', count: 60 }] : []),
      ...(i === 233 ? [{ name: 'Pog', provider: 'twitch', count: 24 }] : []),
    ],
  })) as unknown as HubActivityPoint[]
}

const row = (login: string, at: number, top: Array<[string, string, number]>, extra: Partial<HubLivePulseMoment> = {}): HubLivePulseMoment => ({
  offsetSeconds: 600,
  score: 1,
  label: 'Chat spike',
  login,
  displayName: login.toUpperCase(),
  streamId: `s-${login}`,
  at,
  topEmotes: top.map(([name, provider, count]) => ({ name, provider, count, sharePct: 0 })),
  ...extra,
})

function answer(bucketT: number, moments: HubLivePulseMoment[]): PublicHubMomentsResponse {
  return {
    bucketT, bucketStart: '', bucketEnd: '', hubGeneratedAt: '', source: 'corpus_historical',
    status: moments.length ? 'ready' : 'empty', activityWindowMinutes: 1440, moments,
  }
}

function renderMap(
  props: { intervalWindow?: HubApiWindow; historyBehind?: string | null } = { intervalWindow: '24h' },
  pts = points(),
  bm = BM,
  nowMs = T1 + MIN,
) {
  return render(<MemoryRouter><HubV5EmoteMap points={pts} bucketMinutes={bm} moments={[]} avatars={new Map()} nowMs={nowMs} {...props} /></MemoryRouter>)
}

const pickPog = () => fireEvent.click(screen.getByRole('button', { name: /^#2 Pog/ }))
const chips = () => [...screen.getByRole('group', { name: 'Emote map window' }).querySelectorAll('button')]

beforeEach(() => {
  clearBucketMomentsCache()
  resetHubIntervalMomentsForTests()
  requestHubBucketMoments.mockReset()
})

afterEach(() => {
  cleanup()
  resetHubIntervalMomentsForTests()
})

describe('a clicked emote (C1, 10-30)', () => {
  it('draws its uses per interval with the busiest one marked', () => {
    requestHubBucketMoments.mockReturnValue(new Promise(() => {}))
    const { container } = renderMap()
    pickPog()
    const bars = container.querySelector('svg.hv5-es-bars')!
    expect(bars.querySelectorAll('rect')).toHaveLength(239)
    expect(bars.querySelectorAll('rect.hv5-es-gap')).toHaveLength(237)
    expect(bars.querySelectorAll('rect.hv5-es-hi')).toHaveLength(1)
    const busiest = hubClockRange(SPIKE, SPIKE + BM * MIN)
    expect(bars.getAttribute('aria-label')).toBe(`Pog uses per interval, last 24 h, busiest ${busiest} at 10 a minute`)
    expect(container.querySelector('.hv5-es-pk')!.textContent).toBe(`Busiest ${busiest} · 10 a minute`)
    expect(container.querySelector('.hv5-es-ax')!.textContent).toMatch(/^24 h ago.*now$/)
    // the read is on its way: grey rows, a spoken line
    expect(container.querySelector('[aria-busy="true"]')!.textContent).toContain('Loading the streams for that interval.')
  })

  it('lists who drove it from one read of that interval, by provider and name, each row opening its minute in Moments', async () => {
    requestHubBucketMoments.mockResolvedValue(answer(SPIKE, [
      row('pokimane', SPIKE + 3 * MIN, [['KEKW', 'seventv', 90], ['LUL', 'twitch', 50], ['Pog', 'twitch', 12]]),
      row('xqc', SPIKE + 2 * MIN, [['Pog', 'twitch', 41]], { category: 'Just Chatting' }),
      row('shroud', SPIKE + MIN, [['Pog', 'seventv', 99]]),
    ]))
    const { container } = renderMap()
    pickPog()
    await waitFor(() => expect(container.querySelectorAll('.hv5-es-rows a')).toHaveLength(2))
    expect(requestHubBucketMoments).toHaveBeenCalledTimes(1)
    expect(requestHubBucketMoments).toHaveBeenCalledWith(expect.objectContaining({ bucketT: SPIKE, activityWindow: '24h' }))
    expect(container.textContent).toContain('Who drove it · streams in that interval with Pog in their top 3')
    expect(screen.getByText('2 streams in that interval had Pog in their top 3.').getAttribute('role')).toBe('status')
    const links = [...container.querySelectorAll('.hv5-es-rows a')]
    expect(links.map((a) => a.querySelector('.hv5-es-uses')!.textContent)).toEqual(['41 uses', '12 uses'])
    expect(links[0]!.getAttribute('href')).toContain('login=xqc')
    expect(links[0]!.querySelector('.hv5-es-at')!.textContent).toBe(`▶ ${hubClock(SPIKE + 2 * MIN)}`)
    expect(links[0]!.getAttribute('aria-label')).toBe(`XQC, Just Chatting, 41 Pog uses in its busiest minute at ${hubClock(SPIKE + 2 * MIN)}. Opens that minute in Moments.`)
    expect(links[1]!.textContent).toContain('No category')
  })

  it('says when the read fails, lists nothing, or finds no match; the bars stay', async () => {
    requestHubBucketMoments.mockRejectedValueOnce(new Error('down'))
    const failed = renderMap()
    pickPog()
    await waitFor(() => expect(failed.container.textContent).toContain('Couldn’t load the streams for that interval.'))
    expect(failed.container.querySelector('svg.hv5-es-bars')).not.toBeNull()
    failed.unmount()

    requestHubBucketMoments.mockResolvedValueOnce(answer(SPIKE, []))
    const empty = renderMap()
    pickPog()
    await waitFor(() => expect(empty.container.textContent).toContain('No streams were listed for that interval.'))
    empty.unmount()

    requestHubBucketMoments.mockResolvedValueOnce(answer(SPIKE, [row('shroud', SPIKE, [['Pog', 'seventv', 99]])]))
    const none = renderMap()
    pickPog()
    await waitFor(() => expect(none.container.textContent).toContain('None of the busiest chats in that interval had Pog in their top 3.'))
    none.unmount()

    // while history is behind, an empty interval is one that isn't in yet
    requestHubBucketMoments.mockResolvedValueOnce(answer(SPIKE, []))
    const behind = renderMap({ intervalWindow: '24h', historyBehind: '24-hour history is behind right now' })
    pickPog()
    await waitFor(() => expect(behind.container.textContent).toContain('The streams for that interval aren’t in yet.'))
  })

  it('shows a cached read on the first frame without asking again', () => {
    writeBucketMomentsCache(SPIKE, '24h', [], answer(SPIKE, [row('xqc', SPIKE + 2 * MIN, [['Pog', 'twitch', 41]])]))
    const { container } = renderMap()
    pickPog()
    expect(container.querySelectorAll('.hv5-es-rows a')).toHaveLength(1)
    expect(container.querySelector('[aria-busy="true"]')).toBeNull()
    expect(requestHubBucketMoments).not.toHaveBeenCalled()
  })

  it('draws no bar where the hub sent no list: an outage, not a quiet emote', () => {
    requestHubBucketMoments.mockReturnValue(new Promise(() => {}))
    const pts = points()
    pts[50] = { ...pts[50]!, topEmotes: [] }
    const { container } = renderMap({ intervalWindow: '24h' }, pts)
    pickPog()
    const bars = container.querySelector('svg.hv5-es-bars')!
    expect(bars.querySelectorAll('rect')).toHaveLength(238)
    expect(bars.querySelectorAll('rect.hv5-es-gap')).toHaveLength(236)
  })

  it('asks for 7 days or less on longer pages, and reads nothing without a window', () => {
    const long = renderMap({ intervalWindow: '1m' })
    pickPog()
    expect(long.container.textContent).toContain('Set the time window to 7 days or less to see streams.')
    long.unmount()
    const bare = renderMap({})
    pickPog()
    expect(bare.container.querySelector('svg.hv5-es-bars')).not.toBeNull()
    expect(bare.container.textContent).not.toContain('Who drove it')
    expect(requestHubBucketMoments).not.toHaveBeenCalled()
  })
})

describe('the window chips (W1, 10-30)', () => {
  it('re-cut the answer: the bars, the busiest interval and its read follow the chip', async () => {
    requestHubBucketMoments.mockImplementation(({ bucketT }: { bucketT: number }) => Promise.resolve(answer(bucketT, [row('xqc', bucketT + MIN, [['Pog', 'twitch', 9]])])))
    const { container } = renderMap()
    expect(chips().map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['30m', 'false'], ['1h', 'false'], ['6h', 'false'], ['24h', 'true']])
    pickPog()
    fireEvent.click(screen.getByRole('button', { name: '1h' }))
    expect(screen.getByRole('button', { name: '1h' }).getAttribute('aria-pressed')).toBe('true')
    const bars = container.querySelector('svg.hv5-es-bars')!
    expect(bars.querySelectorAll('rect')).toHaveLength(10)
    expect(bars.getAttribute('aria-label')).toBe(`Pog uses per interval, last hour, busiest ${hubClockRange(RECENT, RECENT + BM * MIN)} at 4 a minute`)
    await waitFor(() => expect(requestHubBucketMoments).toHaveBeenCalledWith(expect.objectContaining({ bucketT: RECENT, activityWindow: '24h' })))
    // Pog made no top 10 in the last 30 minutes: back to the list, without it
    fireEvent.click(screen.getByRole('button', { name: '30m' }))
    expect(container.querySelector('svg.hv5-es-bars')).toBeNull()
    expect(screen.queryByRole('button', { name: /Pog/ })).toBeNull()
    expect(screen.getByRole('button', { name: /^#1 KEKW/ })).toBeTruthy()
  })

  it('cut 5m · 15m · 30m on the live-pool fallback, the meta leading with the chart\'s behind words', () => {
    const pts = Array.from({ length: 31 }, (_, i) => ({
      t: T0 + i * MIN,
      bucketComplete: i < 30,
      emotes: 100,
      topEmotes: [{ name: 'KEKW', provider: 'seventv', count: 10 }],
    })) as unknown as HubActivityPoint[]
    renderMap({ intervalWindow: '30m', historyBehind: '24-hour history is behind right now' }, pts, 1, T0 + 31 * MIN)
    expect(chips().map((b) => b.textContent)).toEqual(['5m', '15m', '30m'])
    expect(screen.getByText('24-hour history is behind right now · last 30 min')).toBeTruthy()
  })
})

describe('on the page, on the live-pool fallback (W1 + C1, 10-30)', () => {
  // The hub's 24h answer of 2026-10-30 07:19Z: the backend served its 30-minute live-pool fallback. The hub hook is
  // mocked and fetch never answers: no live API.
  const raw = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/hub_screener_down_20261030.json'), 'utf8'))
  const NOW = Date.parse(normalizePublicHub(raw).generatedAt)
  const EDGE = Math.floor(NOW / MIN) * MIN
  const POG_T = EDGE - 10 * MIN
  // 30 closed minutes and the open one, each with its top 10, after a stale minute from 25 hours back the chart drops
  const pts = [EDGE - 25 * 60 * MIN, ...Array.from({ length: 31 }, (_, i) => EDGE - (30 - i) * MIN)].map((t) => ({
    t, chat: 100, emotes: 100, seventv: 50, twitch: 50, bttv: 0, ffz: 0, viewers: 1000, bucketComplete: t < EDGE,
    topEmotes: [{ name: 'KEKW', provider: 'seventv', count: 10 }, ...(t === POG_T ? [{ name: 'Pog', provider: 'twitch', count: 6 }] : [])],
  }))
  const hub = normalizePublicHub({ ...raw, activity: { ...raw.activity, points: pts } })

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW + 20_000)
    vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', '')
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    hubState.value = {
      data: hub, loading: false, refreshing: false, activityRefreshing: false, error: null, loadSource: 'full',
      hubEndpointOk: true, liveEmpty: false, lastUpdated: NOW, lastSuccessfulPollAt: null, pollSequence: 1, pollAttempt: 0,
      cachedAt: null, retryBlocked: false, hubReadPending: false, hubReadRunning: false, hubReadLate: false, refresh: () => {},
    }
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('maps the minutes the chart draws, says history is behind, and reads that minute on the 30m grid', async () => {
    requestHubBucketMoments.mockReturnValue(new Promise(() => {}))
    render(<MemoryRouter initialEntries={['/analytics?window=24h']}><AnalyticsHubV5Page /></MemoryRouter>)
    const section = document.querySelector<HTMLElement>('#emotes')!
    const group = within(section).getByRole('group', { name: 'Emote map window' })
    expect([...group.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['5m', '15m', '30m'])
    expect(within(section).getByText('24-hour history is behind right now · last 29 min')).toBeTruthy()
    fireEvent.click(within(section).getByRole('button', { name: /^#2 Pog/ }))
    await waitFor(() => expect(requestHubBucketMoments).toHaveBeenCalledWith(expect.objectContaining({ bucketT: POG_T, activityWindow: '30m' })))
  })
})
