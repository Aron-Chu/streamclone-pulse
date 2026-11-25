import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
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
// The rail lists its streams' ids, so a test can see what the sidebar was given.
vi.mock('./analytics/StreamSidebar.tsx', () => ({
  StreamSidebar: ({ streams }: { streams?: Array<{ streamId: string }> }) => (
    <div>Stream rail<ul data-testid="rail">{streams?.map(s => <li key={s.streamId}>{s.streamId}</li>)}</ul></div>
  ),
}))
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

// A channel list of `count` rows, newest first, this session among them.
function listRows(count: number) {
  return Array.from({ length: count }, (_, at) => ({
    streamId: at === 0 ? streamId : `older-${at}`,
    login: 'xqc',
    startedAt: new Date(Date.parse(startedAt) - at * 86_400_000).toISOString(),
    viewerSamples: 1,
    chatMessages: 10,
  }))
}

function renderConsole(
  layer2LoadMode: 'eager' | 'staged' = 'eager',
  entry = `/analytics/xqc/${streamId}`,
  props: { missingSessionFallback?: ReactNode } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route
            path="/analytics/:login/:streamId?"
            element={<AnalyticsConsole layer2LoadMode={layer2LoadMode} {...props} />}
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
      await screen.findByText('Staging fixture', { selector: '[data-session-title]' })
      expect(screen.queryByText(/^live$/i)).toBeNull()
      await act(async () => { await vi.advanceTimersByTimeAsync(90_000) })
      expect(api.getStreamMinutesTail).not.toHaveBeenCalled()
      // One list read: a first page under 12 rows is the whole list.
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
    await screen.findByText('Staging fixture', { selector: '[data-session-title]' })
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
      api.getAnalyticsStreams.mockImplementation((_login: string, limit: number) =>
        Promise.resolve({ items: listRows(limit === 12 ? 12 : 30) }))
      renderConsole()
      await screen.findByText('Staging fixture', { selector: '[data-session-title]' })
      // (fix, 10-30) VOD-4: the list is two reads, the first 12 rows then 100.
      await waitFor(() => expect(api.getAnalyticsStreams).toHaveBeenCalledTimes(2))
      expect(api.getAnalyticsStreams).toHaveBeenNthCalledWith(1, expect.any(String), 12)
      expect(api.getAnalyticsStreams).toHaveBeenNthCalledWith(2, expect.any(String), 100)

      await act(async () => { await vi.advanceTimersByTimeAsync(90_000) })
      expect(api.getAnalyticsStreams).toHaveBeenCalledTimes(2)
      expect(api.watchAnalyticsChannel).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reads the list once when its first page holds fewer than 12 rows: that page is the whole list', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      renderConsole()
      await screen.findByText('Staging fixture', { selector: '[data-session-title]' })
      await waitFor(() => expect(api.getAnalyticsStreams).toHaveBeenCalledWith('xqc', 12))
      await act(async () => { await vi.advanceTimersByTimeAsync(90_000) })
      expect(api.getAnalyticsStreams).toHaveBeenCalledTimes(1)
      expect(api.getAnalyticsStreams).not.toHaveBeenCalledWith('xqc', 100)
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

    expect(await screen.findByText('Staging fixture', { selector: '[data-session-title]' })).toBeTruthy()
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

    expect(await screen.findByText('Staging fixture', { selector: '[data-session-title]' })).toBeTruthy()
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
    expect(await screen.findByText('Staging fixture', { selector: '[data-session-title]' })).toBeTruthy()
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

    expect(await screen.findByText('Live frame title', { selector: '[data-session-title]' })).toBeTruthy()
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
    expect(await screen.findByText('Staging fixture', { selector: '[data-session-title]' })).toBeTruthy()
    expect(screen.queryByText('Other stream title')).toBeNull()
  })

  it('keeps the live frame when the session read fails, without its unverified archive link', async () => {
    api.getAnalyticsStream.mockRejectedValue(new Error('backend unavailable'))
    mockedLive.data = endedLiveFrame
    renderConsole('staged')

    expect(await screen.findByText('Live frame title', { selector: '[data-session-title]' })).toBeTruthy()
    await waitFor(() => expect(api.getAnalyticsStream).toHaveBeenCalled())
    expect(await screen.findByText('No VOD linked yet.')).toBeTruthy()
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
    expect(await screen.findByText('Staging fixture', { selector: '[data-session-title]' })).toBeTruthy()
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

  it('starts the summary, recap and status reads from the session answer, before the page draws it', async () => {
    const drawnAtCall: Record<string, boolean> = {}
    const answer = (name: string, value: unknown) => () => {
      drawnAtCall[name] = document.body.textContent?.includes('Staging fixture') ?? false
      return Promise.resolve(value)
    }
    api.getStreamSummary.mockImplementation(answer('summary', { metrics: {} }))
    api.getPulseStreamRecap.mockImplementation(answer('recap', { streamId, topMoments: [] }))
    api.getStreamStatus.mockImplementation(answer('status', null))
    renderConsole('staged')

    await screen.findByText('Staging fixture', { selector: '[data-session-title]' })
    await waitFor(() => expect(Object.keys(drawnAtCall).sort()).toEqual(['recap', 'status', 'summary']))
    expect(drawnAtCall).toEqual({ summary: false, recap: false, status: false })
    // The page's own reads reuse those answers.
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(api.getStreamSummary).toHaveBeenCalledTimes(1)
    expect(api.getPulseStreamRecap).toHaveBeenCalledTimes(1)
    expect(api.getStreamStatus).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['finds no session', () => Promise.resolve(null)],
    ['answers 404', () => Promise.reject({ kind: 'not_found', message: 'not found', status: 404 })],
  ])('starts no summary, recap or status read when the session read %s', async (_label, read) => {
    api.getAnalyticsStream.mockImplementation(read)
    renderConsole('staged')

    await screen.findByRole('heading', { name: `Session ${streamId} not found` })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(api.getStreamSummary).not.toHaveBeenCalled()
    expect(api.getPulseStreamRecap).not.toHaveBeenCalled()
    expect(api.getStreamStatus).not.toHaveBeenCalled()
  })

  it('keeps the meta line visible with its reserved height until the summary read settles', async () => {
    let summary: (value: unknown) => void = () => undefined
    api.getStreamSummary.mockImplementation(() => new Promise(resolve => { summary = resolve }))
    renderConsole('staged')
    const meta = () => document.querySelector('[data-session-meta]')

    await screen.findByText('Staging fixture', { selector: '[data-session-title]' })
    await waitFor(() => expect(meta()?.hasAttribute('data-session-meta-settling')).toBe(true))
    expect(meta()?.hasAttribute('data-session-meta-pending')).toBe(false)

    await act(async () => summary({ metrics: {} }))
    await waitFor(() => expect(meta()?.hasAttribute('data-session-meta-settling')).toBe(false))
    expect(meta()?.hasAttribute('data-session-meta-pending')).toBe(false)
  })

  it('keeps the reserved height until the channel list, the only read naming the archive, answers', async () => {
    // A numeric id needs no list to name its session, as on the site.
    const numericId = '320567744986'
    let list: (value: unknown) => void = () => undefined
    api.getAnalyticsStream.mockResolvedValue({ ...detail, stream: { ...detail.stream, streamId: numericId } })
    api.getAnalyticsStreams.mockImplementation(() => new Promise(resolve => { list = resolve }))
    renderConsole('staged', `/analytics/xqc/${numericId}`)
    const meta = () => document.querySelector('[data-session-meta]')

    await screen.findByText('Staging fixture', { selector: '[data-session-title]' })
    await waitFor(() => expect(api.getStreamSummary).toHaveBeenCalled())
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(meta()?.hasAttribute('data-session-meta-settling')).toBe(true)
    expect(document.querySelector('[data-session-watch-vod]')).toBeNull()

    await act(async () => list({ items: [{ ...listRows(1)[0], streamId: numericId, vodId: '3333333333' }] }))
    await waitFor(() => expect(meta()?.hasAttribute('data-session-meta-settling')).toBe(false))
    expect(document.querySelector('[data-session-watch-vod]')?.getAttribute('href')).toContain('3333333333')
  })

  it('does not wait on the channel list for the archive when the session read names it', async () => {
    const numericId = '320567744986'
    api.getAnalyticsStream.mockResolvedValue({
      ...verifiedSessionDetail,
      stream: { ...verifiedSessionDetail.stream, streamId: numericId },
    })
    api.getAnalyticsStreams.mockImplementation(() => new Promise(() => undefined))
    renderConsole('staged', `/analytics/xqc/${numericId}`)
    const meta = () => document.querySelector('[data-session-meta]')

    await screen.findByText('Staging fixture', { selector: '[data-session-title]' })
    await waitFor(() => expect(meta()?.hasAttribute('data-session-meta-settling')).toBe(false))
    expect(document.querySelector('[data-session-watch-vod]')?.getAttribute('href')).toContain('2222222222')
  })

  it('reads no stream list or games while a stand-in waits on a missing session', async () => {
    api.getAnalyticsStream.mockRejectedValue({ kind: 'not_found', message: 'not found', status: 404 })
    renderConsole('eager', '/analytics/xqc/320567744986', { missingSessionFallback: <p>Stand-in for the session</p> })

    await screen.findByText('Stand-in for the session')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(api.getAnalyticsStreams).not.toHaveBeenCalled()
    expect(api.getStreamGameSegments).not.toHaveBeenCalled()
  })

  it('reads the stream list and games once the session read answers, with a stand-in ready', async () => {
    api.getAnalyticsStream.mockResolvedValue({ ...detail, stream: { ...detail.stream, streamId: '320567744986' } })
    renderConsole('eager', '/analytics/xqc/320567744986', { missingSessionFallback: <p>Stand-in for the session</p> })

    await screen.findByText('Staging fixture', { selector: '[data-session-title]' })
    await waitFor(() => expect(api.getAnalyticsStreams).toHaveBeenCalledWith('xqc', 12))
    await waitFor(() => expect(api.getStreamGameSegments).toHaveBeenCalledWith('320567744986'))
    expect(screen.queryByText('Stand-in for the session')).toBeNull()
  })

  it('enables heatmap and sync immediately after explicit tab engagement', async () => {
    renderConsole('staged')

    expect(await screen.findByText('Staging fixture', { selector: '[data-session-title]' })).not.toBeNull()
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

    await screen.findByText('Staging fixture', { selector: '[data-session-title]' })
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

  it('does not hold the slot on the channel route for the 100-row list once the first rows answered', async () => {
    // (fix, 10-30) VOD-4: the first 12 rows already show there is no session to open.
    api.getAnalyticsStreams.mockImplementation((_login: string, limit: number) =>
      limit === 12 ? Promise.resolve({ items: [] }) : new Promise(() => undefined))
    renderConsole('eager', '/analytics/xqc')

    await waitFor(() => expect(api.getAnalyticsStreams).toHaveBeenCalledWith('xqc', 12))
    await waitFor(() => expect(recapSlot()).toBeNull())
    // An empty first page is the whole list: no 100-row read follows it.
    expect(api.getAnalyticsStreams).not.toHaveBeenCalledWith('xqc', 100)
  })

  it('keeps polling the channel route from the first page while that page is the whole list', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      api.getAnalyticsStreams.mockResolvedValue({ items: [] })
      renderConsole('eager', '/analytics/xqc')
      await waitFor(() => expect(api.getAnalyticsStreams).toHaveBeenCalledTimes(1))
      await act(async () => { await vi.advanceTimersByTimeAsync(31_000) })
      expect(api.getAnalyticsStreams).toHaveBeenCalledTimes(2)
      expect(api.getAnalyticsStreams).not.toHaveBeenCalledWith('xqc', 100)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the sidebar on the polling first page after Refresh, so a stream that starts later shows up', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const railIds = () => [...screen.getByTestId('rail').querySelectorAll('li')].map(li => li.textContent)
    try {
      // no stream yet: the channel route stays, and polls its first page (the whole list)
      api.getAnalyticsStreams.mockResolvedValue({ items: [] })
      renderConsole('eager', '/analytics/xqc')
      await waitFor(() => expect(api.getAnalyticsStreams).toHaveBeenCalledTimes(1))

      fireEvent.click(await screen.findByRole('button', { name: 'Refresh data' }))
      await waitFor(() => expect(api.getAnalyticsStreams).toHaveBeenCalledTimes(2))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh data' }).hasAttribute('disabled')).toBe(false))
      // Refresh reads the list the sidebar shows: the first page, never a one-off 100-row read
      expect(api.getAnalyticsStreams).not.toHaveBeenCalledWith('xqc', 100)

      // a stream starts; the first page is still the whole list, and its next poll brings it to the sidebar
      api.getAnalyticsStreams.mockResolvedValue({ items: listRows(1) })
      await act(async () => { await vi.advanceTimersByTimeAsync(31_000) })
      await waitFor(() => expect(railIds()).toContain(streamId))
    } finally {
      vi.useRealTimers()
    }
  })
})
