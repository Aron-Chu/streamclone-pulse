import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalyticsConsole } from './AnalyticsConsole.tsx'

// (fix, 10-30) CX-3: a live session page opened before its first measured
// minute. The live tail starts only once the session read holds a minute, the
// status poll never carries minutes, and the session read and the reused live
// frame had no interval, so in a foreground tab (no focus or visibility event)
// nothing read the minutes that arrived afterwards. The session read (or the
// reused live frame) is now read again every 30 s until its first minute.

const api = vi.hoisted(() => ({
  getAnalyticsLive: vi.fn(),
  getAnalyticsStream: vi.fn(),
  getAnalyticsStreams: vi.fn(),
  getChannelStreamHistory: vi.fn(),
  getPulseStreamRecap: vi.fn(),
  getReplayHeatmap: vi.fn(),
  getStreamGameSegments: vi.fn(),
  getStreamMinutesTail: vi.fn(),
  getStreamStatus: vi.fn(),
  getStreamSummary: vi.fn(),
  getSyncStatus: vi.fn(),
  startHistoricalSync: vi.fn(),
  watchAnalyticsChannel: vi.fn(),
}))

vi.mock('../api.ts', () => api)
vi.mock('./analytics/AnalyticsChart.tsx', () => ({ default: () => <div data-testid="analytics-chart" /> }))
vi.mock('./analytics/ConsoleBits.tsx', () => ({
  DataQualityButton: () => null,
  StatCard: ({ label, value }: { label: string; value?: unknown }) => (
    <div data-stat-label={label}>{typeof value === 'string' || typeof value === 'number' ? value : null}</div>
  ),
  CoverageStartMetaItem: () => null,
}))
vi.mock('./analytics/MomentReviewPanel.tsx', () => ({ MomentReviewPanel: () => null }))
vi.mock('./analytics/PastBroadcastBanner.tsx', () => ({ SessionLifecycleMeta: () => null }))
vi.mock('./analytics/StreamQualityBanner.tsx', () => ({ StreamQualityBanner: () => null }))
vi.mock('./analytics/TopEmoteTable.tsx', () => ({ TopEmoteTable: () => null }))

const MINUTE = 60_000
const POLL = 30_000
const NOW = Date.parse('2026-10-30T08:00:00.000Z')

interface Clock {
  startedMs: number
  startedAt: string
  /** When the backend has written the session's first minutes. */
  arriveAt: number
}

/** The stream went live two minutes ago; its first minutes are written 20 s after the page opens. */
function clock(ageMinutes = 2): Clock {
  const now = Date.now()
  const startedMs = Math.floor((now - ageMinutes * MINUTE) / MINUTE) * MINUTE
  return { startedMs, startedAt: new Date(startedMs).toISOString(), arriveAt: now + 20_000 }
}

function rows(c: Clock) {
  return [
    { minuteTs: new Date(c.startedMs).toISOString(), viewerAvg: 900, viewerLatest: 900, viewerSamples: 1, chatCount: 10 },
    { minuteTs: new Date(c.startedMs + MINUTE).toISOString(), viewerAvg: 950, viewerLatest: 950, viewerSamples: 1, chatCount: 20 },
  ]
}

const arrived = (c: Clock) => Date.now() >= c.arriveAt

/**
 * What the hosted adapter (`portalDetailToAnalytics`, streampulse-web) emits
 * against the frozen backend b1098ac, which sends no lifecycle contract: with
 * no measured minute the lifecycle is 'unknown' (only a fresh minute proves
 * live), `/minutes` answered `[]` so `minutesUnavailable`, and the backend's
 * own availability says the stream is open (`liveDvrState: 'live'`).
 */
function hostedDetail(c: Clock) {
  const minutes = arrived(c) ? rows(c) : []
  const measured = minutes.length > 0
  return {
    channel: 'xqc',
    state: measured ? 'live' : 'unknown',
    stream: {
      streamId: '202',
      login: 'xqc',
      title: 'Just went live',
      startedAt: c.startedAt,
      currentViewers: 900,
      viewerSamples: 1,
      lifecycleState: measured ? 'confirmed_live' : 'unknown',
      ...(measured ? { lifecycleObservedAt: new Date(Math.min(Date.now(), c.startedMs + 2 * MINUTE)).toISOString() } : {}),
    },
    rollups: minutes,
    momentRollups: measured ? minutes : undefined,
    topEmotes: [],
    sources: [{ source: 'analytics_db', state: 'ready' }],
    updatedAt: Date.now(),
    timelineMinutes: minutes.length,
    minutesUnavailable: !measured,
    availability: {
      version: 'v1',
      chartUsable: measured,
      chartState: measured ? 'usable' : 'unavailable',
      liveDvrState: 'live',
      vodState: 'pending_live',
      backfillState: 'idle',
      corpusState: 'optional_absent',
    },
  }
}

/** The same session with the lifecycle contract the console also accepts (confirmed live from the start). */
function contractDetail(c: Clock, lifecycleState: 'confirmed_live' | 'confirmed_ended' = 'confirmed_live') {
  const minutes = arrived(c) ? rows(c) : []
  return {
    channel: 'xqc',
    state: lifecycleState === 'confirmed_live' ? 'live' : 'historical',
    stream: {
      streamId: '202',
      login: 'xqc',
      title: 'Just went live',
      startedAt: c.startedAt,
      currentViewers: lifecycleState === 'confirmed_live' ? 900 : 0,
      lifecycleState,
      lifecycleObservedAt: new Date(Date.now()).toISOString(),
      ...(lifecycleState === 'confirmed_ended' ? { lifecycleDetectedAt: new Date(Date.now()).toISOString() } : {}),
    },
    rollups: minutes,
    momentRollups: minutes.length ? minutes : undefined,
    topEmotes: [],
    sources: [],
    updatedAt: Date.now(),
  }
}

/** `/minutes?afterOffset=`: rows at or after the offset, once written (the portal returns null below 0). */
function tailAnswer(c: Clock, afterOffset: number) {
  if (!Number.isFinite(afterOffset) || afterOffset < 0) return null
  const minutes = arrived(c)
    ? rows(c).filter((row) => (Date.parse(row.minuteTs) - c.startedMs) / 1000 >= afterOffset)
    : []
  return { channel: 'xqc', state: minutes.length ? 'live' : 'unknown', rollups: minutes, topEmotes: [], sources: [], updatedAt: Date.now() }
}

function listAnswer(c: Clock) {
  return {
    channel: 'xqc',
    items: [{ streamId: '202', login: 'xqc', title: 'Just went live', startedAt: c.startedAt, currentViewers: 900, viewerSamples: 1 }],
    sources: [],
    updatedAt: Date.now(),
  }
}

function LocationProbe() {
  return <div data-testid="path">{useLocation().pathname}</div>
}

function renderConsole(route: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <LocationProbe />
        <Routes>
          <Route path="/analytics/:login/:streamId?" element={<AnalyticsConsole />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return client
}

const chatTile = () => document.querySelector('[data-stat-label="Chat messages"]')?.textContent ?? null

/** A foreground tab: time passes, no focus, visibility or Refresh event. */
async function letPollsRun(periods: number) {
  for (let i = 0; i < periods; i++) {
    await act(() => vi.advanceTimersByTimeAsync(POLL))
  }
}

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  })
})

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(NOW)
  vi.clearAllMocks()
  api.getAnalyticsLive.mockImplementation(() => new Promise(() => undefined))
  api.getAnalyticsStream.mockResolvedValue(null)
  api.getPulseStreamRecap.mockResolvedValue(null)
  api.getReplayHeatmap.mockResolvedValue(null)
  api.getStreamGameSegments.mockResolvedValue([])
  api.getStreamMinutesTail.mockResolvedValue(null)
  // The hosted status read: no minutes, never a lifecycle (it is polled for pending_live).
  api.getStreamStatus.mockImplementation(async () => ({ streamId: '202', updatedAt: Date.now(), availability: { vodState: 'pending_live' } }))
  api.getStreamSummary.mockResolvedValue(null)
  api.getSyncStatus.mockResolvedValue(null)
  api.watchAnalyticsChannel.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  focusManager.setFocused(undefined)
  vi.useRealTimers()
})

describe('AnalyticsConsole live session opened before its first minute (CX-3)', () => {
  it('hosted shape (frozen backend): the first minutes reach the page without a tab return', async () => {
    const c = clock()
    api.getAnalyticsStreams.mockImplementation(async () => listAnswer(c))
    api.getAnalyticsStream.mockImplementation(async () => hostedDetail(c))
    api.getStreamMinutesTail.mockImplementation(async (_id: string, afterOffset: number) => tailAnswer(c, afterOffset))
    renderConsole('/analytics/xqc/202')

    await waitFor(() => expect(api.getAnalyticsStream).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(chatTile()).not.toBeNull())
    expect(chatTile()).not.toBe('30')

    await letPollsRun(4)
    // The status poll ran the whole time; it carries no minutes.
    expect(api.getStreamStatus.mock.calls.length).toBeGreaterThan(1)
    await waitFor(() => expect(chatTile()).toBe('30'), { timeout: 1500 })
  })

  it('contract shape (confirmed live, no minute yet): the first minutes reach the page', async () => {
    const c = clock()
    api.getAnalyticsStreams.mockImplementation(async () => listAnswer(c))
    api.getAnalyticsStream.mockImplementation(async () => contractDetail(c))
    api.getStreamMinutesTail.mockImplementation(async (_id: string, afterOffset: number) => tailAnswer(c, afterOffset))
    renderConsole('/analytics/xqc/202')

    await waitFor(() => expect(api.getAnalyticsStream).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(chatTile()).not.toBeNull())
    expect(chatTile()).not.toBe('30')

    await letPollsRun(4)
    await waitFor(() => expect(chatTile()).toBe('30'), { timeout: 1500 })
  })

  it('contract shape after the channel-route redirect: the reused live frame reaches its first minutes', async () => {
    const c = clock()
    api.getAnalyticsStreams.mockImplementation(async () => listAnswer(c))
    api.getAnalyticsLive.mockImplementation(async () => contractDetail(c))
    api.getStreamMinutesTail.mockImplementation(async (_id: string, afterOffset: number) => tailAnswer(c, afterOffset))
    renderConsole('/analytics/xqc')

    await waitFor(() => expect(screen.getByTestId('path').textContent).toBe('/analytics/xqc/202'))
    await waitFor(() => expect(chatTile()).not.toBeNull())
    expect(chatTile()).not.toBe('30')

    await letPollsRun(4)
    await waitFor(() => expect(chatTile()).toBe('30'), { timeout: 1500 })
  })

  it('does not read an ended session with no minutes again', async () => {
    const c = clock(180)
    api.getAnalyticsStreams.mockImplementation(async () => listAnswer(c))
    api.getAnalyticsStream.mockImplementation(async () => ({ ...contractDetail(c, 'confirmed_ended'), rollups: [], momentRollups: undefined }))
    api.getStreamMinutesTail.mockImplementation(async (_id: string, afterOffset: number) => tailAnswer(c, afterOffset))
    renderConsole('/analytics/xqc/202')

    await waitFor(() => expect(api.getAnalyticsStream).toHaveBeenCalledTimes(1))
    await letPollsRun(4)
    expect(api.getAnalyticsStream).toHaveBeenCalledTimes(1)
    expect(api.getStreamMinutesTail).not.toHaveBeenCalled()
  })

  it('stops reading again after 20 reads when no minute comes', async () => {
    const c = { ...clock(), arriveAt: Number.POSITIVE_INFINITY }
    api.getAnalyticsStreams.mockImplementation(async () => listAnswer(c))
    api.getAnalyticsStream.mockImplementation(async () => hostedDetail(c))
    renderConsole('/analytics/xqc/202')

    await waitFor(() => expect(api.getAnalyticsStream).toHaveBeenCalledTimes(1))
    await letPollsRun(30)
    // The first read and 20 more; focus and Refresh data still read it.
    expect(api.getAnalyticsStream).toHaveBeenCalledTimes(21)
    expect(api.getStreamMinutesTail).not.toHaveBeenCalled()
  })

  it('does not read again while the tab is hidden', async () => {
    const c = clock()
    api.getAnalyticsStreams.mockImplementation(async () => listAnswer(c))
    api.getAnalyticsStream.mockImplementation(async () => hostedDetail(c))
    renderConsole('/analytics/xqc/202')

    await waitFor(() => expect(api.getAnalyticsStream).toHaveBeenCalledTimes(1))
    focusManager.setFocused(false)
    await letPollsRun(4)
    expect(api.getAnalyticsStream).toHaveBeenCalledTimes(1)
  })
})
