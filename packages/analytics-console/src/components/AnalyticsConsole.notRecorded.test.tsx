import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalyticsConsole } from './AnalyticsConsole.tsx'

// A channel StreamPulse has never recorded (live read not_collected, stored list
// empty) shows one plain panel, not an empty dashboard with "Needs sync" cards,
// an empty chart, "Updated 1m ago" and data-quality chips.

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
vi.mock('./analytics/AnalyticsChart.tsx', () => ({
  default: () => <div data-testid="analytics-chart">No recent data</div>,
}))
vi.mock('./analytics/ConsoleBits.tsx', () => ({
  DataQualityDisclosure: () => <div data-testid="data-quality">Data quality: no data</div>,
  StatCard: ({ label, value }: { label: string; value: string }) => <div data-testid="stat-card">{label}: {value}</div>,
  CoverageStartBanner: () => null,
}))
vi.mock('./analytics/MomentReviewPanel.tsx', () => ({ MomentReviewPanel: () => null }))
vi.mock('./analytics/PastBroadcastBanner.tsx', () => ({ PastBroadcastBanner: () => null }))
vi.mock('./analytics/StreamQualityBanner.tsx', () => ({ StreamQualityBanner: () => null }))
vi.mock('./analytics/TopEmoteTable.tsx', () => ({ TopEmoteTable: () => null }))

const timeout = { kind: 'timeout', message: 'Request deadline exceeded', status: 0 }
const serverError = { kind: 'server', message: 'internal_error', status: 500 }
const startedAt = '2026-07-11T18:00:00.000Z'

let navigateTo: (to: string) => void = () => undefined
function NavigateGrab() {
  navigateTo = useNavigate()
  return null
}

function renderConsole(route: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <NavigateGrab />
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
  api.getAnalyticsLive.mockResolvedValue({ channel: 'xqc', state: 'not_collected', rollups: [], topEmotes: [], sources: [], updatedAt: 0 })
  api.getAnalyticsStreams.mockResolvedValue({ channel: 'xqc', items: [], sources: [], updatedAt: 0 })
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

describe('AnalyticsConsole: a channel StreamPulse has never recorded', () => {
  it('shows one panel with coverage, search and suggest links instead of the dashboard', async () => {
    api.getAnalyticsLive.mockResolvedValue({ channel: 'sp_untracked', state: 'not_collected', rollups: [], topEmotes: [], sources: [{ source: 'analytics_db', state: 'unavailable', message: 'No recent data' }], updatedAt: Date.now() - 60_000 })
    api.getAnalyticsStreams.mockResolvedValue({ channel: 'sp_untracked', items: null, sources: [], updatedAt: Date.now() })
    renderConsole('/analytics/sp_untracked')

    const panel = await screen.findByRole('region', { name: "StreamPulse hasn’t recorded sp_untracked yet" })
    expect(within(panel).getByRole('link', { name: 'How coverage works' }).getAttribute('href')).toBe('/docs#coverage')
    expect(within(panel).getByRole('link', { name: 'Search tracked channels' }).getAttribute('href')).toBe('/analytics')
    expect(within(panel).getByRole('link', { name: 'Suggest a channel' }).getAttribute('href')).toBe('/feedback')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('sp_untracked')

    // No empty dashboard around it.
    expect(screen.queryAllByTestId('stat-card')).toHaveLength(0)
    expect(screen.queryByText(/Needs sync/)).toBeNull()
    expect(screen.queryByTestId('analytics-chart')).toBeNull()
    expect(document.querySelector('[data-analytics-stream-column]')).toBeNull()
    expect(screen.queryByText(/^Updated/)).toBeNull()
    expect(screen.queryByText('stats only')).toBeNull()
    expect(screen.queryByTestId('data-quality')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Refresh data' })).toBeNull()
    expect(document.body.textContent).not.toMatch(/Streamclone/i)
    expect(screen.getByRole('region', { name: 'Analytics for sp_untracked' })).toBeTruthy()
  })

  it('keeps the dashboard for a channel with stored streams', async () => {
    api.getAnalyticsStreams.mockResolvedValue({
      channel: 'xqc',
      items: [{ streamId: '101', login: 'xqc', startedAt, endedAt: '2026-07-11T20:00:00.000Z', title: 'Stored broadcast' }],
      sources: [],
      updatedAt: 0,
    })
    renderConsole('/analytics/xqc')
    expect(await screen.findByTestId('analytics-chart')).toBeTruthy()
    expect(document.querySelector('[data-channel-not-recorded]')).toBeNull()
  })

  it('does not claim "never recorded" while the stream list or live read is pending or failed', async () => {
    api.getAnalyticsStreams.mockImplementation(() => new Promise(() => undefined))
    const pending = renderConsole('/analytics/xqc')
    expect(await screen.findByText('Loading streams…')).toBeTruthy()
    expect(document.querySelector('[data-channel-not-recorded]')).toBeNull()
    pending.unmount()

    api.getAnalyticsStreams.mockRejectedValue(serverError)
    const failedList = renderConsole('/analytics/xqc')
    await screen.findByText("Couldn't load streams.")
    expect(document.querySelector('[data-channel-not-recorded]')).toBeNull()
    failedList.unmount()

    api.getAnalyticsStreams.mockResolvedValue({ channel: 'xqc', items: [], sources: [], updatedAt: 0 })
    api.getAnalyticsLive.mockRejectedValue(serverError)
    renderConsole('/analytics/xqc')
    await screen.findByText(/Unable to load the latest session for/)
    expect(document.querySelector('[data-channel-not-recorded]')).toBeNull()
  })

  it('does not replace a session route', async () => {
    api.getAnalyticsStream.mockResolvedValue(null)
    renderConsole('/analytics/xqc/101')
    await waitFor(() => expect(api.getAnalyticsStreams).toHaveBeenCalled())
    expect(document.querySelector('[data-channel-not-recorded]')).toBeNull()
  })
})
