import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalyticsConsole } from './AnalyticsConsole.tsx'

// (fix, 10-30) CX-2: on a live session the Top emotes table shows the stream
// summary's top emotes whenever that list is nonempty (detailForRender). The
// summary was read once, so the table kept its first snapshot while the 30 s
// live tail moved the tiles beside it. A live session now reads the summary
// again every 30 s, and a failed read keeps the last good one. The summary
// mock answers what the backend would compute from the same minutes.

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
  StatCard: ({ label, value }: { label: string; value?: unknown }) => (
    <div data-stat-label={label}>{typeof value === 'string' || typeof value === 'number' ? value : null}</div>
  ),
  CoverageStartMetaItem: () => null,
}))
vi.mock('./analytics/MomentReviewPanel.tsx', () => ({ MomentReviewPanel: () => null }))
vi.mock('./analytics/PastBroadcastBanner.tsx', () => ({ SessionLifecycleMeta: () => null }))
vi.mock('./analytics/StreamQualityBanner.tsx', () => ({ StreamQualityBanner: () => null }))
// The table as rendered data: name and count per row, in the order it is given.
vi.mock('./analytics/TopEmoteTable.tsx', () => ({
  TopEmoteTable: ({ emotes }: { emotes: Array<{ key: string; name: string; count: number }> }) => (
    <ol data-testid="top-emotes">
      {emotes.slice(0, 20).map((emote) => (
        <li key={emote.key} data-emote-name={emote.name}>{emote.count}</li>
      ))}
    </ol>
  ),
}))

const MINUTE = 60_000
// A pinned clock: the stream started an hour before it, on a whole minute.
const NOW = Date.parse('2026-10-30T08:00:00.000Z')
const startedMs = NOW - 60 * MINUTE
const startedAt = new Date(startedMs).toISOString()
const at = (offsetSeconds: number) => new Date(startedMs + offsetSeconds * 1000).toISOString()

// Real shapes (codex-audit/inputs/evidence): minute rows key emotes
// `provider:name:name` (portalBucketEmoteKey); /summary keys `provider:id:name`.
const YD_ROW = 'twitch:YappingDuck:YappingDuck'
const NLT_ROW = 'twitch:NotLikeThis:NotLikeThis'
const YD_SUMMARY = 'twitch:emotesv2_bea88a2caa044e409c1b32ee0850b825:YappingDuck'
const NLT_SUMMARY = 'twitch:58765:NotLikeThis'

function minute(offsetSeconds: number, chatCount: number, emotes: Record<string, number>) {
  const total = Object.values(emotes).reduce((sum, n) => sum + n, 0)
  return {
    minuteTs: at(offsetSeconds),
    viewerAvg: 900,
    viewerLatest: 900,
    viewerSamples: 1,
    chatCount,
    totalEmoteCount: total,
    emotes,
  }
}

const sessionMinutes = [minute(3300, 10, { [YD_ROW]: 10 }), minute(3360, 20, { [YD_ROW]: 20 })]

function liveDetail() {
  return {
    channel: 'xqc',
    state: 'live',
    stream: { streamId: '202', login: 'xqc', title: 'Live broadcast', startedAt, lifecycleState: 'confirmed_live' },
    rollups: sessionMinutes,
    momentRollups: sessionMinutes,
    topEmotes: [{ key: YD_ROW, name: 'YappingDuck', provider: 'twitch', count: 30 }],
    sources: [],
    updatedAt: Date.now(),
  }
}

function tail(minutes: ReturnType<typeof minute>[], catalog: Array<{ key: string; name: string; count: number }>) {
  return {
    channel: 'xqc',
    state: 'live',
    rollups: minutes,
    topEmotes: catalog.map((emote) => ({ ...emote, provider: 'twitch' })),
    sources: [],
    updatedAt: Date.now(),
  }
}

// Poll 1 (at load): nothing new. Poll 2 (+30 s): the open minute grew and a
// new minute brought a NotLikeThis spike. Poll 3 (+60 s): the open minute again.
const openMinuteGrown = minute(3360, 25, { [YD_ROW]: 25 })
const spikeMinute = minute(3420, 50, { [YD_ROW]: 45, [NLT_ROW]: 60 })
const tailPoll1 = () => tail([sessionMinutes[1]!], [{ key: YD_ROW, name: 'YappingDuck', count: 20 }])
const tailPoll2 = () => tail([openMinuteGrown, spikeMinute], [
  { key: YD_ROW, name: 'YappingDuck', count: 70 },
  { key: NLT_ROW, name: 'NotLikeThis', count: 60 },
])
const tailPoll3 = () => tail([spikeMinute], [
  { key: YD_ROW, name: 'YappingDuck', count: 45 },
  { key: NLT_ROW, name: 'NotLikeThis', count: 60 },
])

// What /summary computes from the stored minutes at read time (TopEmotesFromRollups).
const summaryAtLoad = {
  metrics: { data_coverage_pct: 99, sync_health_state: 'synced', minutesWithData: 2 },
  topEmotes: [{ key: YD_SUMMARY, name: 'YappingDuck', id: 'emotesv2_bea88a2caa044e409c1b32ee0850b825', provider: 'twitch', count: 30 }],
}
const summaryAfterSpike = {
  metrics: { data_coverage_pct: 99, sync_health_state: 'synced', minutesWithData: 3 },
  topEmotes: [
    { key: YD_SUMMARY, name: 'YappingDuck', id: 'emotesv2_bea88a2caa044e409c1b32ee0850b825', provider: 'twitch', count: 10 + 25 + 45 },
    { key: NLT_SUMMARY, name: 'NotLikeThis', id: '58765', provider: 'twitch', count: 60 },
  ],
}

function renderConsole() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/analytics/xqc/202']}>
        <Routes>
          <Route path="/analytics/:login/:streamId?" element={<AnalyticsConsole />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return client
}

const summaryReads = (client: QueryClient) =>
  client.getQueryCache().find({ queryKey: ['analytics-console-summary'], exact: false })?.state.dataUpdateCount ?? 0
const stat = (label: string) => document.querySelector(`[data-stat-label="${label}"]`)?.textContent
const tableCount = (name: string) => document.querySelector(`[data-testid="top-emotes"] [data-emote-name="${name}"]`)?.textContent ?? null
const tableNames = () => Array.from(document.querySelectorAll('[data-testid="top-emotes"] [data-emote-name]'))
  .map((row) => row.getAttribute('data-emote-name'))

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  })
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(NOW)
  api.getAnalyticsStreams.mockImplementation(() => new Promise(() => undefined))
  api.getAnalyticsLive.mockImplementation(() => new Promise(() => undefined))
  api.getAnalyticsStream.mockResolvedValue(liveDetail())
  api.getPulseStreamRecap.mockResolvedValue(null)
  api.getReplayHeatmap.mockResolvedValue(null)
  api.getStreamGameSegments.mockResolvedValue([])
  api.getStreamMinutesTail
    .mockResolvedValueOnce(tailPoll1())
    .mockResolvedValueOnce(tailPoll2())
    .mockResolvedValue(tailPoll3())
  api.getStreamStatus.mockResolvedValue(null)
  api.getStreamSummary
    .mockResolvedValueOnce(summaryAtLoad)
    .mockResolvedValue(summaryAfterSpike)
  api.getSyncStatus.mockResolvedValue(null)
  api.watchAnalyticsChannel.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('AnalyticsConsole live Top emotes (CX-2)', () => {
  async function openEmotesTab() {
    await screen.findByTestId('analytics-chart')
    await waitFor(() => expect(api.getStreamSummary).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(api.getStreamMinutesTail).toHaveBeenCalledTimes(1))
    fireEvent.click(document.getElementById('session-tab-emotes')!)
    await waitFor(() => expect(tableCount('YappingDuck')).toBe('30'))
  }

  // No focus event or Refresh: only the 30 s polls run.
  async function nextPoll() {
    await act(async () => { await vi.advanceTimersByTimeAsync(31_000) })
  }

  it('moves the Top emotes table with the tail, as the tiles beside it move', async () => {
    const client = renderConsole()
    await openEmotesTab()

    // Two more 30 s polls.
    await nextPoll()
    await nextPoll()
    await waitFor(() => expect(api.getStreamMinutesTail.mock.calls.length).toBeGreaterThanOrEqual(3))
    expect(api.getStreamMinutesTail).toHaveBeenLastCalledWith('202', 3420)

    // Control: the tail reached the page. Tiles read the merged minutes.
    await waitFor(() => expect(stat('Chat messages')).toBe(String(10 + 25 + 50)))
    expect(stat('Emote uses')).toBe(String(10 + 25 + 45 + 60))

    // The summary was read again while live, so the table agrees with those
    // minutes: YappingDuck 10+25+45, then the NotLikeThis spike (60 uses).
    expect(summaryReads(client)).toBeGreaterThanOrEqual(2)
    await waitFor(() => expect(tableCount('YappingDuck')).toBe('80'))
    expect(tableCount('NotLikeThis')).toBe('60')
    expect(tableNames()).toEqual(['YappingDuck', 'NotLikeThis'])
  })

  it('keeps the last good summary when a summary read fails', async () => {
    api.getStreamSummary.mockReset()
    api.getStreamSummary
      .mockResolvedValueOnce(summaryAtLoad)
      .mockResolvedValueOnce(summaryAfterSpike)
      .mockResolvedValue(null)
    const client = renderConsole()
    await openEmotesTab()

    await nextPoll()
    await waitFor(() => expect(tableCount('YappingDuck')).toBe('80'))
    expect(tableCount('NotLikeThis')).toBe('60')

    // The third read fails (null). The session read's own list would show
    // YappingDuck at its first count (30) with the tail's NotLikeThis below it.
    await nextPoll()
    await waitFor(() => expect(summaryReads(client)).toBe(3))
    expect(api.getStreamSummary).toHaveBeenCalledTimes(3)
    expect(tableCount('YappingDuck')).toBe('80')
    expect(tableCount('NotLikeThis')).toBe('60')
  })

  it('reads an ended session\'s summary once', async () => {
    const ended = liveDetail()
    api.getAnalyticsStream.mockResolvedValue({
      ...ended,
      state: 'ended',
      stream: { ...ended.stream, endedAt: at(3480), lifecycleState: 'confirmed_ended' },
    })
    renderConsole()
    await screen.findByTestId('analytics-chart')
    await waitFor(() => expect(api.getStreamSummary).toHaveBeenCalledTimes(1))

    await nextPoll()
    await nextPoll()
    expect(api.getStreamSummary).toHaveBeenCalledTimes(1)
    expect(api.getStreamMinutesTail).not.toHaveBeenCalled()
  })

  // A page left open in a visible tab is never told the stream ended, so it
  // still reads as live; the summary stops once no minute is newer than 10 min.
  it('stops re-reading the summary while no minute is newer than 10 min, and picks up on a fresh one', async () => {
    const quietMinutes = [minute(2700, 10, { [YD_ROW]: 10 }), minute(2760, 20, { [YD_ROW]: 20 })]
    api.getAnalyticsStream.mockResolvedValue({ ...liveDetail(), rollups: quietMinutes, momentRollups: quietMinutes })
    api.getStreamMinutesTail.mockReset()
    api.getStreamMinutesTail
      .mockResolvedValueOnce(tail([], []))
      .mockResolvedValueOnce(tail([], []))
      .mockResolvedValueOnce(tail([], []))
      .mockResolvedValue(tail([minute(3660, 40, { [YD_ROW]: 40 })], [{ key: YD_ROW, name: 'YappingDuck', count: 40 }]))
    renderConsole()
    await screen.findByTestId('analytics-chart')
    await waitFor(() => expect(api.getStreamSummary).toHaveBeenCalledTimes(1))

    // The newest minute is 14 min old: tail polls run, the summary waits.
    await nextPoll()
    await nextPoll()
    await waitFor(() => expect(api.getStreamMinutesTail.mock.calls.length).toBeGreaterThanOrEqual(3))
    expect(api.getStreamSummary).toHaveBeenCalledTimes(1)

    // A tail poll brings a minute from the last 10 min: the summary is read again.
    await nextPoll()
    await nextPoll()
    await waitFor(() => expect(stat('Chat messages')).toBe(String(10 + 20 + 40)))
    await nextPoll()
    await waitFor(() => expect(api.getStreamSummary.mock.calls.length).toBeGreaterThanOrEqual(2))
  })
})
