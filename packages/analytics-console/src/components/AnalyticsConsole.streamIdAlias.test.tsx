import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalyticsConsole } from './AnalyticsConsole.tsx'

const listStreamId = 'list-a'
const canonicalStreamId = 'canonical-b'
const firstMinute = '2026-07-11T18:00:00.000Z'
const peakMinute = '2026-07-11T18:04:00.000Z'

const api = vi.hoisted(() => ({
  getAnalyticsStream: vi.fn(),
  getAnalyticsStreams: vi.fn(),
  getChannelStreamHistory: vi.fn(),
  getPulseStreamRecap: vi.fn(),
  getAnalyticsLive: vi.fn(),
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
  default: () => <div data-testid="analytics-chart" />,
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
vi.mock('./analytics/StreamSidebar.tsx', () => ({ StreamSidebar: () => null }))
vi.mock('./analytics/TopEmoteTable.tsx', () => ({ TopEmoteTable: () => null }))
vi.mock('./analytics/MomentReviewPanel.tsx', () => ({
  MomentReviewPanel: () => <div>Top Moments</div>,
}))
vi.mock('./analytics/PastBroadcastBanner.tsx', () => ({ PastBroadcastBanner: () => null }))
vi.mock('./analytics/SessionRecapMomentsStrip.tsx', () => ({
  SessionRecapMomentsStrip: () => <div>Pulse Moments</div>,
}))
vi.mock('./analytics/StreamRecapPanel.tsx', () => ({
  StreamRecapPanel: () => <div>Stream Recap</div>,
}))
vi.mock('./analytics/SyncStatusPanel.tsx', () => ({ SyncStatusPanel: () => null }))
vi.mock('./analytics/StreamQualityBanner.tsx', () => ({ StreamQualityBanner: () => null }))

const rollups = [
  {
    minuteTs: firstMinute,
    chatCount: 10,
    totalEmoteCount: 4,
    viewerAvg: 100,
    viewerSamples: 2,
    signalObservations: {
      chat: { state: 'measured', observedAt: firstMinute, coveragePct: 100, source: 'live' },
      emotes: { state: 'measured', observedAt: firstMinute, coveragePct: 100, source: 'live' },
      viewers: { state: 'measured', observedAt: firstMinute, source: 'helix' },
    },
  },
  {
    minuteTs: peakMinute,
    chatCount: 30,
    totalEmoteCount: 12,
    viewerAvg: 125,
    viewerSamples: 2,
    signalObservations: {
      chat: { state: 'measured', observedAt: peakMinute, coveragePct: 100, source: 'live' },
      emotes: { state: 'measured', observedAt: peakMinute, coveragePct: 100, source: 'live' },
      viewers: { state: 'measured', observedAt: peakMinute, source: 'helix' },
    },
  },
]

function aliasedDetail() {
  return {
    channel: 'denims',
    state: 'historical',
    stream: {
      streamId: canonicalStreamId,
      login: 'denims',
      startedAt: firstMinute,
      endedAt: '2026-07-11T20:00:00.000Z',
    },
    rollups,
    momentRollups: rollups,
    topEmotes: [],
    sources: [],
    updatedAt: Date.now(),
    chatCoveragePct: 82,
    chatCoverage: { coveragePct: 82, partial: true },
    signalWatermarks: {
      chat: { state: 'current', observedThrough: peakMinute, source: 'live' },
      emotes: { state: 'current', observedThrough: peakMinute, source: 'live' },
      viewers: { state: 'current', observedThrough: peakMinute, source: 'helix' },
    },
  }
}

const aliasedRecap = {
  streamId: canonicalStreamId,
  topMoments: [{
    offsetSeconds: 240,
    score: 88,
    peakObservation: {
      state: 'measured',
      observedAt: peakMinute,
      confirmed: true,
      detector: 'heatmap:chat_spike',
      value: 88,
    },
  }],
}

function renderConsole(route = `/analytics/denims/${listStreamId}`) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
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
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })
})

beforeEach(() => {
  vi.clearAllMocks()
  api.getAnalyticsStreams.mockResolvedValue({
    channel: 'denims',
    items: [{
      streamId: listStreamId,
      login: 'denims',
      startedAt: firstMinute,
      viewerSamples: 2,
      chatMessages: 30,
    }],
    sources: [],
    updatedAt: Date.now(),
  })
  api.getChannelStreamHistory.mockResolvedValue({ items: [] })
  api.getAnalyticsStream.mockResolvedValue(aliasedDetail())
  api.getPulseStreamRecap.mockResolvedValue(aliasedRecap)
  api.getStreamGameSegments.mockResolvedValue([])
  api.getSyncStatus.mockResolvedValue(null)
  api.getStreamSummary.mockResolvedValue(null)
  api.getReplayHeatmap.mockResolvedValue(null)
  api.watchAnalyticsChannel.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
})

describe('AnalyticsConsole hosted stream-id alias', () => {
  it('accepts recap and mounts session tape when detail remaps list id to canonical id', async () => {
    renderConsole()

    await waitFor(() => {
      expect(api.getAnalyticsStream).toHaveBeenCalledWith(
        listStreamId,
        expect.objectContaining({ channel: 'denims' }),
      )
    })

    expect(await screen.findByText('Stream Recap')).not.toBeNull()
    expect(screen.getByText('Pulse Moments')).not.toBeNull()
    expect(screen.queryByText('Top Moments')).toBeNull()

    expect(await screen.findByRole('region', { name: 'Session signals' })).not.toBeNull()
    expect(screen.getByRole('button', { name: /confirmed peak/i })).not.toBeNull()
  })
})
