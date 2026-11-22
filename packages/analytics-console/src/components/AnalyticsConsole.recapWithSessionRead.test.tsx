import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalyticsConsole } from './AnalyticsConsole.tsx'

// A session route that names its stream key (any key shape, not a date) has
// the Moments recap read beside the session read instead of after it. Nothing
// from the recap shows until the session read has confirmed the creator.

const api = vi.hoisted(() => ({
  getAnalyticsStream: vi.fn(),
  getAnalyticsStreams: vi.fn(),
  getChannelStreamHistory: vi.fn(),
  getPulseStreamRecap: vi.fn(),
  getStreamGameSegments: vi.fn(),
  getSyncStatus: vi.fn(),
  getStreamSummary: vi.fn(),
  getStreamStatus: vi.fn(),
  getStreamMinutesTail: vi.fn(),
  getReplayHeatmap: vi.fn(),
  startHistoricalSync: vi.fn(),
  watchAnalyticsChannel: vi.fn(),
}))

vi.mock('../api.ts', () => api)
vi.mock('../hooks/useAnalyticsLive.ts', () => ({
  useAnalyticsLive: () => ({ data: undefined, isLoading: false, refetch: vi.fn() }),
}))
vi.mock('../utils/recapMomentsAvailable.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/recapMomentsAvailable.ts')>()),
  hasRecapMomentsAvailable: (recap: { topMoments?: unknown[] }) => (recap?.topMoments?.length ?? 0) > 0,
}))
vi.mock('./analytics/AnalyticsChart.tsx', () => ({ default: () => <div data-testid="analytics-chart">Chart</div> }))
vi.mock('./analytics/ConsoleBits.tsx', () => ({
  DataQualityButton: () => null,
  ChatCoverageBadge: () => null,
  StatCard: () => null,
  ViewerSourceBadge: () => null,
  AnalyticsQualityChip: () => null,
  CoverageFacets: () => null,
  CoverageStartMetaItem: () => null,
  VodAvailabilityChip: () => null,
}))
vi.mock('./analytics/StreamSidebar.tsx', () => ({ StreamSidebar: () => <div>Stream rail</div> }))
vi.mock('./analytics/TopEmoteTable.tsx', () => ({ TopEmoteTable: () => null }))
vi.mock('./analytics/MomentReviewPanel.tsx', () => ({ MomentReviewPanel: () => null }))
vi.mock('./analytics/PastBroadcastBanner.tsx', () => ({ SessionLifecycleMeta: () => null }))
vi.mock('./analytics/SessionRecapMomentsStrip.tsx', () => ({
  SessionRecapMomentsStrip: () => <div data-testid="recap-strip" />,
}))
vi.mock('./analytics/StreamRecapPanel.tsx', () => ({ StreamRecapPanel: () => null }))
vi.mock('./analytics/SyncStatusPanel.tsx', () => ({ SyncStatusPanel: () => null }))
vi.mock('./analytics/StreamQualityBanner.tsx', () => ({ StreamQualityBanner: () => null }))
vi.mock('./signals/SessionSignalTape.tsx', () => ({ SessionSignalTape: () => null }))

const streamId = '321303476060'
const startedAt = '2026-07-16T18:00:00.000Z'
const detail = {
  channel: 'xqc',
  state: 'historical',
  stream: {
    streamId,
    login: 'xqc',
    displayName: 'xQc',
    title: 'Numeric fixture',
    startedAt,
    endedAt: '2026-07-16T19:00:00.000Z',
  },
  rollups: [{ minuteTs: '2026-07-16T18:01:00.000Z', viewerAvg: 100, viewerSamples: 1, chatCount: 10, totalEmoteCount: 2 }],
  topEmotes: [],
  sources: [],
  updatedAt: Date.now(),
}
const recap = { streamId, topMoments: [{ offsetSeconds: 60, score: 88 }] }

function renderConsole(entry = `/analytics/xqc/${streamId}`) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/analytics/:login/:streamId?" element={<AnalyticsConsole layer2LoadMode="staged" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

beforeEach(() => {
  vi.clearAllMocks()
  api.getAnalyticsStreams.mockResolvedValue({ items: [{ streamId, login: 'xqc', startedAt, viewerSamples: 1, chatMessages: 10 }] })
  api.getChannelStreamHistory.mockResolvedValue({ items: [] })
  api.getAnalyticsStream.mockResolvedValue(detail)
  api.getPulseStreamRecap.mockResolvedValue(recap)
  api.getStreamGameSegments.mockResolvedValue([])
  api.getSyncStatus.mockResolvedValue(null)
  api.getStreamSummary.mockResolvedValue({ metrics: {} })
  api.getStreamStatus.mockResolvedValue(null)
  api.getStreamMinutesTail.mockResolvedValue(null)
  api.getReplayHeatmap.mockResolvedValue({ points: [] })
  api.watchAnalyticsChannel.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
})

describe('AnalyticsConsole recap read beside the session read', () => {
  // A prefixed key stands for a non-Twitch stream key; the link shape is not
  // final. Route resolution takes only a digits-only key straight from the URL,
  // so a prefixed key is listed first (the session read waits on that too).
  it.each([
    ['a numeric stream id', streamId],
    ['a prefixed stream key', 'kick:98765'],
  ])('reads the recap while the session read is still out on a route naming %s', async (_shape, key) => {
    api.getAnalyticsStreams.mockResolvedValue({ items: [{ streamId: key, login: 'xqc', startedAt, viewerSamples: 1, chatMessages: 10 }] })
    api.getAnalyticsStream.mockImplementation(() => new Promise(() => undefined))
    renderConsole(`/analytics/xqc/${key}`)

    // Keyed by the full stream key from the route, never by login.
    await waitFor(() => expect(api.getPulseStreamRecap).toHaveBeenCalledWith(key))
    // The summary still waits for the session read.
    expect(api.getStreamSummary).not.toHaveBeenCalled()
  })

  it('shows nothing from a recap that answers first until the session read lands', async () => {
    const session = deferred<typeof detail>()
    api.getAnalyticsStream.mockImplementation(() => session.promise)
    renderConsole()

    await waitFor(() => expect(api.getPulseStreamRecap).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByTestId('recap-strip')).toBeNull()
    expect(document.querySelector('[data-moments-fallback-notice]')).toBeNull()

    session.resolve(detail)
    expect(await screen.findByTestId('recap-strip')).toBeTruthy()
  })

  it('never shows the recap of a session that belongs to another creator', async () => {
    api.getAnalyticsStream.mockResolvedValue({ ...detail, stream: { ...detail.stream, login: 'zchum', title: 'Other creator broadcast' } })
    renderConsole()

    expect((await screen.findByRole('alert')).textContent).toContain('Session not found')
    await waitFor(() => expect(api.getPulseStreamRecap).toHaveBeenCalled())
    expect(screen.queryByTestId('recap-strip')).toBeNull()
    expect(screen.queryByText('Other creator broadcast')).toBeNull()
    expect(api.getStreamSummary).not.toHaveBeenCalled()
  })

  it('keeps a date route waiting for the session read', async () => {
    api.getAnalyticsStream.mockImplementation(() => new Promise(() => undefined))
    renderConsole('/analytics/xqc/2026-07-16')

    await waitFor(() => expect(api.getAnalyticsStream).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(api.getPulseStreamRecap).not.toHaveBeenCalled()
  })
})
