import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalyticsConsole } from './AnalyticsConsole.tsx'

// The channel route opens the live session as soon as the live read names it;
// it does not wait for the channel's 100-stream list (~18 s on a slow API).

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
  StatCard: () => null,
  CoverageStartMetaItem: () => null,
}))
vi.mock('./analytics/MomentReviewPanel.tsx', () => ({ MomentReviewPanel: () => null }))
vi.mock('./analytics/PastBroadcastBanner.tsx', () => ({ SessionLifecycleMeta: () => null }))
vi.mock('./analytics/StreamQualityBanner.tsx', () => ({ StreamQualityBanner: () => null }))
vi.mock('./analytics/TopEmoteTable.tsx', () => ({ TopEmoteTable: () => null }))

const startedAt = new Date(Date.now() - 60 * 60_000).toISOString()

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
