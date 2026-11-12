import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalyticsConsole } from './AnalyticsConsole.tsx'

// (fix, 10-30) VOD-1: a live session page kept the plot, tiles and table at
// its first read. Each 30 s tail poll asked after the same offset, and after
// the channel-route redirect the live frame had no observer left to refresh it.

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
// A pinned clock on a whole minute, so offsets are exact: the stream started an hour before it.
const NOW = Date.parse('2026-10-30T08:00:00.000Z')
const startedMs = NOW - 60 * MINUTE
const startedAt = new Date(startedMs).toISOString()
const at = (offsetSeconds: number) => new Date(startedMs + offsetSeconds * 1000).toISOString()

function minute(offsetSeconds: number, chatCount: number, viewers = 900) {
  return { minuteTs: at(offsetSeconds), viewerAvg: viewers, viewerLatest: viewers, viewerSamples: viewers > 0 ? 1 : 0, chatCount }
}

function liveDetail(minutes: ReturnType<typeof minute>[], updatedAt = Date.now()) {
  return {
    channel: 'xqc',
    state: 'live',
    stream: { streamId: '202', login: 'xqc', title: 'Live broadcast', startedAt, lifecycleState: 'confirmed_live' },
    rollups: minutes,
    momentRollups: minutes,
    topEmotes: [],
    sources: [],
    updatedAt,
  }
}

function tail(minutes: ReturnType<typeof minute>[]) {
  return { channel: 'xqc', state: 'live', rollups: minutes, topEmotes: [], sources: [], updatedAt: Date.now() }
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

// What the next interval poll does: refetch the tail query that is on screen.
async function pollTail(client: QueryClient) {
  await act(() => client.refetchQueries({ queryKey: ['analytics-console-minutes-tail'], type: 'active' }))
}

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  })
})

beforeEach(() => {
  // Only Date is faked (it moves on in real time); the query timers stay real.
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
  vi.setSystemTime(NOW)
  vi.clearAllMocks()
  api.getAnalyticsStreams.mockImplementation(() => new Promise(() => undefined))
  api.getAnalyticsLive.mockImplementation(() => new Promise(() => undefined))
  api.getAnalyticsStream.mockResolvedValue(null)
  api.getPulseStreamRecap.mockResolvedValue(null)
  api.getReplayHeatmap.mockResolvedValue(null)
  api.getStreamGameSegments.mockResolvedValue([])
  api.getStreamMinutesTail.mockResolvedValue(null)
  api.getStreamStatus.mockResolvedValue(null)
  api.getStreamSummary.mockResolvedValue(null)
  api.getSyncStatus.mockResolvedValue(null)
  api.watchAnalyticsChannel.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('AnalyticsConsole live tail (VOD-1)', () => {
  it('asks each poll after the newest merged minute, so the tiles advance', async () => {
    api.getAnalyticsStream.mockResolvedValue(liveDetail([minute(3300, 10), minute(3360, 20)]))
    api.getStreamMinutesTail
      .mockResolvedValueOnce(tail([minute(3360, 25), minute(3420, 5, 0)]))
      .mockResolvedValueOnce(tail([minute(3420, 30), minute(3480, 4, 0)]))
      .mockResolvedValue(tail([minute(3480, 4, 0)]))
    const client = renderConsole('/analytics/xqc/202')

    await waitFor(() => expect(api.getStreamMinutesTail).toHaveBeenCalledWith('202', 3360))
    await waitFor(() => expect(document.querySelector('[data-stat-label="Chat messages"]')?.textContent).toBe('40'))
    await pollTail(client)
    expect(api.getStreamMinutesTail).toHaveBeenLastCalledWith('202', 3420)
    await waitFor(() => expect(document.querySelector('[data-stat-label="Chat messages"]')?.textContent).toBe('69'))
    await pollTail(client)
    expect(api.getStreamMinutesTail).toHaveBeenLastCalledWith('202', 3480)
  })

  it('says "Updated" at the newest merged minute, not at the read time', async () => {
    // Data stopped ten minutes ago; the read itself is fresh.
    api.getAnalyticsStream.mockResolvedValue(liveDetail([minute(2940, 10), minute(3000, 20)]))
    renderConsole('/analytics/xqc/202')
    await screen.findByTestId('analytics-chart')
    await waitFor(() => expect(document.querySelector('[data-stat-label="Chat messages"]')?.textContent).toBe('30'))
    const updated = document.querySelector('[data-session-updated]')?.textContent
    expect(updated).toContain('Updated 10m ago')
    expect(updated).not.toContain('Updated 1m ago')
  })

  it('keeps refreshing after the channel route redirects to the live session', async () => {
    api.getAnalyticsLive.mockResolvedValue(liveDetail([minute(3300, 10), minute(3360, 20)]))
    api.getStreamMinutesTail
      .mockResolvedValueOnce(tail([minute(3360, 25), minute(3420, 5, 0)]))
      .mockResolvedValue(tail([minute(3420, 30), minute(3480, 4, 0)]))
    const client = renderConsole('/analytics/xqc')

    await waitFor(() => expect(screen.getByTestId('path').textContent).toBe('/analytics/xqc/202'))
    await waitFor(() => expect(api.getStreamMinutesTail).toHaveBeenCalledWith('202', 3360))
    await pollTail(client)
    expect(api.getStreamMinutesTail).toHaveBeenLastCalledWith('202', 3420)

    // A tab return (any active refetch) reaches the live frame the page now reads.
    const liveReads = api.getAnalyticsLive.mock.calls.length
    await act(() => client.invalidateQueries({ queryKey: ['analytics-live', 'xqc'] }))
    expect(api.getAnalyticsLive.mock.calls.length).toBe(liveReads + 1)
  })
})

// (fix, 10-30) GP-3: stream 316705728883 was never closed by the backend and
// carries the channel's current viewers; the channel list holds a newer stream.
describe('AnalyticsConsole on a superseded open stream (GP-3)', () => {
  const oldStartedAt = new Date(NOW - 46 * 60 * MINUTE).toISOString()
  const newerStartedAt = new Date(NOW - 3 * 60 * MINUTE).toISOString()

  function staleOpenDetail() {
    return {
      channel: 'yuyuta0702',
      state: 'live',
      // A raw row: no lifecycle contract, the channel's viewers copied onto it.
      stream: { streamId: '316705728883', login: 'yuyuta0702', startedAt: oldStartedAt, currentViewers: 4740, viewerSamples: 1, vodId: '2912916877' },
      rollups: [{ minuteTs: oldStartedAt, viewerAvg: 4740, viewerSamples: 1, chatCount: 493 }],
      topEmotes: [],
      sources: [],
      updatedAt: Date.now(),
    }
  }

  it('stops the live tail poll when the channel list has a newer stream', async () => {
    api.getAnalyticsStreams.mockResolvedValue({
      channel: 'yuyuta0702',
      items: [
        { streamId: '316655688306', login: 'yuyuta0702', startedAt: newerStartedAt, currentViewers: 10682, viewerSamples: 1, title: 'Newer broadcast' },
        { streamId: '316705728883', login: 'yuyuta0702', startedAt: oldStartedAt, currentViewers: 4740, viewerSamples: 1, title: 'Old broadcast' },
      ],
      sources: [],
      updatedAt: Date.now(),
    })
    api.getAnalyticsStream.mockResolvedValue(staleOpenDetail())
    const client = renderConsole('/analytics/yuyuta0702/316705728883')
    await screen.findByTestId('analytics-chart')
    await waitFor(() => expect(api.getAnalyticsStreams).toHaveBeenCalled())
    await waitFor(() => expect(api.getAnalyticsStream).toHaveBeenCalled())
    await waitFor(() => expect(document.querySelector('[data-session-updated]')?.textContent).toMatch(/Updated \d+m ago/))

    api.getStreamMinutesTail.mockClear()
    await pollTail(client)
    expect(api.getStreamMinutesTail).not.toHaveBeenCalled()
    // The header names the read time, not a live minute.
    expect(document.querySelector('[data-session-updated]')?.textContent).toContain('Updated 1m ago')
  })
})
