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
  ChatCoverageBadge: () => <span>Coverage</span>,
  StatCard: () => null,
  ViewerSourceBadge: () => <span>Viewer source</span>,
  AnalyticsQualityChip: () => <span>Quality</span>,
  CoverageFacets: () => null,
  CoverageStartBanner: () => null,
  VodAvailabilityChip: () => null,
}))
vi.mock('./analytics/StreamSidebar.tsx', () => ({
  StreamSidebar: () => <nav data-testid="stream-sidebar">Streams</nav>,
}))
vi.mock('./analytics/TopEmoteTable.tsx', () => ({ TopEmoteTable: () => null }))
vi.mock('./analytics/MomentReviewPanel.tsx', () => ({
  MomentReviewPanel: () => <div>Moment details</div>,
}))
vi.mock('./analytics/PastBroadcastBanner.tsx', () => ({ PastBroadcastBanner: () => null }))
vi.mock('./analytics/SessionRecapMomentsStrip.tsx', () => ({ SessionRecapMomentsStrip: () => null }))
vi.mock('./analytics/StreamRecapPanel.tsx', () => ({ StreamRecapPanel: () => null }))
vi.mock('./analytics/SyncStatusPanel.tsx', () => ({
  SyncStatusPanel: () => <div>Status details</div>,
}))
vi.mock('./analytics/StreamQualityBanner.tsx', () => ({ StreamQualityBanner: () => null }))
vi.mock('./signals/SessionSignalTape.tsx', () => ({ SessionSignalTape: () => null }))

const streamId = 'layout-stream'
const startedAt = '2026-07-16T18:00:00.000Z'
const minuteTs = '2026-07-16T18:01:00.000Z'

function detail() {
  return {
    channel: 'xqc',
    state: 'historical',
    stream: {
      streamId,
      login: 'xqc',
      displayName: 'xQc',
      title: 'Layout fixture',
      category: 'Just Chatting',
      startedAt,
      endedAt: '2026-07-16T19:00:00.000Z',
    },
    rollups: [{
      minuteTs,
      viewerAvg: 100,
      viewerSamples: 1,
      chatCount: 10,
      totalEmoteCount: 2,
    }],
    topEmotes: [],
    sources: [],
    updatedAt: Date.now(),
  }
}

function renderConsole(
  props: {
    enableLayoutControls?: boolean
    layer2LoadMode?: 'eager' | 'staged'
  } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/analytics/xqc/${streamId}`]}>
        <Routes>
          <Route
            path="/analytics/:login/:streamId"
            element={<AnalyticsConsole {...props} />}
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
  api.getAnalyticsStream.mockResolvedValue(detail())
  api.getPulseStreamRecap.mockResolvedValue(null)
  api.getStreamGameSegments.mockResolvedValue([])
  api.getSyncStatus.mockResolvedValue(null)
  api.getStreamSummary.mockResolvedValue(null)
  api.getReplayHeatmap.mockResolvedValue(null)
  api.watchAnalyticsChannel.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
})

describe('AnalyticsConsole opt-in layout controls', () => {
  it('keeps package defaults unchanged when layout controls are omitted', async () => {
    renderConsole()
    expect(await screen.findByRole('heading', { name: 'Layout fixture' })).not.toBeNull()
    expect(await screen.findByTestId('analytics-chart')).not.toBeNull()
    expect(screen.queryByRole('button', { name: /hide streams/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /focus chart/i })).toBeNull()
    expect(screen.getByTestId('stream-sidebar')).not.toBeNull()
    expect(document.querySelector('[data-analytics-console-grid]')).not.toBeNull()
    expect(document.querySelector('[data-analytics-right-column]')).not.toBeNull()
    expect(document.querySelector('[data-session-details-tabs]')).not.toBeNull()
  })

  it('hides the stream rail without hiding session details', async () => {
    renderConsole({ enableLayoutControls: true })
    expect(await screen.findByRole('heading', { name: 'Layout fixture' })).not.toBeNull()
    expect(await screen.findByTestId('analytics-chart')).not.toBeNull()

    const toggle = screen.getByRole('button', { name: 'Hide streams' })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(toggle.getAttribute('aria-controls')).toBe('analytics-console-streams')
    fireEvent.click(toggle)

    expect(screen.queryByTestId('stream-sidebar')).toBeNull()
    expect(screen.getByText('Moment details')).not.toBeNull()
    expect(document.querySelector('[data-analytics-console-shell]')?.getAttribute('data-streams-visible'))
      .toBe('false')
    expect(screen.getByRole('button', { name: 'Show streams' }).getAttribute('aria-expanded')).toBe('false')
  })

  it('moves streams and session details below the focused chart in details disclosures', async () => {
    renderConsole({ enableLayoutControls: true })
    expect(await screen.findByRole('heading', { name: 'Layout fixture' })).not.toBeNull()
    expect(await screen.findByTestId('analytics-chart')).not.toBeNull()

    const focus = screen.getByRole('button', { name: 'Focus chart' })
    expect(focus.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(focus)

    expect(screen.getByRole('button', { name: 'Exit chart focus' }).getAttribute('aria-pressed')).toBe('true')
    const streamsDisclosure = document.querySelector('details#analytics-console-streams')
    const detailsDisclosure = screen.getByText('Session details').closest('details')
    expect(streamsDisclosure?.id).toBe('analytics-console-streams')
    expect(detailsDisclosure).not.toBeNull()

    const chart = screen.getByTestId('analytics-chart')
    expect(
      chart.compareDocumentPosition(streamsDisclosure as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Exit chart focus' }))
    expect(screen.getByRole('button', { name: 'Focus chart' }).getAttribute('aria-pressed')).toBe('false')
    expect(document.querySelector('details#analytics-console-streams')).toBeNull()
    expect(screen.getByTestId('stream-sidebar')).not.toBeNull()
  })
})

describe('AnalyticsConsole data skeleton', () => {
  it('reserves chart-like space while historical detail resolves and keeps the header visible', async () => {
    api.getAnalyticsStream.mockImplementation(() => new Promise(() => undefined))
    renderConsole({ enableLayoutControls: true })

    await waitFor(() => {
      expect(api.getAnalyticsStream).toHaveBeenCalled()
    })
    const status = screen.getByRole('status', { name: /loading analytics chart/i })
    expect(status.getAttribute('data-console-skeleton')).toBe('chart')
    expect(status.className).toMatch(/min-h-96/)
    expect(screen.getByRole('heading', { level: 1 })).not.toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
