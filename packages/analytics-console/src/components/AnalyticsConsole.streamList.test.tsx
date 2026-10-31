import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsStream } from '../apiTypes.ts'
import { AnalyticsConsole } from './AnalyticsConsole.tsx'

// (fix, 10-30) VOD-4 / VOD-7: the stream list was one 100-row read (slow on a
// busy channel) behind "Loading streams…" on every visit, and a tab return
// asked for it again. The first 12 rows now come from their own, smaller read.

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
  StatCard: () => null,
  CoverageStartMetaItem: () => null,
}))
vi.mock('./analytics/MomentReviewPanel.tsx', () => ({ MomentReviewPanel: () => null }))
vi.mock('./analytics/PastBroadcastBanner.tsx', () => ({ SessionLifecycleMeta: () => null }))
vi.mock('./analytics/StreamQualityBanner.tsx', () => ({ StreamQualityBanner: () => null }))
vi.mock('./analytics/TopEmoteTable.tsx', () => ({ TopEmoteTable: () => null }))
vi.mock('./analytics/StreamSidebar.tsx', () => ({
  StreamSidebar: (props: { streams: AnalyticsStream[]; loading?: boolean; streamsPartial?: boolean }) => (
    <div
      data-testid="sidebar"
      data-rows={props.streams.length}
      data-loading={String(Boolean(props.loading))}
      data-partial={String(Boolean(props.streamsPartial))}
    />
  ),
}))

const DAY = '2026-07-16'

function rows(count: number, from = 0): AnalyticsStream[] {
  return Array.from({ length: count }, (_, index) => {
    const n = from + index
    const startedAt = new Date(Date.parse(`${DAY}T18:00:00.000Z`) - n * 24 * 60 * 60 * 1000).toISOString()
    return { streamId: String(500 - n), login: 'xqc', title: `Broadcast ${n}`, startedAt, viewerSamples: 1, chatMessages: 5 }
  })
}

function list(items: AnalyticsStream[]) {
  return { channel: 'xqc', items, sources: [], updatedAt: Date.now() }
}

function session(id: string, startedAt: string) {
  return {
    channel: 'xqc',
    state: 'historical',
    stream: { streamId: id, login: 'xqc', title: `Session ${id}`, startedAt, lifecycleState: 'confirmed_ended' },
    rollups: [{ minuteTs: startedAt, viewerAvg: 100, viewerSamples: 1, chatCount: 10 }],
    topEmotes: [],
    sources: [],
    updatedAt: Date.now(),
  }
}

// Each read answers by its limit; a missing answer stays out.
function streamsByLimit(answers: Partial<Record<12 | 100, unknown>>) {
  api.getAnalyticsStreams.mockImplementation((_login: string, limit: 12 | 100) =>
    limit in answers ? Promise.resolve(answers[limit]) : new Promise(() => undefined))
}

function sidebar() {
  return screen.getByTestId('sidebar')
}

function renderConsole(route: string, client = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
})) {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/analytics/:login/:streamId?" element={<AnalyticsConsole />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return client
}

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  })
})

beforeEach(() => {
  vi.clearAllMocks()
  api.getAnalyticsLive.mockImplementation(() => new Promise(() => undefined))
  api.getAnalyticsStream.mockImplementation(async (id: string) => session(id, `${DAY}T18:00:00.000Z`))
  api.getPulseStreamRecap.mockResolvedValue(null)
  api.getReplayHeatmap.mockResolvedValue(null)
  api.getStreamGameSegments.mockResolvedValue([])
  api.getStreamMinutesTail.mockResolvedValue(null)
  api.getStreamStatus.mockResolvedValue(null)
  api.getStreamSummary.mockResolvedValue(null)
  api.getSyncStatus.mockResolvedValue(null)
  api.watchAnalyticsChannel.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  focusManager.setFocused(undefined)
  vi.restoreAllMocks()
})

describe('AnalyticsConsole stream list in two reads (VOD-4)', () => {
  it('shows the first 12 rows while the 100-row read is out, marked as a partial list', async () => {
    streamsByLimit({ 12: list(rows(12)) })
    renderConsole('/analytics/xqc/500')

    await waitFor(() => expect(sidebar().dataset.rows).toBe('12'))
    expect(sidebar().dataset.loading).toBe('false')
    expect(sidebar().dataset.partial).toBe('true')
    expect(api.getAnalyticsStreams).toHaveBeenNthCalledWith(1, 'xqc', 12)
    await waitFor(() => expect(api.getAnalyticsStreams).toHaveBeenNthCalledWith(2, 'xqc', 100))
  })

  it('swaps in the full list when it answers', async () => {
    streamsByLimit({ 12: list(rows(12)), 100: list(rows(30)) })
    renderConsole('/analytics/xqc/500')

    await waitFor(() => expect(sidebar().dataset.rows).toBe('30'))
    expect(sidebar().dataset.partial).toBe('false')
  })

  it('does not mark a first page shorter than 12 rows as partial: it is the whole list', async () => {
    streamsByLimit({ 12: list(rows(5)) })
    renderConsole('/analytics/xqc/500')

    await waitFor(() => expect(sidebar().dataset.rows).toBe('5'))
    expect(sidebar().dataset.partial).toBe('false')
  })

  it('keeps the first rows on screen when the 100-row read fails', async () => {
    api.getAnalyticsStreams.mockImplementation((_login: string, limit: number) =>
      limit === 12 ? Promise.resolve(list(rows(12))) : Promise.reject({ kind: 'server', message: 'internal_error', status: 500 }))
    renderConsole('/analytics/xqc/500')

    await waitFor(() => expect(api.getAnalyticsStreams).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(sidebar().dataset.rows).toBe('12'))
    expect(sidebar().dataset.partial).toBe('true')
  })

  it('resolves a date slug from the full list only, never from the first 12 rows', async () => {
    // The first page holds one stream on that day; the full list holds two, so
    // the date names no single session.
    const [first] = rows(1)
    const sameDay = { ...first!, streamId: '900', startedAt: `${DAY}T06:00:00.000Z`, title: 'Morning broadcast' }
    let answerFull: (value: unknown) => void = () => undefined
    api.getAnalyticsStreams.mockImplementation((_login: string, limit: number) =>
      limit === 12 ? Promise.resolve(list(rows(12))) : new Promise((resolve) => { answerFull = resolve }))
    renderConsole(`/analytics/xqc/${DAY}`)

    await waitFor(() => expect(sidebar().dataset.rows).toBe('12'))
    expect(api.getAnalyticsStream).not.toHaveBeenCalled()
    await act(async () => { answerFull(list([sameDay, ...rows(12)])) })
    await waitFor(() => expect(sidebar().dataset.rows).toBe('13'))
    expect(api.getAnalyticsStream).not.toHaveBeenCalled()
    await screen.findByText(`Session date ${DAY} outside loaded results`)
  })
})

describe('AnalyticsConsole stream list on a tab return (VOD-7)', () => {
  it('does not ask for the stream list again when the tab regains focus', async () => {
    streamsByLimit({ 12: list(rows(12)), 100: list(rows(30)) })
    // The portal's default: queries refetch on a tab return once stale.
    renderConsole('/analytics/xqc/500', new QueryClient({ defaultOptions: { queries: { retry: false } } }))
    await waitFor(() => expect(sidebar().dataset.rows).toBe('30'))
    const reads = api.getAnalyticsStreams.mock.calls.length

    const later = Date.now() + 60_000
    vi.spyOn(Date, 'now').mockReturnValue(later)
    await act(async () => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
    })
    // The session read itself still refreshes on focus (it is not confirmed ended here).
    expect(api.getAnalyticsStreams.mock.calls.length).toBe(reads)
  })
})
