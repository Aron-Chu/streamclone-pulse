import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BUCKET_MOMENTS_CACHE_EMPTY_MS, clearBucketMomentsCache, writeBucketMomentsCache } from '../src/lib/bucketMomentsCache'
import { resetHubIntervalMomentsForTests } from '../src/lib/hubIntervalMoments'
import type { HubActivityPoint, HubLivePulseMoment, PublicHubMomentsResponse } from '../src/lib/publicHub'
import {
  clearHubBucketSelection,
  getHubBucketSelectionSnapshot,
  resetHubBucketSelectionForTests,
  selectHubBucket,
  setHubChartBridge,
  type HubChartBridge,
} from '../src/lib/hubBucketSelection'
import { HubV5BarCard, type HubV5BarCardProps } from '../src/ui/components/hub/v5/HubV5BarCard'

const requestHubBucketMoments = vi.hoisted(() => vi.fn())
vi.mock('../src/lib/prefetchHubBucketMoments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/prefetchHubBucketMoments')>()),
  requestHubBucketMoments,
}))

const MIN = 60_000
const BUCKET = 6 * MIN
const T0 = Date.UTC(2026, 9, 19, 12, 0)

const points: HubActivityPoint[] = Array.from({ length: 4 }, (_, i) => ({
  t: T0 + i * BUCKET,
  chat: 600 * (i + 1),
  emotes: 120,
  seventv: 60,
  viewers: 40_000,
  viewerCoverage: 'complete',
  hasChatRollup: true,
  hasViewerRollup: true,
  bucketComplete: true,
  topEmotes: [{ name: 'KEKW', provider: 'twitch', count: 30 }],
}))

/** The hub's own moment: xQc at 12:02, inside the first bar. */
const moments: HubLivePulseMoment[] = [
  { offsetSeconds: 120, score: 1, label: 'Emote spike', login: 'xqc', displayName: 'xQc', streamId: 's1', at: T0 + 2 * MIN },
]

/** A stream's busiest minute in a bucket, as hub/moments lists it. */
const row = (login: string, chatPerMin: number, at: number, extra: Partial<HubLivePulseMoment> = {}): HubLivePulseMoment => ({
  offsetSeconds: 120,
  score: 1,
  label: 'Chat spike',
  login,
  displayName: login === 'xqc' ? 'xQc' : login,
  streamId: `s-${login}`,
  at,
  chatPerMin,
  ...extra,
})

function answer(bucketT: number, rows: HubLivePulseMoment[], status = rows.length ? 'ready' : 'empty'): PublicHubMomentsResponse {
  return { bucketT, bucketStart: '', bucketEnd: '', hubGeneratedAt: '', source: 'corpus_historical', status, activityWindowMinutes: 1440, moments: rows }
}

function bridge(over: Partial<HubChartBridge> = {}): HubChartBridge {
  return {
    subscribeFrame: () => () => {},
    xOfMs: () => 0,
    plotElement: () => null,
    panToMs: vi.fn(),
    stepBar: vi.fn((ms: number, dir: -1 | 1) => ({ t: ms + dir * BUCKET, endT: ms + (dir + 1) * BUCKET, barMinutes: 6 })),
    zoomToMs: vi.fn(),
    focusPlot: vi.fn(),
    ...over,
  }
}

function lockTree(props: Partial<HubV5BarCardProps> = {}) {
  return (
    <MemoryRouter>
      <div className="hub-v5">
        <input aria-label="Search a streamer" />
        <HubV5BarCard points={points} bucketMinutes={6} moments={moments} intervalWindow="24h" intervalBucketMinutes={6} {...props} />
      </div>
    </MemoryRouter>
  )
}

function renderLock(props: Partial<HubV5BarCardProps> = {}) {
  return render(lockTree(props))
}

const select = (i: number) => act(() => selectHubBucket({ t: T0 + i * BUCKET, endT: T0 + (i + 1) * BUCKET, barMinutes: 6, source: 'bar' }))
const card = () => document.querySelector('[data-hub-bar-card]')
const names = () => [...card()!.querySelectorAll('.hbk-rows .hbk-n > span')].map((n) => n.textContent)
const note = () => card()!.querySelector('.hbk-none')?.textContent ?? null
const live = () => document.querySelector('[data-hub-bar-card-live]')!.textContent

beforeEach(() => {
  clearBucketMomentsCache()
  resetHubIntervalMomentsForTests()
  requestHubBucketMoments.mockReset()
  requestHubBucketMoments.mockReturnValue(new Promise(() => {}))
})

afterEach(() => {
  cleanup()
  resetHubBucketSelectionForTests()
  resetHubIntervalMomentsForTests()
  vi.useRealTimers()
})

describe('HubV5BarCard (L1, bar-lock board 11-01)', () => {
  it('shows nothing until a bar is locked, then the bar under the chart with its busiest chats', async () => {
    requestHubBucketMoments.mockResolvedValue(answer(T0, [
      row('soda', 100, T0 + 4 * MIN, { category: 'Just Chatting' }),
      row('xqc', 220, T0 + 2 * MIN, { category: 'Just Chatting', topEmotes: [{ name: 'DinoDance', count: 45, sharePct: 0 }] }),
      row('xqc', 90, T0 + 5 * MIN),
    ]))
    setHubChartBridge(bridge())
    renderLock()
    expect(card()).toBeNull()
    select(0)
    const region = screen.getByRole('region', { name: /^Locked bar, / })
    expect(region.getAttribute('data-hub-bar-card')).not.toBe('leave')
    expect(region.querySelector('.hbk-day')!.textContent).toMatch(/ · 6-min bar$/)
    await waitFor(() => expect(names()).toEqual(['xQc', 'soda']))
    expect(requestHubBucketMoments).toHaveBeenCalledTimes(1)
    expect(requestHubBucketMoments).toHaveBeenCalledWith(expect.objectContaining({ bucketT: T0, activityWindow: '24h' }))
    expect(region.querySelector('.hbk-chats .hbk-sub')!.textContent).toBe('Busiest chats · in this bar, by chat a minute')
    const [xqc, soda] = [...region.querySelectorAll<HTMLAnchorElement>('.hbk-rows a')]
    expect(xqc!.getAttribute('href')).toBe('/analytics/moments?login=xqc&stream=s-xqc&offset=120')
    expect(xqc!.querySelector('.hbk-n small')!.textContent).toBe('Just Chatting · Top moment')
    expect(soda!.querySelector('.hbk-mo')).toBeNull()
    expect(xqc!.querySelector('.hbk-te')!.textContent).toBe('DinoDance ×45')
    expect(xqc!.querySelector('.hbk-v')!.textContent).toBe('220/min')
    expect(xqc!.querySelector('.hbk-at')!.textContent).toMatch(/^▶ \d/)
    expect(xqc!.getAttribute('aria-label')).toMatch(/^xQc, Just Chatting, 220 chat a minute at .+, one of the hub’s top moments\. Opens that minute in Moments\.$/)
    // The top emotes come from the hub's own data.
    expect(region.querySelector('.hbk-emo .hbk-sub')!.textContent).toBe('Top emotes · a minute')
    expect([...region.querySelectorAll('.hbk-e')].map((e) => [e.querySelector('.hbk-en')!.textContent, e.querySelector('.hbk-v')!.textContent])).toEqual([['KEKW', '5']])
  })

  it('steps with ‹ › through the chart bridge and zooms to the bar', () => {
    const b = bridge()
    setHubChartBridge(b)
    renderLock()
    select(1)
    fireEvent.click(screen.getByRole('button', { name: 'Next bar' }))
    expect(b.stepBar).toHaveBeenCalledWith(T0 + BUCKET, 1)
    expect(getHubBucketSelectionSnapshot().selection).toMatchObject({ t: T0 + 2 * BUCKET, source: 'bar' })
    fireEvent.click(screen.getByRole('button', { name: 'Previous bar' }))
    expect(getHubBucketSelectionSnapshot().selection!.t).toBe(T0 + BUCKET)
    fireEvent.click(screen.getByRole('button', { name: 'Zoom to bar' }))
    expect(b.zoomToMs).toHaveBeenCalledWith(T0 + BUCKET, T0 + 2 * BUCKET)
  })

  it('unlocks on Clear and gives focus back to the plot', () => {
    const b = bridge()
    setHubChartBridge(b)
    renderLock()
    select(0)
    const clear = screen.getByRole('button', { name: 'Clear' })
    clear.focus()
    fireEvent.click(clear)
    expect(getHubBucketSelectionSnapshot().selection).toBeNull()
    expect(b.focusPlot).toHaveBeenCalledTimes(1)
  })

  it('unlocks on Escape, but not while typing in a field', () => {
    vi.useFakeTimers()
    const b = bridge()
    setHubChartBridge(b)
    renderLock()
    select(0)
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search a streamer' }), { key: 'Escape' })
    expect(getHubBucketSelectionSnapshot().selection).not.toBeNull()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(getHubBucketSelectionSnapshot().selection).toBeNull()
    expect(b.focusPlot).not.toHaveBeenCalled()
    expect(card()?.getAttribute('data-hub-bar-card')).toBe('leave')
    act(() => { vi.advanceTimersByTime(200) })
    expect(card()).toBeNull()
  })

  it('says the lock after the swap, then only what its list did', async () => {
    let resolve!: (value: PublicHubMomentsResponse) => void
    requestHubBucketMoments.mockReturnValue(new Promise((r) => { resolve = r }))
    setHubChartBridge(bridge())
    renderLock()
    select(2)
    await waitFor(() => expect(live()).toMatch(/^\S.* to .+ locked\. Loading the streams for this bar\.$/))
    resolve(answer(T0 + 2 * BUCKET, [row('xqc', 220, T0 + 13 * MIN)]))
    await waitFor(() => expect(live()).toBe('1 busiest chat listed.'))
  })

  it('holds six rows while it reads, then offers Retry on a failed read that waits out Retry-After', async () => {
    requestHubBucketMoments.mockRejectedValueOnce(Object.assign(new Error('rate limited'), { retryAfterMs: 400 }))
    setHubChartBridge(bridge())
    renderLock()
    select(1)
    expect(card()!.querySelectorAll('.hbk-ph')).toHaveLength(6)
    expect(card()!.querySelector('.hbk-chats')!.getAttribute('aria-busy')).toBe('true')
    await waitFor(() => expect(card()!.querySelector('.hbk-none')!.textContent).toBe('Couldn’t load the streams for this bar.Retry'))
    expect(card()!.getAttribute('data-hub-bar-chats')).toBe('note')
    // The top emotes still show: they come from the hub's own data.
    expect(card()!.querySelector('.hbk-erows')!.textContent).toContain('KEKW')

    requestHubBucketMoments.mockResolvedValueOnce(answer(T0 + BUCKET, [row('xqc', 220, T0 + 8 * MIN)]))
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(card()!.querySelectorAll('.hbk-ph')).toHaveLength(6)
    await act(() => new Promise((r) => setTimeout(r, 150)))
    expect(requestHubBucketMoments).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(names()).toEqual(['xQc']))
    expect(requestHubBucketMoments).toHaveBeenCalledTimes(2)
  })

  it('says no streams were listed, or that the streams aren’t in yet for the newest bar or behind history', async () => {
    requestHubBucketMoments.mockImplementation(({ bucketT }: { bucketT: number }) => Promise.resolve(answer(bucketT, [])))
    setHubChartBridge(bridge())
    const view = renderLock()
    select(0)
    await waitFor(() => expect(card()!.querySelector('.hbk-none')!.textContent).toBe('No streams were listed for this bar.'))
    select(3)
    await waitFor(() => expect(card()!.querySelector('.hbk-none')!.textContent).toBe('The streams for this bar aren’t in yet.'))
    view.unmount()
    renderLock({ historyBehind: '24-hour history is behind right now' })
    select(0)
    await waitFor(() => expect(card()!.querySelector('.hbk-none')!.textContent).toBe('The streams for this bar aren’t in yet.'))
  })

  it('says a bar that could not list can’t be loaded, with no Retry', async () => {
    requestHubBucketMoments.mockResolvedValue(answer(T0, [], 'unavailable'))
    setHubChartBridge(bridge())
    renderLock()
    select(0)
    await waitFor(() => expect(card()!.querySelector('.hbk-none')!.textContent).toBe('Couldn’t load the streams for this bar.'))
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('asks to zoom in on a bar wider than five buckets, and reads nothing', () => {
    const b = bridge()
    setHubChartBridge(b)
    renderLock()
    act(() => selectHubBucket({ t: T0, endT: T0 + 6 * BUCKET, barMinutes: 36, source: 'bar' }))
    expect(card()!.querySelector('.hbk-none')!.textContent).toBe('Zoom in to list streams.Zoom to bar')
    const zooms = screen.getAllByRole('button', { name: 'Zoom to bar' })
    expect(zooms).toHaveLength(2)
    fireEvent.click(zooms[1]!)
    expect(b.zoomToMs).toHaveBeenCalledWith(T0, T0 + 6 * BUCKET)
    expect(card()!.querySelector('.hbk-erows')!.textContent).toContain('KEKW')
    expect(requestHubBucketMoments).not.toHaveBeenCalled()
  })

  it('asks for a window of 7 days or less on long windows, and reads nothing', () => {
    setHubChartBridge(bridge())
    renderLock({ intervalWindow: '1m' })
    select(0)
    expect(card()!.querySelector('.hbk-none')!.textContent).toBe('Set the time window to 7 days or less to see streams.')
    expect(requestHubBucketMoments).not.toHaveBeenCalled()
  })

  it('shows the hatch and Not measured for a bar with no counts, and reads nothing', () => {
    setHubChartBridge(bridge())
    renderLock({ points: points.map((p, i) => (i === 1 ? { ...p, hasChatRollup: false } : p)) })
    select(1)
    expect(card()!.hasAttribute('data-gap')).toBe(true)
    expect(card()!.querySelector('.hbk-hatch')).not.toBeNull()
    expect(card()!.querySelector('.hbk-day')!.textContent).toMatch(/ · 6-min bar · Not measured$/)
    expect(card()!.querySelector('.hbk-none')!.textContent).toBe('No chat or emote counts for this bar.')
    expect(card()!.querySelector('.hbk-chats, .hbk-emo')).toBeNull()
    expect(requestHubBucketMoments).not.toHaveBeenCalled()
  })

  it('lists no streams without an interval window, and reads nothing', () => {
    setHubChartBridge(bridge())
    renderLock({ intervalWindow: undefined })
    select(0)
    expect(card()!.querySelector('.hbk-chats')).toBeNull()
    expect(card()!.querySelector('.hbk-erows')!.textContent).toContain('KEKW')
    expect(requestHubBucketMoments).not.toHaveBeenCalled()
  })

  it('drops a late answer for a bar stepped past', async () => {
    let first!: (value: PublicHubMomentsResponse) => void
    requestHubBucketMoments
      .mockReturnValueOnce(new Promise((r) => { first = r }))
      .mockResolvedValueOnce(answer(T0 + BUCKET, [row('soda', 100, T0 + 8 * MIN)]))
    setHubChartBridge(bridge())
    renderLock()
    select(0)
    await waitFor(() => expect(requestHubBucketMoments).toHaveBeenCalledTimes(1))
    select(1)
    await waitFor(() => expect(names()).toEqual(['soda']))
    await act(async () => {
      first(answer(T0, [row('xqc', 220, T0 + 2 * MIN)]))
      await new Promise((r) => setTimeout(r, 60))
    })
    expect(names()).toEqual(['soda'])
  })

  it('drops a selection the points no longer hold', () => {
    setHubChartBridge(bridge())
    renderLock()
    act(() => selectHubBucket({ t: T0 + 40 * BUCKET, endT: T0 + 41 * BUCKET, barMinutes: 6, source: 'bar' }))
    expect(getHubBucketSelectionSnapshot().selection).toBeNull()
  })
})

describe('HubV5BarCard read edges (review, 11-01)', () => {
  it('lists a bar locked again after Clear once the shared read has answered, and reads nothing new', async () => {
    let resolve!: (value: PublicHubMomentsResponse) => void
    requestHubBucketMoments.mockReturnValue(new Promise((r) => { resolve = r }))
    setHubChartBridge(bridge())
    renderLock()
    select(0)
    await waitFor(() => expect(requestHubBucketMoments).toHaveBeenCalledTimes(1))
    act(() => clearHubBucketSelection())
    // The shared transport outlives the lock: it answers and fills the tab cache.
    const a = answer(T0, [row('xqc', 220, T0 + 2 * MIN)])
    writeBucketMomentsCache(T0, '24h', [], a)
    await act(async () => { resolve(a) })
    await waitFor(() => expect(card()).toBeNull())
    select(0)
    expect(names()).toEqual(['xQc'])
    expect(requestHubBucketMoments).toHaveBeenCalledTimes(1)
  })

  it('lists a bar stepped back to once its read has answered, and reads nothing new', async () => {
    let resolve!: (value: PublicHubMomentsResponse) => void
    requestHubBucketMoments.mockReturnValue(new Promise((r) => { resolve = r }))
    // Bar 1 is in the tab cache already, so stepping to it reads nothing.
    writeBucketMomentsCache(T0 + BUCKET, '24h', [], answer(T0 + BUCKET, [row('soda', 90, T0 + 8 * MIN)]))
    setHubChartBridge(bridge())
    renderLock()
    select(0)
    await waitFor(() => expect(requestHubBucketMoments).toHaveBeenCalledTimes(1))
    select(1)
    expect(names()).toEqual(['soda'])
    const a = answer(T0, [row('xqc', 220, T0 + 2 * MIN)])
    writeBucketMomentsCache(T0, '24h', [], a)
    await act(async () => { resolve(a) })
    select(0)
    expect(names()).toEqual(['xQc'])
    expect(requestHubBucketMoments).toHaveBeenCalledTimes(1)
  })

  it('keeps a grown bar’s rows while its new bucket reads, and says nothing new', async () => {
    requestHubBucketMoments.mockImplementation(({ bucketT }: { bucketT: number }) =>
      bucketT === T0 + 2 * BUCKET ? Promise.resolve(answer(bucketT, [row('xqc', 220, T0 + 14 * MIN)])) : new Promise(() => {}))
    setHubChartBridge(bridge())
    // The newest 12-min bar, with one of its two buckets closed.
    const view = renderLock({ points: points.slice(0, 3) })
    act(() => selectHubBucket({ t: T0 + 2 * BUCKET, endT: T0 + 3 * BUCKET, barMinutes: 12, source: 'bar' }))
    await waitFor(() => expect(names()).toEqual(['xQc']))
    await waitFor(() => expect(live()).toMatch(/ locked\. 1 busiest chat listed\.$/))
    const said = live()
    // The next poll closes the second bucket, and the chart re-selects the grown bar.
    view.rerender(lockTree())
    act(() => selectHubBucket({ t: T0 + 2 * BUCKET, endT: T0 + 4 * BUCKET, barMinutes: 12, source: 'bar' }))
    expect(card()!.querySelector('.hbk-ph')).toBeNull()
    expect(names()).toEqual(['xQc'])
    await waitFor(() => expect(requestHubBucketMoments).toHaveBeenCalledWith(expect.objectContaining({ bucketT: T0 + 3 * BUCKET })))
    await act(() => new Promise((r) => setTimeout(r, 60)))
    expect(names()).toEqual(['xQc'])
    expect(live()).toBe(said)
  })

  it('keeps “aren’t in yet” after a poll closes the newest bar, and reads it again once that answer leaves the tab cache', async () => {
    vi.useFakeTimers()
    const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))
    requestHubBucketMoments.mockImplementation(({ bucketT }: { bucketT: number }) => Promise.resolve(answer(bucketT, [])))
    setHubChartBridge(bridge())
    const view = renderLock()
    select(3)
    await tick(50)
    expect(note()).toBe('The streams for this bar aren’t in yet.')
    // The next poll closes one more bucket: bar 3 is no longer the newest, but its empty answer came too early to say none.
    view.rerender(lockTree({ points: [...points, { ...points[3]!, t: T0 + 4 * BUCKET }] }))
    await tick(50)
    expect(note()).toBe('The streams for this bar aren’t in yet.')
    expect(requestHubBucketMoments).toHaveBeenCalledTimes(1)
    requestHubBucketMoments.mockResolvedValueOnce(answer(T0 + 3 * BUCKET, [row('xqc', 220, T0 + 20 * MIN)]))
    await tick(BUCKET_MOMENTS_CACHE_EMPTY_MS)
    await tick(50)
    await tick(50)
    expect(requestHubBucketMoments).toHaveBeenCalledTimes(2)
    expect(names()).toEqual(['xQc'])
  })

  it('keeps focus in the lock when Retry takes its button away', async () => {
    requestHubBucketMoments.mockRejectedValueOnce(new Error('server'))
    setHubChartBridge(bridge())
    renderLock()
    select(1)
    const retry = await screen.findByRole('button', { name: 'Retry' })
    retry.focus()
    fireEvent.click(retry)
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(document.activeElement).toBe(card()!.querySelector('.hbk-chats .hbk-sub'))
  })

  it('keeps focus in the lock when the note’s Zoom to bar re-locks a narrower bar', () => {
    // The chart re-selects the bar at the finer level it zooms to.
    setHubChartBridge(bridge({ zoomToMs: vi.fn(() => selectHubBucket({ t: T0, endT: T0 + BUCKET, barMinutes: 6, source: 'bar' })) }))
    renderLock()
    act(() => selectHubBucket({ t: T0, endT: T0 + 6 * BUCKET, barMinutes: 36, source: 'bar' }))
    const zoom = screen.getAllByRole('button', { name: 'Zoom to bar' })[1]!
    zoom.focus()
    fireEvent.click(zoom)
    expect(note()).toBeNull()
    expect(document.activeElement).toBe(card()!.querySelector('.hbk-chats .hbk-sub'))
  })

  it('says ‹ or › is off at either end of the chart, where a press keeps the lock', () => {
    const stepBar = vi.fn((ms: number, dir: -1 | 1) => {
      const t = ms + dir * BUCKET
      return t < T0 || t > T0 + 3 * BUCKET ? null : { t, endT: t + BUCKET, barMinutes: 6 }
    })
    setHubChartBridge(bridge({ stepBar }))
    renderLock()
    select(0)
    const prev = () => screen.getByRole('button', { name: 'Previous bar' })
    const next = () => screen.getByRole('button', { name: 'Next bar' })
    expect(prev().getAttribute('aria-disabled')).toBe('true')
    expect(next().getAttribute('aria-disabled')).toBe('false')
    fireEvent.click(prev())
    expect(getHubBucketSelectionSnapshot().selection!.t).toBe(T0)
    select(3)
    expect(prev().getAttribute('aria-disabled')).toBe('false')
    expect(next().getAttribute('aria-disabled')).toBe('true')
  })
})

describe('HubV5BarCard images', () => {
  const SAFE = 'https://cdn.7tv.app/emote/01HXYZ/1x.webp'
  const PROFILE = 'https://static-cdn.jtvnw.net/jtv_user_pictures/abc-profile_image-300x300.png'
  const REJECTED = ['javascript:alert(1)', 'data:image/svg+xml,<svg onload="alert(1)"/>', 'http://cdn.7tv.app/emote/01HXYZ/1x.webp', 'https://evil.example/emote.webp']

  async function renderImages(imageUrl: string) {
    const withImages = points.map((p) => ({ ...p, topEmotes: [{ name: 'KEKW', provider: 'twitch', count: 30, imageUrl }] }))
    requestHubBucketMoments.mockResolvedValue(answer(T0, [
      row('xqc', 220, T0 + 2 * MIN, { profileImageUrl: PROFILE, topEmotes: [{ name: 'KEKW', count: 44, sharePct: 10, imageUrl }] }),
    ]))
    setHubChartBridge(bridge())
    renderLock({ points: withImages })
    select(0)
    await waitFor(() => expect(card()!.querySelector('.hbk-r')).not.toBeNull())
    return { emotes: card()!.querySelector('.hbk-erows')!, row: card()!.querySelector('.hbk-r')! }
  }

  it('binds an allowlisted emote URL unchanged and asks for the 70 px avatar', async () => {
    const { emotes, row: r } = await renderImages(SAFE)
    expect(emotes.querySelector('img')!.getAttribute('src')).toBe(SAFE)
    expect(r.querySelector('.hbk-te img')!.getAttribute('src')).toBe(SAFE)
    expect(r.querySelector('img.hv5-av')!.getAttribute('src')).toBe(PROFILE.replace('300x300', '70x70'))
  })

  it.each(REJECTED)('draws the placeholder and no emote picture for %s', async (url) => {
    const { emotes, row: r } = await renderImages(url)
    expect(emotes.querySelector('img')).toBeNull()
    expect(emotes.querySelector('.hbk-noimg')!.textContent).toBe('KE')
    expect(r.querySelector('.hbk-te img')).toBeNull()
    expect(r.querySelector('.hbk-te')!.textContent).toBe('KEKW ×44')
  })
})
