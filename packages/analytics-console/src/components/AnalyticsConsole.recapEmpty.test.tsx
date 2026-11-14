import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalyticsConsole } from './AnalyticsConsole.tsx'

// Round 2 (SESSION-MOMENTS-4): a recap that loaded with no moments keeps the Moments tab's normal empty state;
// only a recap that failed says "Recap unavailable".

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
  useAnalyticsLive: () => ({ data: undefined, isLoading: false, refetch: vi.fn() }),
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
vi.mock('./analytics/StreamSidebar.tsx', () => ({ StreamSidebar: () => null }))
vi.mock('./analytics/TopEmoteTable.tsx', () => ({ TopEmoteTable: () => null }))
vi.mock('./analytics/MomentReviewPanel.tsx', () => ({ MomentReviewPanel: () => <div>Moment details</div> }))
vi.mock('./analytics/PastBroadcastBanner.tsx', () => ({ SessionLifecycleMeta: () => null }))
vi.mock('./analytics/SessionRecapMomentsStrip.tsx', () => ({ SessionRecapMomentsStrip: () => <div>Ranked rows</div> }))
vi.mock('./analytics/StreamRecapPanel.tsx', () => ({ StreamRecapPanel: () => null }))
vi.mock('./analytics/SyncStatusPanel.tsx', () => ({ SyncStatusPanel: () => null }))
vi.mock('./analytics/StreamQualityBanner.tsx', () => ({ StreamQualityBanner: () => null }))
vi.mock('./signals/SessionSignalTape.tsx', () => ({ SessionSignalTape: () => null }))

const streamId = 'recap-empty-stream'
const startedAt = '2026-07-16T18:00:00.000Z'

function detail() {
  return {
    channel: 'xqc',
    state: 'historical',
    stream: {
      streamId, login: 'xqc', displayName: 'xQc', title: 'Recap fixture', category: 'Just Chatting', startedAt,
      endedAt: '2026-07-16T19:00:00.000Z',
    },
    rollups: [0, 1, 2].map(i => ({
      minuteTs: new Date(Date.parse(startedAt) + (i + 1) * 60_000).toISOString(),
      viewerAvg: 100, viewerSamples: 1, chatCount: 10 + i * 40, totalEmoteCount: 2 + i * 30,
    })),
    topEmotes: [],
    sources: [],
    updatedAt: Date.now(),
  }
}

function renderConsole() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, refetchOnWindowFocus: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/analytics/xqc/${streamId}`]}>
        <Routes>
          <Route path="/analytics/:login/:streamId" element={<AnalyticsConsole />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  api.getAnalyticsStreams.mockResolvedValue({ items: [{ streamId, login: 'xqc', startedAt, viewerSamples: 1, chatMessages: 10 }] })
  api.getChannelStreamHistory.mockResolvedValue({ items: [] })
  api.getAnalyticsStream.mockResolvedValue(detail())
  api.getStreamGameSegments.mockResolvedValue([])
  api.getSyncStatus.mockResolvedValue(null)
  api.getStreamSummary.mockResolvedValue(null)
  api.getReplayHeatmap.mockResolvedValue(null)
  api.watchAnalyticsChannel.mockResolvedValue(undefined)
})

afterEach(() => cleanup())

describe('AnalyticsConsole Moments tab after the recap answers', () => {
  it('keeps the normal empty state, with no notice, when the recap loaded with no moments', async () => {
    api.getPulseStreamRecap.mockResolvedValue({ streamId, moments: [] })
    renderConsole()
    expect(await screen.findByText('Moment details')).not.toBeNull()
    await waitFor(() => expect(api.getPulseStreamRecap).toHaveBeenCalled())
    expect(screen.queryByText(/Recap unavailable/)).toBeNull()
    expect(document.querySelector('[data-moments-fallback-notice]')).toBeNull()
  })

  it('says "Recap unavailable" with Try again only when the recap failed', async () => {
    api.getPulseStreamRecap.mockRejectedValue(new Error('recap down'))
    renderConsole()
    const notice = await waitFor(() => {
      const el = document.querySelector('[data-moments-fallback-notice]')
      expect(el).not.toBeNull()
      return el!
    }, { timeout: 4000 })
    expect(notice.textContent).toMatch(/Recap unavailable/)
    expect(screen.getByRole('button', { name: /Try again/ })).not.toBeNull()
    expect(screen.queryByText('Moment details')).toBeNull()
  })

  // Round 4: a Try again that fails keeps the notice in place (no skeleton), the button busy while it runs, then
  // focus on Try again and "Still unavailable." in the status line.
  it('keeps the notice and focus on Try again through a retry that fails again', async () => {
    api.getPulseStreamRecap.mockRejectedValue(new Error('recap down'))
    renderConsole()
    const button = await waitFor(() => {
      const el = document.querySelector<HTMLButtonElement>('[data-moments-retry]')
      expect(el).not.toBeNull()
      return el!
    }, { timeout: 4000 })
    const callsBefore = api.getPulseStreamRecap.mock.calls.length
    button.focus()
    fireEvent.click(button)
    await waitFor(() => expect(button.getAttribute('aria-busy')).toBe('true'))
    expect(button.textContent).toBe('Trying again…')
    expect(document.querySelector('[data-moments-loading]')).toBeNull()
    expect(document.querySelector('[data-moments-fallback-notice]')).not.toBeNull()
    expect(document.activeElement).toBe(button)
    await waitFor(() => expect(button.getAttribute('aria-busy')).toBeNull(), { timeout: 4000 })
    expect(api.getPulseStreamRecap.mock.calls.length).toBeGreaterThan(callsBefore)
    expect(button.isConnected).toBe(true)
    expect(document.activeElement).toBe(button)
    expect(button.textContent).toBe('Try again')
    const status = document.querySelector('[data-moments-fallback-notice] [role="status"]')!
    expect(status.textContent).toMatch(/Still unavailable\.$/)
    expect(document.querySelector('[data-moments-loading]')).toBeNull()
  })
})
