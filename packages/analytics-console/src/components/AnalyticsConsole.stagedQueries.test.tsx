import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalyticsConsole } from './AnalyticsConsole.tsx'

const api = vi.hoisted(() => ({
  getAnalyticsStream: vi.fn(),
  getAnalyticsStreams: vi.fn(),
  getChannelStreamHistory: vi.fn(),
  getPulseStreamRecap: vi.fn(),
  getStreamGameSegments: vi.fn(),
  getSyncStatus: vi.fn(),
  getStreamSummary: vi.fn(),
  getReplayHeatmap: vi.fn(),
  startHistoricalSync: vi.fn(),
  watchAnalyticsChannel: vi.fn(),
}))

vi.mock('../api.ts', () => api)
vi.mock('../hooks/useAnalyticsLive.ts', () => ({
  useAnalyticsLive: () => ({
    data: undefined,
    isLoading: false,
    refetch: vi.fn(),
  }),
}))
vi.mock('./analytics/AnalyticsChart.tsx', () => ({
  default: () => <div data-testid="analytics-chart">Chart</div>,
}))
vi.mock('./analytics/ConsoleBits.tsx', () => ({
  ChatCoverageBadge: () => null,
  StatCard: () => null,
  ViewerSourceBadge: () => null,
  AnalyticsQualityChip: () => null,
  CoverageFacets: () => null,
  CoverageStartBanner: () => null,
  VodAvailabilityChip: () => null,
}))
vi.mock('./analytics/StreamSidebar.tsx', () => ({ StreamSidebar: () => <div>Stream rail</div> }))
vi.mock('./analytics/TopEmoteTable.tsx', () => ({ TopEmoteTable: () => null }))
vi.mock('./analytics/MomentReviewPanel.tsx', () => ({
  MomentReviewPanel: () => <div>Moment details</div>,
}))
vi.mock('./analytics/PastBroadcastBanner.tsx', () => ({ PastBroadcastBanner: () => null }))
vi.mock('./analytics/SessionRecapMomentsStrip.tsx', () => ({ SessionRecapMomentsStrip: () => null }))
vi.mock('./analytics/StreamRecapPanel.tsx', () => ({ StreamRecapPanel: () => <div>Recap</div> }))
vi.mock('./analytics/SyncStatusPanel.tsx', () => ({ SyncStatusPanel: () => <div>Sync</div> }))
vi.mock('./analytics/StreamQualityBanner.tsx', () => ({ StreamQualityBanner: () => null }))
vi.mock('./signals/SessionSignalTape.tsx', () => ({ SessionSignalTape: () => null }))

const streamId = 'staged-stream'
const startedAt = '2026-07-16T18:00:00.000Z'

const detail = {
  channel: 'xqc',
  state: 'historical',
  stream: {
    streamId,
    login: 'xqc',
    displayName: 'xQc',
    title: 'Staging fixture',
    startedAt,
    endedAt: '2026-07-16T19:00:00.000Z',
  },
  rollups: [{
    minuteTs: '2026-07-16T18:01:00.000Z',
    viewerAvg: 100,
    viewerSamples: 1,
    chatCount: 10,
    totalEmoteCount: 2,
  }],
  topEmotes: [],
  sources: [],
  updatedAt: Date.now(),
}

function renderConsole(layer2LoadMode: 'eager' | 'staged' = 'eager') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/analytics/xqc/${streamId}`]}>
        <Routes>
          <Route
            path="/analytics/:login/:streamId"
            element={<AnalyticsConsole layer2LoadMode={layer2LoadMode} />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  api.getAnalyticsStreams.mockResolvedValue({
    items: [{
      streamId,
      login: 'xqc',
      startedAt,
      viewerSamples: 1,
      chatMessages: 10,
    }],
  })
  api.getChannelStreamHistory.mockResolvedValue({ items: [] })
  api.getAnalyticsStream.mockResolvedValue(detail)
  api.getPulseStreamRecap.mockResolvedValue({ streamId, topMoments: [] })
  api.getStreamGameSegments.mockResolvedValue([])
  api.getSyncStatus.mockResolvedValue(null)
  api.getStreamSummary.mockResolvedValue({ metrics: {} })
  api.getReplayHeatmap.mockResolvedValue({ points: [] })
  api.watchAnalyticsChannel.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
})

describe('AnalyticsConsole staged Layer 2 queries', () => {
  it('keeps eager mode as the package default', async () => {
    renderConsole()

    await waitFor(() => {
      expect(api.getPulseStreamRecap).toHaveBeenCalledWith(streamId)
      expect(api.getStreamSummary).toHaveBeenCalled()
      expect(api.getReplayHeatmap).toHaveBeenCalled()
      expect(api.getSyncStatus).toHaveBeenCalledWith(streamId)
    })
  })

  it('loads summary and recap first without initial heatmap or sync requests in staged mode', async () => {
    renderConsole('staged')

    await waitFor(() => {
      expect(api.getPulseStreamRecap).toHaveBeenCalledWith(streamId)
      expect(api.getStreamSummary).toHaveBeenCalled()
    })
    expect(api.getReplayHeatmap).not.toHaveBeenCalled()
    expect(api.getSyncStatus).not.toHaveBeenCalled()
  })

  it('enables heatmap and sync immediately after explicit tab engagement', async () => {
    renderConsole('staged')

    expect(await screen.findByRole('heading', { name: 'Staging fixture' })).not.toBeNull()
    expect(screen.getByTestId('analytics-chart')).not.toBeNull()
    expect(api.getReplayHeatmap).not.toHaveBeenCalled()
    expect(api.getSyncStatus).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Status' }))
    await waitFor(() => {
      expect(api.getSyncStatus).toHaveBeenCalledWith(streamId)
    })
    expect(api.getReplayHeatmap).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Moments' }))
    await waitFor(() => {
      expect(api.getReplayHeatmap).toHaveBeenCalled()
    })

    api.getReplayHeatmap.mockClear()
    api.getSyncStatus.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh data' }))
    await waitFor(() => {
      expect(api.getReplayHeatmap).toHaveBeenCalled()
      expect(api.getSyncStatus).toHaveBeenCalled()
    })
  })

  it('does not force never-enabled staged queries during Refresh data', async () => {
    renderConsole('staged')

    await waitFor(() => {
      expect(api.getPulseStreamRecap).toHaveBeenCalled()
      expect(api.getStreamSummary).toHaveBeenCalled()
    })
    api.getReplayHeatmap.mockClear()
    api.getSyncStatus.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh data' }))
    await waitFor(() => {
      expect(api.getAnalyticsStream).toHaveBeenCalledTimes(2)
    })
    expect(api.getReplayHeatmap).not.toHaveBeenCalled()
    expect(api.getSyncStatus).not.toHaveBeenCalled()
  })
})
