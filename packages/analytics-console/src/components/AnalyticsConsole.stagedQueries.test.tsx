import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  getStreamStatus: vi.fn(),
  getStreamMinutesTail: vi.fn(),
  getReplayHeatmap: vi.fn(),
  startHistoricalSync: vi.fn(),
  watchAnalyticsChannel: vi.fn(),
}))
const mockedLive = vi.hoisted(() => ({ data: undefined as Record<string, unknown> | undefined }))

vi.mock('../api.ts', () => api)
vi.mock('../hooks/useAnalyticsLive.ts', () => ({
  useAnalyticsLive: () => ({
    data: mockedLive.data,
    isLoading: false,
    refetch: vi.fn(),
  }),
}))
vi.mock('./analytics/AnalyticsChart.tsx', () => ({
  default: () => <div data-testid="analytics-chart">Chart</div>,
}))
vi.mock('./analytics/ConsoleBits.tsx', () => ({
  DataQualityDisclosure: () => null,
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
  mockedLive.data = undefined
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
  api.getStreamStatus.mockResolvedValue(null)
  api.getStreamMinutesTail.mockResolvedValue(null)
  api.getReplayHeatmap.mockResolvedValue({ points: [] })
  api.watchAnalyticsChannel.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
})

describe('AnalyticsConsole staged Layer 2 queries', () => {
  it('never starts live-tail polling or shows a live session when explicit lifecycle is unknown', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      api.getAnalyticsStream.mockResolvedValue({ ...detail, state: 'live',
        stream: { ...detail.stream, endedAt: null, lifecycleState: 'unknown' },
        availability: { liveDvrState: 'live', vodState: 'unavailable' } })
      renderConsole()
      await screen.findByRole('heading', { name: 'Staging fixture' })
      expect(screen.queryByText(/^live$/i)).toBeNull()
      await act(async () => { await vi.advanceTimersByTimeAsync(90_000) })
      expect(api.getStreamMinutesTail).not.toHaveBeenCalled()
      expect(api.getAnalyticsStreams).toHaveBeenCalledTimes(1)
      expect(screen.queryByText(/^live$/i)).toBeNull()
    } finally { vi.useRealTimers() }
  })
  it('keeps eager mode as the package default', async () => {
    renderConsole()

    await waitFor(() => {
      expect(api.getPulseStreamRecap).toHaveBeenCalledWith(streamId)
      expect(api.getStreamSummary).toHaveBeenCalled()
      expect(api.getReplayHeatmap).toHaveBeenCalled()
      expect(api.getSyncStatus).toHaveBeenCalledWith(streamId)
    })
    expect(api.watchAnalyticsChannel).not.toHaveBeenCalled()
  })

  it('supports roving keyboard focus and associated session tab panels', async () => {
    renderConsole()
    await screen.findByText('Moment details')
    await screen.findByRole('heading', { name: 'Staging fixture' })
    await screen.findByText('Recap')
    const moments = screen.getByRole('tab', { name: 'Moments' })

    expect(moments.getAttribute('aria-selected')).toBe('true')
    expect(moments.tabIndex).toBe(0)
    fireEvent.keyDown(moments, { key: 'ArrowRight' })
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Emotes' }).getAttribute('aria-selected')).toBe('true'))
    const selectedEmotes = screen.getByRole('tab', { name: 'Emotes' })
    expect(selectedEmotes.tabIndex).toBe(0)
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe('session-tab-emotes')

    fireEvent.keyDown(selectedEmotes, { key: 'End' })
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Status' }).getAttribute('aria-selected')).toBe('true'))
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Status' }), { key: 'Home' })
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Moments' }).getAttribute('aria-selected')).toBe('true'))
  })

  it('does not keep refetching the channel stream list on an ended session route', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      renderConsole()
      await screen.findByRole('heading', { name: 'Staging fixture' })
      expect(api.getAnalyticsStreams).toHaveBeenCalledTimes(1)

      await act(async () => { await vi.advanceTimersByTimeAsync(90_000) })
      expect(api.getAnalyticsStreams).toHaveBeenCalledTimes(1)
      expect(api.watchAnalyticsChannel).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('distinguishes a session API failure from a nonexistent session', async () => {
    api.getAnalyticsStream.mockRejectedValueOnce(new Error('backend unavailable'))
    renderConsole()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Unable to load session data')
    expect(alert.textContent).toContain('Refresh to try again')
    expect(alert.textContent).not.toContain('Session not found')
    expect(screen.getByRole('heading', { name: 'Unable to load xqc session' })).not.toBeNull()
  })

  it.each([
    ['different stream login', { ...detail, stream: { ...detail.stream, login: 'zchum', title: 'Other creator broadcast' } }],
    ['conflicting response channel', { ...detail, channel: 'zchum' }],
    ['missing stream owner', { ...detail, stream: { ...detail.stream, login: '' } }],
  ])('does not attribute %s to the requested creator', async (_reason, response) => {
    api.getAnalyticsStream.mockResolvedValue(response)
    renderConsole('staged')

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Session not found')
    expect(screen.getByRole('heading', { name: `Session ${streamId} not found` })).toBeTruthy()
    expect(screen.queryByText('Other creator broadcast')).toBeNull()
    expect(screen.queryByTestId('analytics-chart')).toBeNull()
    expect(api.getPulseStreamRecap).not.toHaveBeenCalled()
    expect(api.getStreamSummary).not.toHaveBeenCalled()
  })

  it('accepts the verified creator regardless of login capitalization', async () => {
    api.getAnalyticsStream.mockResolvedValue({
      ...detail,
      channel: 'XQC',
      stream: { ...detail.stream, login: 'XqC' },
    })
    renderConsole('staged')

    expect(await screen.findByRole('heading', { name: 'Staging fixture' })).toBeTruthy()
    expect(screen.getByTestId('analytics-chart')).toBeTruthy()
  })

  it('checks ownership when a historical route reuses its live detail', async () => {
    mockedLive.data = {
      ...detail,
      channel: 'zchum',
      stream: { ...detail.stream, login: 'zchum', title: 'Other creator broadcast' },
    }
    renderConsole('staged')

    expect(await screen.findByRole('heading', { name: `Session ${streamId} not found` })).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('Session not found')
    expect(screen.queryByText('Other creator broadcast')).toBeNull()
    expect(screen.queryByTestId('analytics-chart')).toBeNull()
    expect(api.getAnalyticsStream).not.toHaveBeenCalled()
    expect(api.getPulseStreamRecap).not.toHaveBeenCalled()
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

    fireEvent.click(screen.getByRole('tab', { name: 'Status' }))
    await waitFor(() => {
      expect(api.getSyncStatus).toHaveBeenCalledWith(streamId)
    })
    expect(api.getReplayHeatmap).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('tab', { name: 'Moments' }))
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
