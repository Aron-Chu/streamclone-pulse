import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalyticsConsole } from './AnalyticsConsole.tsx'

// The channel route opens the live session, or the channel's measured ended stream,
// as soon as the live read names it; it does not wait for the channel's 100-stream
// list (~14-18 s on a slow API).

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
  StatCard: ({ label }: { label: string }) => <div data-stat-label>{label}</div>,
  CoverageStartMetaItem: () => null,
}))
vi.mock('./analytics/MomentReviewPanel.tsx', () => ({ MomentReviewPanel: () => null }))
vi.mock('./analytics/PastBroadcastBanner.tsx', () => ({ SessionLifecycleMeta: () => null }))
vi.mock('./analytics/StreamQualityBanner.tsx', () => ({ StreamQualityBanner: () => null }))
vi.mock('./analytics/TopEmoteTable.tsx', () => ({ TopEmoteTable: () => null }))

const startedAt = new Date(Date.now() - 60 * 60_000).toISOString()

// The channel's latest stream after it ended, as the hosted live read names it:
// lifecycle unknown, with viewer and chat minutes measured.
function endedLiveRead(stream: Record<string, unknown> = {}, read: Record<string, unknown> = {}) {
  return {
    channel: 'xqc',
    state: 'unknown',
    stream: { streamId: '101', login: 'xqc', title: 'Ended broadcast', startedAt, lifecycleState: 'unknown', viewerSamples: 10, chatMessages: 50, ...stream },
    rollups: [{ minuteTs: startedAt, viewerAvg: 100, viewerSamples: 1, chatCount: 10 }],
    topEmotes: [],
    sources: [],
    updatedAt: Date.now(),
    ...read,
  }
}

function LocationProbe() {
  return <div data-testid="path">{useLocation().pathname}</div>
}

function renderConsole(route: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <LocationProbe />
        <Routes>
          <Route path="/analytics/:login/:streamId?" element={<AnalyticsConsole />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  })
})

beforeEach(() => {
  vi.clearAllMocks()
  // The stream list never settles in these tests.
  api.getAnalyticsStreams.mockImplementation(() => new Promise(() => undefined))
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

afterEach(() => cleanup())

describe('AnalyticsConsole: channel route to the live session', () => {
  it('opens the confirmed live session while the stream list is still loading', async () => {
    api.getAnalyticsLive.mockResolvedValue({
      channel: 'xqc',
      state: 'live',
      stream: { streamId: '202', login: 'xqc', startedAt, lifecycleState: 'confirmed_live' },
      rollups: [],
      topEmotes: [],
      sources: [],
      updatedAt: Date.now(),
    })
    renderConsole('/analytics/xqc')
    await waitFor(() => expect(screen.getByTestId('path').textContent).toBe('/analytics/xqc/202'))
    expect(document.querySelector('[data-stat-label]')?.textContent).toBe('Latest viewers')
  })

  it('opens the channel\'s measured ended stream as soon as the live read names it, before the list answers', async () => {
    api.getAnalyticsLive.mockResolvedValue(endedLiveRead())
    const session = endedLiveRead({ endedAt: startedAt, lifecycleState: 'confirmed_ended' }, { state: 'historical' })
    api.getAnalyticsStream.mockResolvedValue(session)
    renderConsole('/analytics/xqc')

    await waitFor(() => expect(screen.getByTestId('path').textContent).toBe('/analytics/xqc/101'))
    // The session page then loads as when opened directly: its own read, then the recap.
    await waitFor(() => expect(api.getAnalyticsStream).toHaveBeenCalledWith('101', { sparse: false, channel: 'xqc' }))
    await waitFor(() => expect(api.getPulseStreamRecap).toHaveBeenCalledWith('101'))
    expect(document.querySelector('[data-stat-label]')?.textContent).toBe('Latest viewers')
  })

  it('opens it when the stream list failed too', async () => {
    api.getAnalyticsStreams.mockRejectedValue({ kind: 'server', message: 'internal_error', status: 500 })
    api.getAnalyticsLive.mockResolvedValue(endedLiveRead())
    renderConsole('/analytics/xqc')
    await waitFor(() => expect(screen.getByTestId('path').textContent).toBe('/analytics/xqc/101'))
  })

  it.each([
    ['an unmeasured stream', endedLiveRead({ chatMessages: 0 })],
    ['a stream with no minute counts', endedLiveRead({ viewerSamples: undefined, chatMessages: undefined })],
    ['another channel\'s stream', endedLiveRead({ login: 'zchum' })],
    ['a read for another channel', endedLiveRead({}, { channel: 'zchum' })],
    ['an alias of another stream', endedLiveRead({ canonicalStreamId: '100' })],
    ['a stream ID the session page cannot read without the list', endedLiveRead({ streamId: 'pending-101' })],
    ['a channel StreamPulse has not recorded', { channel: 'xqc', state: 'not_collected', rollups: [], topEmotes: [], sources: [], updatedAt: 0 }],
  ])('stays on the channel route until the list answers for %s', async (_case, read) => {
    api.getAnalyticsLive.mockResolvedValue(read)
    renderConsole('/analytics/xqc')
    await waitFor(() => expect(api.getAnalyticsLive).toHaveBeenCalled())
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(screen.getByTestId('path').textContent).toBe('/analytics/xqc')
  })

  it('labels the first figure "Latest viewers" on the channel route, before and after the live read lands', async () => {
    let answer: (read: unknown) => void = () => undefined
    api.getAnalyticsLive.mockImplementation(() => new Promise(resolve => { answer = resolve }))
    renderConsole('/analytics/xqc')
    expect(document.querySelector('[data-stat-label]')?.textContent).toBe('Latest viewers')

    await act(async () => answer(endedLiveRead({ chatMessages: 0 })))
    expect(await screen.findByRole('heading', { name: 'Ended broadcast' })).toBeTruthy()
    expect(screen.getByTestId('path').textContent).toBe('/analytics/xqc')
    expect(document.querySelector('[data-stat-label]')?.textContent).toBe('Latest viewers')
  })

  it('stays on the channel route while only the list could name a session', async () => {
    api.getAnalyticsLive.mockResolvedValue({
      channel: 'xqc',
      state: 'historical',
      stream: { streamId: '101', login: 'xqc', startedAt, endedAt: startedAt, lifecycleState: 'confirmed_ended' },
      rollups: [],
      topEmotes: [],
      sources: [],
      updatedAt: Date.now(),
    })
    renderConsole('/analytics/xqc')
    await waitFor(() => expect(api.getAnalyticsLive).toHaveBeenCalled())
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(screen.getByTestId('path').textContent).toBe('/analytics/xqc')
  })
})
