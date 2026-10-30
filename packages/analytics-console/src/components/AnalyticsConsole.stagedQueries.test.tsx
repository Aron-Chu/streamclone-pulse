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
vi.mock('./analytics/MomentReviewPanel.tsx', () => ({
  MomentReviewPanel: () => <div>Moment details</div>,
}))
vi.mock('./analytics/PastBroadcastBanner.tsx', () => ({ SessionLifecycleMeta: () => null }))
vi.mock('./analytics/SessionRecapMomentsStrip.tsx', () => ({ SessionRecapMomentsStrip: () => null }))
vi.mock('./analytics/StreamRecapPanel.tsx', () => ({ StreamRecapPanel: () => <div>Recap</div> }))
vi.mock('./analytics/SyncStatusPanel.tsx', () => ({ SyncStatusPanel: () => <div>Sync</div> }))
vi.mock('./analytics/StreamQualityBanner.tsx', () => ({ StreamQualityBanner: () => null }))
vi.mock('./signals/SessionSignalTape.tsx', () => ({ SessionSignalTape: () => <div data-testid="session-signal-tape" /> }))

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

// The channel's live read naming this session while it is confirmed live.
const confirmedLiveDetail = {
  ...detail,
  state: 'live',
  stream: { ...detail.stream, endedAt: null, lifecycleState: 'confirmed_live', lifecycleObservedAt: new Date().toISOString() },
}

// The channel's live read naming this session after it ended: lifecycle unknown and
// an archive id with no verified timing.
const endedLiveFrame = {
  ...detail,
  state: 'unknown',
  vodId: '1111111111',
  stream: { ...detail.stream, title: 'Live frame title', endedAt: undefined, lifecycleState: 'unknown', vodId: '1111111111' },
  availability: { vodId: '1111111111' },
}

// The session read for the same stream, with a verified archive.
const verifiedSessionDetail = {
  ...detail,
  vodId: '2222222222',
  vodAlignSeconds: 0,
  vodDurationSeconds: 3_600,
  stream: { ...detail.stream, lifecycleState: 'confirmed_ended', vodId: '2222222222' },
}

function renderConsole(layer2LoadMode: 'eager' | 'staged' = 'eager', entry = `/analytics/xqc/${streamId}`) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route
            path="/analytics/:login/:streamId?"
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
      ...confirmedLiveDetail,
      channel: 'zchum',
      stream: { ...confirmedLiveDetail.stream, login: 'zchum', title: 'Other creator broadcast' },
    }
    renderConsole('staged')

    expect(await screen.findByRole('heading', { name: `Session ${streamId} not found` })).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('Session not found')
    expect(screen.queryByText('Other creator broadcast')).toBeNull()
    expect(screen.queryByTestId('analytics-chart')).toBeNull()
    expect(api.getAnalyticsStream).not.toHaveBeenCalled()
    expect(api.getPulseStreamRecap).not.toHaveBeenCalled()
  })

  it('reuses a confirmed-live frame on its session route without reading the session', async () => {
    mockedLive.data = confirmedLiveDetail
    renderConsole('staged')

    expect(await screen.findByRole('heading', { name: 'Staging fixture' })).toBeTruthy()
    expect(screen.getByTestId('analytics-chart')).toBeTruthy()
    expect(screen.getByTestId('session-signal-tape')).toBeTruthy()
    expect(api.getAnalyticsStream).not.toHaveBeenCalled()
  })

  it('reads the session for an ended stream the live read also carries, loading as the direct page does', async () => {
    let answer: (session: unknown) => void = () => undefined
    api.getAnalyticsStream.mockImplementation(() => new Promise(resolve => { answer = resolve }))
    mockedLive.data = endedLiveFrame
    renderConsole('staged')

    // The session read is out: chart skeleton and a held meta slot, as when the page opens directly.
    await waitFor(() => expect(api.getAnalyticsStream).toHaveBeenCalledWith(streamId, { sparse: false, channel: 'xqc' }))
    expect(document.querySelector('[data-console-skeleton="chart"]')).toBeTruthy()
    expect(document.querySelector('[data-session-meta-pending]')).toBeTruthy()
    expect(screen.queryByTestId('analytics-chart')).toBeNull()
    expect(screen.queryByTestId('session-signal-tape')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.querySelector('[data-session-watch-vod]')).toBeNull()
    expect(screen.queryByText(/No verified archive link/)).toBeNull()

    await act(async () => answer(verifiedSessionDetail))
    expect(await screen.findByRole('heading', { name: 'Staging fixture' })).toBeTruthy()
    expect(screen.getByTestId('analytics-chart')).toBeTruthy()
    expect(document.querySelector('[data-console-skeleton="chart"]')).toBeNull()
    expect(document.querySelector('[data-session-watch-vod]')?.getAttribute('href')).toBe('https://www.twitch.tv/videos/2222222222')
    expect(screen.queryByText(/No verified archive link/)).toBeNull()
    await waitFor(() => expect(api.getPulseStreamRecap).toHaveBeenCalledWith(streamId))
    expect(api.getAnalyticsStream).toHaveBeenCalledTimes(1)
  })

  it('stands in with the live frame when the session read finds nothing', async () => {
    api.getAnalyticsStream.mockResolvedValue(null)
    mockedLive.data = endedLiveFrame
    renderConsole('staged')

    expect(await screen.findByRole('heading', { name: 'Live frame title' })).toBeTruthy()
    expect(screen.getByTestId('analytics-chart')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(new RegExp(`Session not found for`))).toBeNull()
    expect(document.querySelector('[data-session-watch-vod]')).toBeNull()
  })

  it('never titles a session route with a live frame from another stream', async () => {
    let answer: (session: unknown) => void = () => undefined
    api.getAnalyticsStream.mockImplementation(() => new Promise(resolve => { answer = resolve }))
    mockedLive.data = {
      ...confirmedLiveDetail,
      stream: { ...confirmedLiveDetail.stream, streamId: 'other-live-stream', title: 'Other stream title' },
    }
    renderConsole('staged')

    await waitFor(() => expect(api.getAnalyticsStream).toHaveBeenCalledWith(streamId, { sparse: false, channel: 'xqc' }))
    expect(screen.queryByText('Other stream title')).toBeNull()

    await act(async () => answer(detail))
    expect(await screen.findByRole('heading', { name: 'Staging fixture' })).toBeTruthy()
    expect(screen.queryByText('Other stream title')).toBeNull()
  })

  it('keeps the live frame when the session read fails, without its unverified archive link', async () => {
    api.getAnalyticsStream.mockRejectedValue(new Error('backend unavailable'))
    mockedLive.data = endedLiveFrame
    renderConsole('staged')

    expect(await screen.findByRole('heading', { name: 'Live frame title' })).toBeTruthy()
    await waitFor(() => expect(api.getAnalyticsStream).toHaveBeenCalled())
    expect(await screen.findByText(/No verified archive link is available/)).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByTestId('analytics-chart')).toBeTruthy()
    expect(document.querySelector('[data-session-watch-vod]')).toBeNull()
  })

  it('never stands in with another creator\'s live frame', async () => {
    let answer: (session: unknown) => void = () => undefined
    api.getAnalyticsStream.mockImplementation(() => new Promise(resolve => { answer = resolve }))
    mockedLive.data = {
      ...endedLiveFrame,
      channel: 'zchum',
      stream: { ...endedLiveFrame.stream, login: 'zchum', title: 'Other creator broadcast' },
    }
    renderConsole('staged')

    await waitFor(() => expect(api.getAnalyticsStream).toHaveBeenCalledWith(streamId, { sparse: false, channel: 'xqc' }))
    expect(screen.queryByText('Other creator broadcast')).toBeNull()
    expect(screen.queryByTestId('analytics-chart')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('heading', { name: `Session ${streamId} not found` })).toBeNull()

    await act(async () => answer(detail))
    expect(await screen.findByRole('heading', { name: 'Staging fixture' })).toBeTruthy()
    expect(screen.queryByText('Other creator broadcast')).toBeNull()
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

describe('AnalyticsConsole Stream Recap slot', () => {
  function recapSlot() {
    return document.querySelector('[data-console-skeleton="recap"]')
  }

  it('holds the slot while the session read is out', async () => {
    api.getAnalyticsStream.mockImplementation(() => new Promise(() => undefined))
    renderConsole()

    await waitFor(() => expect(api.getAnalyticsStream).toHaveBeenCalled())
    expect(recapSlot()).not.toBeNull()
    expect(api.getPulseStreamRecap).not.toHaveBeenCalled()
  })

  it('keeps the height of a full recap above the tabs until the recap lands in its place', async () => {
    let answer: (recap: unknown) => void = () => undefined
    api.getPulseStreamRecap.mockImplementation(() => new Promise(resolve => { answer = resolve }))
    renderConsole()

    await waitFor(() => expect(api.getPulseStreamRecap).toHaveBeenCalledWith(streamId))
    const slot = recapSlot()!
    expect(slot.className).toMatch(/min-h-\[28\.5rem\]/)
    expect(slot.getAttribute('aria-hidden')).toBe('true')
    expect(slot.nextElementSibling?.hasAttribute('data-session-details-tabs')).toBe(true)
    expect(screen.queryByText('Recap')).toBeNull()

    await act(async () => answer({ streamId, topMoments: [] }))
    const recap = await screen.findByText('Recap')
    expect(recap.nextElementSibling?.hasAttribute('data-session-details-tabs')).toBe(true)
    expect(recapSlot()).toBeNull()
  })

  it.each([
    ['fails', () => Promise.reject(new Error('recap unavailable'))],
    ['has no recap', () => Promise.resolve(null)],
  ])('gives the slot up when the recap read %s', async (_label, read) => {
    api.getPulseStreamRecap.mockImplementation(read)
    renderConsole()

    await screen.findByRole('heading', { name: 'Staging fixture' })
    await waitFor(() => expect(api.getPulseStreamRecap).toHaveBeenCalled())
    // A failed read is asked once more (retry: 1) before it settles.
    await waitFor(() => expect(recapSlot()).toBeNull(), { timeout: 3_000 })
    expect(screen.queryByText('Recap')).toBeNull()
    expect(screen.getByRole('tab', { name: 'Moments' })).toBeTruthy()
  })

  it('holds the slot on the channel route until it opens the session, then fills it with the recap', async () => {
    let list: (value: unknown) => void = () => undefined
    api.getAnalyticsStreams.mockImplementation(() => new Promise(resolve => { list = resolve }))
    renderConsole('eager', '/analytics/xqc')

    await waitFor(() => expect(api.getAnalyticsStreams).toHaveBeenCalled())
    expect(recapSlot()).not.toBeNull()

    await act(async () => list({ items: [{ streamId, login: 'xqc', startedAt, viewerSamples: 1, chatMessages: 10 }] }))
    expect(await screen.findByText('Recap')).toBeTruthy()
    expect(recapSlot()).toBeNull()
  })

  it('gives the slot up on the channel route when there is no session to open', async () => {
    api.getAnalyticsStreams.mockResolvedValue({ items: [] })
    renderConsole('eager', '/analytics/xqc')

    await waitFor(() => expect(api.getAnalyticsStreams).toHaveBeenCalled())
    await waitFor(() => expect(recapSlot()).toBeNull())
    expect(screen.queryByText('Recap')).toBeNull()
  })
})
