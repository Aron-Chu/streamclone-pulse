import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalyticsConsole } from './AnalyticsConsole.tsx'

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
  default: ({ selectedRollup }: { selectedRollup?: { minuteTs?: string } | null }) => (
    <div data-testid="analytics-chart" data-selected-minute={selectedRollup?.minuteTs ?? ''} />
  ),
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
vi.mock('./analytics/MomentReviewPanel.tsx', () => ({ MomentReviewPanel: () => null }))
vi.mock('./analytics/PastBroadcastBanner.tsx', () => ({ PastBroadcastBanner: () => <div>Past broadcast</div> }))
vi.mock('./analytics/SessionRecapMomentsStrip.tsx', () => ({ SessionRecapMomentsStrip: () => null }))
vi.mock('./analytics/StreamRecapPanel.tsx', () => ({ StreamRecapPanel: () => null }))
vi.mock('./analytics/SyncStatusPanel.tsx', () => ({ SyncStatusPanel: () => null }))
vi.mock('./analytics/StreamQualityBanner.tsx', () => ({ StreamQualityBanner: () => null }))

const streamId = 'stream_fixture_v1'
const firstMinute = '2026-07-11T18:00:00.000Z'
const peakMinute = '2026-07-11T18:04:00.000Z'

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

function detail(overrides: Record<string, unknown> = {}) {
  return {
    channel: 'denims',
    state: 'historical',
    stream: {
      streamId,
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
    ...overrides,
  }
}

const recap = {
  streamId,
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

function renderConsole(route = `/analytics/denims/${streamId}`) {
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
    items: [{ streamId, login: 'denims', startedAt: firstMinute, viewerSamples: 2, chatMessages: 30 }],
    sources: [],
    updatedAt: Date.now(),
  })
  api.getChannelStreamHistory.mockResolvedValue({ items: [] })
  api.getAnalyticsStream.mockResolvedValue(detail())
  api.getPulseStreamRecap.mockResolvedValue(recap)
  api.getStreamGameSegments.mockResolvedValue([])
  api.getSyncStatus.mockResolvedValue(null)
  api.getStreamSummary.mockResolvedValue(null)
  api.getReplayHeatmap.mockResolvedValue(null)
  api.watchAnalyticsChannel.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
})

describe('AnalyticsConsole session signal tape', () => {
  it('E1: does not mount a tape on the live route', () => {
    renderConsole('/analytics/denims')

    expect(screen.queryByRole('region', { name: 'Session signals' })).toBeNull()
  })

  it('E2/E4: keeps the tape absent for loading and hard errors without cached detail', async () => {
    api.getAnalyticsStream.mockImplementation(() => new Promise(() => undefined))
    const loading = renderConsole()
    expect(screen.queryByRole('region', { name: 'Session signals' })).toBeNull()
    loading.unmount()

    api.getAnalyticsStream.mockRejectedValue(new Error('detail request failed'))
    renderConsole()

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Unable to load session data')
    })
    expect(screen.queryByRole('region', { name: 'Session signals' })).toBeNull()
    expect(screen.queryByText('stats only')).toBeNull()
  })

  it('E5: renders coverage only when active minutes are unavailable', async () => {
    api.getAnalyticsStream.mockResolvedValue(detail({ minutesUnavailable: true, rollups: [] }))

    renderConsole()

    expect(await screen.findByRole('region', { name: 'Session signals' })).not.toBeNull()
    expect(screen.getByText('Chat coverage')).not.toBeNull()
    expect(screen.queryByRole('button', { name: /confirmed peak/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /change/i })).toBeNull()
  })

  it('E6: remounting a different session resets the tape instance', async () => {
    const first = renderConsole()
    const firstChip = await screen.findByRole('button', { name: /confirmed peak/i })
    fireEvent.click(firstChip)
    expect(firstChip.getAttribute('aria-pressed')).toBe('true')
    first.unmount()

    const nextStreamId = 'stream_fixture_v2'
    api.getAnalyticsStreams.mockResolvedValue({
      channel: 'denims',
      items: [{ streamId: nextStreamId, login: 'denims', startedAt: firstMinute, viewerSamples: 2, chatMessages: 30 }],
      sources: [],
      updatedAt: Date.now(),
    })
    api.getAnalyticsStream.mockResolvedValue(detail({
      stream: { streamId: nextStreamId, login: 'denims', startedAt: firstMinute },
    }))
    api.getPulseStreamRecap.mockResolvedValue({ ...recap, streamId: nextStreamId })

    renderConsole(`/analytics/denims/${nextStreamId}`)

    const nextChip = await screen.findByRole('button', { name: /confirmed peak/i })
    expect(nextChip.getAttribute('aria-pressed')).toBe('false')
  })

  it('C: selects the tape minute exactly and never toggles it off', async () => {
    renderConsole()

    const chip = await screen.findByRole('button', { name: /confirmed peak/i })
    fireEvent.click(chip)
    expect(screen.getByTestId('analytics-chart').getAttribute('data-selected-minute')).toBe(peakMinute)

    fireEvent.click(chip)
    expect(screen.getByTestId('analytics-chart').getAttribute('data-selected-minute')).toBe(peakMinute)
  })
})
