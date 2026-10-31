import { cleanup, render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalyticsConsole } from './AnalyticsConsole.tsx'

// (pick 11A, 10-30) NEW-1: on the live site the session header said "Data: Good"
// while the selected stream's row in the stream list said "PARTIAL", hover text
// "chat rollups missing or partial". Both read the same coverage number
// (summary data_coverage_pct, 99.44 for yuyuta0702 316655688306): the Data
// label calls >= 80 % Good (the backend's own full_pulse / "synced" line), the
// row badge called < 99.5 % Partial, and its hover text read only the list
// row, which carries no chat count for an open stream. The badge now uses the
// header's line and its hover text reads the badge's own evidence.
// Shapes below are the saved real answers in
// streampulse-sdlc/artifacts/session-hub-gaps-20261030/codex-audit/inputs/evidence
// (live-stream/status/summary/minutes, past-*, streams-12), trimmed.
// ConsoleBits, StreamSidebar and syncedLiveStream are real; the chart and tab
// contents are stubs.

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
vi.mock('../hooks/useAnalyticsLive.ts', () => ({
  useAnalyticsLive: () => ({ data: undefined, isLoading: false, refetch: vi.fn() }),
}))
vi.mock('./analytics/AnalyticsChart.tsx', () => ({
  default: () => <div className="sc-chart-root" data-testid="analytics-chart">Chart</div>,
}))
vi.mock('./analytics/TopEmoteTable.tsx', () => ({ TopEmoteTable: () => null }))
vi.mock('./analytics/MomentReviewPanel.tsx', () => ({ MomentReviewPanel: () => null }))
vi.mock('./analytics/SessionRecapMomentsStrip.tsx', () => ({ SessionRecapMomentsStrip: () => null }))
vi.mock('./analytics/StreamRecapPanel.tsx', () => ({ StreamRecapPanel: () => null }))
vi.mock('./analytics/SyncStatusPanel.tsx', () => ({ SyncStatusPanel: () => null }))
vi.mock('./analytics/StreamQualityBanner.tsx', () => ({ StreamQualityBanner: () => null }))
vi.mock('./signals/SessionSignalTape.tsx', () => ({ SessionSignalTape: () => null }))

const LOGIN = 'yuyuta0702'
// The evidence was read at 2026-10-30T07:19Z (live-status updatedAt 1793344753049).
const READ_AT = '2026-10-30T07:19:30.000Z'

interface Fixture {
  streamId: string
  startedAt: string
  coveragePct: number
  firstOffsetSeconds: number
  minutes: number
  missingTo: number
  vodId: string
  minutesWithData: number
  viewerSampleCount: number
  /** summary sync_health_state, as the backend's summarizeStreamMetrics writes it. */
  health: string
  /** analyticsQuality, as the backend's portalQualityFromMetrics writes it. */
  quality: string
}

// live-*.json: 178 measured minutes from offset 114 s; summary 99.44 %, "synced", full_pulse.
const LIVE: Fixture = {
  streamId: '316655688306',
  startedAt: '2026-10-30T04:20:06Z',
  coveragePct: 99.44,
  firstOffsetSeconds: 114,
  minutes: 178,
  missingTo: 114,
  vodId: '2914584411',
  minutesWithData: 178,
  viewerSampleCount: 236,
  health: 'synced',
  quality: 'full_pulse',
}

// past-*.json: 395 measured minutes from offset 109 s; summary 99.5 %, "synced", full_pulse.
const PAST: Fixture = {
  streamId: '316705728883',
  startedAt: '2026-10-28T09:00:11Z',
  coveragePct: 99.5,
  firstOffsetSeconds: 109,
  minutes: 395,
  missingTo: 109,
  vodId: '2912916877',
  minutesWithData: 395,
  viewerSampleCount: 519,
  health: 'synced',
  quality: 'full_pulse',
}

// Not in the evidence: the same live stream with only 110 of its 179 minutes
// measured (61.45 %), so the backend writes "partial" / partial_pulse.
const LIVE_LOW: Fixture = {
  ...LIVE,
  coveragePct: 61.45,
  minutes: 110,
  minutesWithData: 110,
  viewerSampleCount: 140,
  health: 'partial',
  quality: 'partial_pulse',
}

function rollups(f: Fixture) {
  const startedMs = Date.parse(f.startedAt)
  return Array.from({ length: f.minutes }, (_, i) => {
    const offset = f.firstOffsetSeconds + i * 60
    const minuteTs = new Date(Math.floor((startedMs + offset * 1000) / 60_000) * 60_000).toISOString()
    // As in the evidence: the newest live minute has chat but no viewer sample yet.
    const viewers = i === f.minutes - 1 ? 0 : 9_000 + i
    return {
      minuteTs,
      viewerAvg: viewers,
      viewerMax: viewers,
      viewerLatest: viewers,
      viewerSamples: viewers > 0 ? 1 : 0,
      chatCount: 300,
      totalEmoteCount: 60,
    }
  })
}

function availability(f: Fixture) {
  return {
    version: 'v1',
    chartUsable: true,
    chartState: 'usable',
    coveragePct: f.coveragePct,
    missingRanges: [{ fromOffsetSeconds: 0, toOffsetSeconds: f.missingTo }],
    coverageMessage: 'Partial data coverage — missing ranges are backend-authored',
    liveDvrState: 'live',
    vodState: 'linked',
    vodId: f.vodId,
    backfillState: 'idle',
    corpusState: 'optional_absent',
  }
}

function detail(f: Fixture) {
  const rows = rollups(f)
  return {
    channel: LOGIN,
    state: 'live',
    stream: {
      streamId: f.streamId,
      login: LOGIN,
      displayName: 'yuyuta',
      title: `Session ${f.streamId}`,
      category: 'Just Chatting',
      categoryId: '509658',
      startedAt: f.startedAt,
      currentViewers: 10682,
      peakViewers: 11306,
      viewerSamples: 1,
      vodId: f.vodId,
    },
    sources: [{ source: 'analytics_db', state: 'ready' }],
    updatedAt: Date.parse(READ_AT),
    vodId: f.vodId,
    chatCoveragePct: f.coveragePct,
    dataCoveragePct: f.coveragePct,
    analyticsQuality: f.quality,
    viewerSource: 'live',
    coverageStartOffsetSeconds: f.firstOffsetSeconds,
    availability: availability(f),
    rollups: rows,
    momentRollups: rows,
    topEmotes: [],
  }
}

function status(f: Fixture) {
  return {
    analyticsQuality: f.quality,
    availability: availability(f),
    channel: LOGIN,
    chatCoveragePct: f.coveragePct,
    dataCoveragePct: f.coveragePct,
    state: 'live',
    streamId: f.streamId,
    syncPhase: '',
    updatedAt: Date.parse(READ_AT),
    vodId: f.vodId,
  }
}

function summary(f: Fixture) {
  return {
    analyticsQuality: f.quality,
    channel: LOGIN,
    metrics: {
      chat_per_min: 431.83,
      emotes_per_min: 87.53,
      data_coverage_pct: f.coveragePct,
      sync_health_state: f.health,
      minutesWithData: f.minutesWithData,
      viewerSampleCount: f.viewerSampleCount,
    },
    topEmotes: [],
    sources: [{ source: 'analytics_db', state: 'ready' }],
    updatedAt: Date.parse(READ_AT),
  }
}

// streams-12.json, first two rows: open rows carry viewerSamples: 1 and no chatMessages.
const LIST_ROWS = [LIVE, PAST].map((f) => ({
  streamId: f.streamId,
  login: LOGIN,
  displayName: 'yuyuta',
  title: `Session ${f.streamId}`,
  category: 'Just Chatting',
  categoryId: '509658',
  gamesSummary: 'Just Chatting',
  startedAt: f.startedAt,
  currentViewers: 10926,
  peakViewers: 11306,
  viewerSamples: 1,
}))

function serve(f: Fixture) {
  api.getAnalyticsStreams.mockResolvedValue({ channel: LOGIN, items: LIST_ROWS, sources: [] })
  api.getChannelStreamHistory.mockResolvedValue({ items: [] })
  api.getAnalyticsStream.mockResolvedValue(detail(f))
  api.getStreamStatus.mockResolvedValue(status(f))
  api.getStreamSummary.mockResolvedValue(summary(f))
  api.getStreamMinutesTail.mockResolvedValue(null)
  api.getPulseStreamRecap.mockResolvedValue(null)
  api.getStreamGameSegments.mockResolvedValue([])
  api.getSyncStatus.mockResolvedValue({ phase: 'idle', updatedAt: '0001-01-01T00:00:00Z' })
  api.getReplayHeatmap.mockResolvedValue(null)
  api.watchAnalyticsChannel.mockResolvedValue(undefined)
}

/** `answers` changes what the mocked API sends after serve(f). */
function renderSession(f: Fixture, answers?: () => void) {
  serve(f)
  answers?.()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/analytics/${LOGIN}/${f.streamId}`]}>
        <Routes>
          <Route path="/analytics/:login/:streamId" element={<AnalyticsConsole />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const BADGE_TEXTS = new Set(['Synced', 'Partial', 'Stats only', 'Check status', 'Syncing'])

function badgeIn(row: HTMLElement | null): HTMLElement | undefined {
  if (!row) return undefined
  return [...row.querySelectorAll<HTMLElement>('span')].find((span) => BADGE_TEXTS.has(span.textContent ?? ''))
}

function selectedRowBadge(): HTMLElement | undefined {
  return badgeIn(document.querySelector<HTMLElement>('a.sc-stream-row[aria-current="page"]'))
}

function rowBadge(streamId: string): HTMLElement | undefined {
  return badgeIn(document.querySelector<HTMLElement>(`a.sc-stream-row[href*="${streamId}"]`))
}

function dataLabel(): string | null {
  return document.querySelector('[data-data-quality]')?.getAttribute('data-quality-label') ?? null
}

/** The row badge that says the same thing as "Data: <label>". */
function badgeFor(label: string): string {
  return label === 'Good' ? 'Synced' : 'Partial'
}

async function settled(f: Fixture, answers?: () => void) {
  renderSession(f, answers)
  await waitFor(() => expect(api.getStreamSummary).toHaveBeenCalled())
  await waitFor(() => {
    expect(dataLabel()).not.toBeNull()
    expect(selectedRowBadge()).toBeDefined()
  })
  // Let the summary answer reach both the header and the row.
  await new Promise((resolve) => setTimeout(resolve, 50))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
  vi.setSystemTime(new Date(READ_AT))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('pick 11A: the selected row badge agrees with "Data: <label>"', () => {
  it('live 316655688306 (99.44 %, synced, full_pulse): "Data: Good" and the selected row says Synced', async () => {
    await settled(LIVE)
    const label = dataLabel()!
    expect(label).toBe('Good')
    await waitFor(() => expect(selectedRowBadge()?.textContent).toBe(badgeFor(label)))
  })

  it('live 316655688306: the selected row hover text does not claim chat is missing while the session has chat minutes', async () => {
    await settled(LIVE)
    await waitFor(() => expect(selectedRowBadge()?.textContent).toBe('Synced'))
    const title = selectedRowBadge()?.getAttribute('title') ?? ''
    expect(title).not.toMatch(/chat rollups missing/i)
    expect(title).toBe('Minute-level viewer, chat, and emote rollups are synced for charts.')
  })

  it('control: past 316705728883 (99.5 %, same ~2 min join gap, longer stream) agrees', async () => {
    await settled(PAST)
    const label = dataLabel()!
    expect(label).toBe('Good')
    expect(selectedRowBadge()?.textContent).toBe(badgeFor(label))
  })

  it('under the 80 % line (61.45 %, partial, partial_pulse): both say Partial and the hover text names the share in plain words', async () => {
    await settled(LIVE_LOW)
    const label = dataLabel()!
    expect(label).toBe('Partial')
    await waitFor(() => expect(selectedRowBadge()?.textContent).toBe(badgeFor(label)))
    expect(selectedRowBadge()?.getAttribute('title')).toBe(
      "Data in 61% of this stream's minutes; under 80% counts as partial.",
    )
  })

  // Review 10-30: with no summary the row read chatCoveragePct (the backend's chat-only share) as its data share.
  it('summary failed, chat in 40 % of rows but data in 90 % of minutes (full_pulse): both say Good / Synced, and no "40%"', async () => {
    const f: Fixture = { ...LIVE, coveragePct: 90 }
    await settled(f, () => {
      api.getAnalyticsStream.mockResolvedValue({ ...detail(f), chatCoveragePct: 40 })
      api.getStreamStatus.mockResolvedValue({ ...status(f), chatCoveragePct: 40 })
      api.getStreamSummary.mockResolvedValue(null)
    })
    expect(dataLabel()).toBe('Good')
    await waitFor(() => expect(selectedRowBadge()?.textContent).toBe('Synced'))
    expect(selectedRowBadge()?.getAttribute('title')).not.toMatch(/40%/)
  })

  it('summary failed, data in 70 % of minutes, chat in 95 %: the hover text names the data share, not chat’s', async () => {
    const f: Fixture = { ...LIVE, coveragePct: 70, health: 'partial', quality: 'partial_pulse' }
    await settled(f, () => {
      api.getAnalyticsStream.mockResolvedValue({ ...detail(f), chatCoveragePct: 95 })
      api.getStreamStatus.mockResolvedValue({ ...status(f), chatCoveragePct: 95 })
      api.getStreamSummary.mockResolvedValue(null)
    })
    expect(dataLabel()).toBe('Partial')
    await waitFor(() => expect(selectedRowBadge()?.textContent).toBe('Partial'))
    expect(selectedRowBadge()?.getAttribute('title')).toBe("Data in 70% of this stream's minutes; under 80% counts as partial.")
  })

  it('summary failed, a chat-only session (no viewer minutes, partial_pulse, data 90 %): both say Partial', async () => {
    const f: Fixture = { ...LIVE, coveragePct: 90, health: 'chat_only', quality: 'partial_pulse' }
    const d = detail(f)
    const noViewers = d.rollups.map((r) => ({ ...r, viewerAvg: 0, viewerMax: 0, viewerLatest: 0, viewerSamples: 0 }))
    await settled(f, () => {
      api.getAnalyticsStream.mockResolvedValue({ ...d, rollups: noViewers, momentRollups: noViewers })
      api.getStreamSummary.mockResolvedValue(null)
    })
    expect(dataLabel()).toBe('Partial')
    await waitFor(() => expect(selectedRowBadge()?.textContent).toBe('Partial'))
  })

  it('minutes read failed, summary synced 99.44 %: both say Good / Synced, and the hover text says the chart did not load', async () => {
    await settled(LIVE, () => {
      api.getAnalyticsStream.mockResolvedValue({ ...detail(LIVE), rollups: [], momentRollups: undefined, minutesUnavailable: true, timelineMinutes: 0 })
    })
    expect(dataLabel()).toBe('Good')
    await waitFor(() => expect(selectedRowBadge()?.textContent).toBe('Synced'))
    // not "rollups are synced for charts" beside the row's "minute chart unavailable" note (review 10-30)
    expect(selectedRowBadge()?.getAttribute('title')).toBe('Data synced; the minute chart did not load on this page.')
  })

  it('left alone: an unselected open row still says Partial, since the list sends it no chat count', async () => {
    await settled(LIVE)
    const other = rowBadge(PAST.streamId)
    expect(other?.closest('a')?.getAttribute('aria-current')).toBeNull()
    expect(other?.textContent).toBe('Partial')
    expect(other?.getAttribute('title')).toBe('Viewer minutes synced; chat rollups missing or partial.')
  })
})
