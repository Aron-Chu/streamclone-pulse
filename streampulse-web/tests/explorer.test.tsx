import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { explorerReasonCopy, normalizeExplorerEnvelope, type ExplorerEnvelope } from '../src/lib/explorer'

const { mockUseExplorerData, request } = vi.hoisted(() => ({ mockUseExplorerData: vi.fn(), request: vi.fn() }))
vi.mock('../src/hooks/useExplorerData', () => ({ useExplorerData: mockUseExplorerData }))
// Only the selected broadcast's exact-source check reaches the API in these tests.
vi.mock('../src/lib/apiClient', async (importOriginal) => ({ ...await importOriginal<typeof import('../src/lib/apiClient')>(), apiClient: request }))

import AnalyticsExplorerPage from '../src/routes/analytics/AnalyticsExplorerPage'

const occurredAt = Date.UTC(2026, 8, 3, 12, 0, 0)

function comparison(at = occurredAt) {
  const evidence = {
    ircBound: true,
    eventRollupAvailable: true,
    streamIdentityMatched: true,
    rollupChatSource: 'irc',
    rollupSourceConfidence: 'verified',
    metadataStreamMatched: true,
    baselineMeasuredMinutes: 20,
    baselineExpectedMinutes: 20,
    baselineCoveragePct: 100,
  }
  const metric = {
    state: 'ready',
    currentPerMin: 120,
    baselinePerMin: 40,
    absoluteDeltaPerMin: 80,
    changePct: 200,
    multiplier: 3,
    currentMeasuredMinutes: 1,
    currentExpectedMinutes: 1,
    baselineMeasuredMinutes: 20,
    baselineExpectedMinutes: 20,
    baselineCoveragePct: 100,
  }
  return {
    baselineKind: 'current_stream_measured_average_before_event',
    eventAt: at,
    baselineWindow: { start: at - 20 * 60_000, end: at, expectedMinutes: 20, measuredMinutes: 20, coveragePct: 100 },
    chat: metric,
    emotes: { ...metric, currentPerMin: 160, multiplier: 4 },
    evidence,
  }
}

function moment(id: string, at = occurredAt, score = 91) {
  const compared = comparison(at)
  return {
    id,
    revision: 1,
    detectorEventKey: `event-${id}`,
    updateKind: 'signal',
    occurredAt: new Date(at).toISOString(),
    publishedAt: new Date(at + 1000).toISOString(),
    signal: 'emotes',
    lifecycle: 'confirmed',
    headline: 'Emote activity rose well above this broadcast baseline',
    summary: 'Verified emote and chat rollups identify one qualified moment.',
    score,
    comparison: compared,
    evidence: compared.evidence,
    topEmotes: [
      { name: 'KEKW', provider: '7TV', count: 90, sharePct: 40 },
      { name: 'OMEGALUL', provider: '7TV', count: 60, sharePct: 27 },
      { name: 'Pog', provider: 'Twitch', count: 35, sharePct: 16 },
      { name: 'Pog4', provider: 'Twitch', count: 20, sharePct: 9 },
    ],
    momentRef: { publicMomentId: `public-${id}`, streamId: 'stream-1', occurrenceAt: at, offsetSeconds: 240 },
    notificationEligible: true,
    isLate: false,
  }
}

function rawEnvelope(moments = [moment('m1')]): Record<string, unknown> {
  const strongest = [...moments].sort((a, b) => b.score - a.score)[0]
  const latest = [...moments].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))[0]
  const broadcast = {
    id: 'pulse-xqc-stream-1',
    login: 'xqc',
    displayName: 'xQc',
    profileImageUrl: 'https://static-cdn.jtvnw.net/jtv_user_pictures/example-profile_image-70x70.png',
    category: 'Just Chatting',
    streamId: 'stream-1',
    state: 'live',
    primarySignal: 'emotes',
    momentCount: moments.length,
    strongestScore: strongest.score,
    firstActivityAt: moments[0].occurredAt,
    lastActivityAt: latest.occurredAt,
    strongestMoment: strongest,
    latestMoment: latest,
    sources: [
      { id: 'clip', source: 'twitch_clip', kind: 'clip', url: 'https://clips.twitch.tv/VerifiedClip', title: 'Matched Twitch clip', metrics: { views: 1200 } },
      { id: 'x', source: 'x', kind: 'post', url: 'https://x.com/example/status/123', title: 'Hidden X post', metrics: { likes: 9999 } },
    ],
  }
  return {
    schemaVersion: 1,
    status: 'ready',
    generatedAt: new Date(occurredAt + 2000).toISOString(),
    dataThrough: new Date(occurredAt + 1000).toISOString(),
    window: '24h',
    query: { window: '24h', signal: 'all', state: 'all', sort: 'strongest' },
    summary: { broadcastCount: 1, momentCount: moments.length, categoryCount: 1 },
    facets: {
      signals: [{ value: 'emotes', label: 'Emotes', count: 1 }],
      categories: [{ value: 'just chatting', label: 'Just Chatting', count: 1 }],
      states: [{ value: 'live', label: 'Live', count: 1 }],
    },
    broadcasts: [broadcast],
    broadcast,
    moments,
  }
}

function hookResult(data: ExplorerEnvelope | null) {
  return {
    data,
    loading: false,
    refreshing: false,
    loadingMore: false,
    error: null,
    unavailable: false,
    announcement: '',
    refresh: vi.fn(),
    loadMore: vi.fn(),
  }
}

function renderExplorer(data: ExplorerEnvelope | null, url = '/analytics/explore/pulse-xqc-stream-1') {
  mockUseExplorerData.mockImplementation(() => hookResult(data))
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/analytics/explore" element={<AnalyticsExplorerPage />} />
        <Route path="/analytics/explore/:broadcastId" element={<AnalyticsExplorerPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

function endedWithVod(vodId = '2864434763') {
  const raw = rawEnvelope([Object.assign(moment('m1'), { vodId })])
  for (const key of ['broadcast', 'broadcasts'] as const) {
    const value = raw[key]
    raw[key] = Array.isArray(value) ? value.map((item) => ({ ...item, state: 'ended' })) : { ...(value as object), state: 'ended' }
  }
  return normalizeExplorerEnvelope(raw)!
}

afterEach(() => {
  cleanup()
  mockUseExplorerData.mockReset()
  request.mockReset()
  vi.unstubAllEnvs()
})

describe('Pulse Explorer contract and workspace', () => {
  it('strictly normalizes a broadcast, preserves backend scores, and hides X context', () => {
    const normalized = normalizeExplorerEnvelope(rawEnvelope())
    expect(normalized?.broadcasts[0].strongestScore).toBe(91)
    expect(normalized?.broadcasts[0].primarySignal).toBe('emotes')
    expect(normalized?.broadcasts[0].sources.map((source) => source.source)).toEqual(['twitch_clip'])
    expect(normalizeExplorerEnvelope({ ...rawEnvelope(), schemaVersion: 2 })).toBeNull()
    expect(explorerReasonCopy('404 page not found')).not.toContain('404')
  })

  it('suppresses a meaningless one-point trend and limits display to three emotes', () => {
    const data = normalizeExplorerEnvelope(rawEnvelope())!
    renderExplorer(data)
    expect(screen.queryByRole('img', { name: /reaction score trend/i })).toBeNull()
    expect(screen.getByText(/not enough measured points/i)).toBeTruthy()
    expect(screen.getByText('Baseline coverage')).toBeTruthy()
    expect(screen.getByText('20/20 min measured')).toBeTruthy()
    expect(screen.queryByText('Pog4')).toBeNull()
    expect(screen.getByText(/never changes StreamPulse scores or ordering/i)).toBeTruthy()
  })

  it('renders a measured trend only when at least two scored moments exist', () => {
    const data = normalizeExplorerEnvelope(rawEnvelope([
      moment('m0', occurredAt - 5 * 60_000, 68),
      moment('m1', occurredAt, 91),
    ]))!
    renderExplorer(data)
    expect(screen.getByRole('img', { name: /reaction score trend with 2 measured moments/i })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Qualified moments' })).toBeTruthy()
  })

  it('disables unconfigured history windows without requesting them', () => {
    vi.stubEnv('VITE_PUBLIC_NEWSROOM_WINDOWS', '')
    renderExplorer(null, '/analytics/explore?window=7d&signal=emotes')
    const options = Array.from(screen.getByLabelText('Range').querySelectorAll('option')).map((option) => [option.textContent, option.disabled])
    expect(options).toEqual([['Live', false], ['24 hours (unavailable)', true], ['7 days (unavailable)', true]])
    expect(screen.getByText('7-day history is unavailable')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Show live broadcasts' }).getAttribute('href')).toBe('/analytics/explore?signal=emotes')
    // Neither the list nor the inspector may fetch or poll a disabled window.
    expect(mockUseExplorerData.mock.calls.length).toBeGreaterThan(0)
    expect(mockUseExplorerData.mock.calls.every(([options]) => options.enabled === false)).toBe(true)
    expect(screen.queryByText('Pulse Explorer is unavailable')).toBeNull()
  })

  it('offers every window a deployment configures', () => {
    vi.stubEnv('VITE_PUBLIC_NEWSROOM_WINDOWS', 'live,24h,7d')
    renderExplorer(normalizeExplorerEnvelope(rawEnvelope())!, '/analytics/explore?window=24h')
    expect(Array.from(screen.getByLabelText('Range').querySelectorAll('option')).every((option) => !option.disabled)).toBe(true)
    expect(screen.queryByText(/history is unavailable/)).toBeNull()
    expect(mockUseExplorerData.mock.calls[0][0]).toMatchObject({ window: '24h', enabled: true })
  })

  it('places Watch VOD at the verified VOD alignment, like the Moments review', async () => {
    request.mockResolvedValue({ data: { channel: 'xqc', vodId: '2864434763', vodAlignSeconds: -76, vodDurationSeconds: 18000,
      vodTiming: { state: 'verified' }, stream: { streamId: 'stream-1', vodId: '2864434763' } } })
    renderExplorer(endedWithVod())
    expect(screen.getByText('Checking replay…')).toBeTruthy()
    // Broadcast offset 240s; Twitch's recording started 76s after the tracked start.
    await waitFor(() => expect(screen.getByRole('link', { name: 'Watch VOD' }).getAttribute('href')).toBe('https://www.twitch.tv/videos/2864434763?t=164s'))
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][0]).toBe('/v1/portal/analytics/streams/stream-1')
  })

  it('offers no VOD link when the alignment is not verified', async () => {
    request.mockResolvedValue({ data: { channel: 'xqc', vodId: '2864434763', vodAlignSeconds: -76, vodDurationSeconds: 18000,
      vodTiming: { state: 'unavailable' }, stream: { streamId: 'stream-1', vodId: '2864434763' } } })
    renderExplorer(endedWithVod())
    await waitFor(() => expect(screen.getByText('Replay unavailable')).toBeTruthy())
    expect(screen.queryByRole('link', { name: 'Watch VOD' })).toBeNull()
  })
})

// OP1-RES-003 / CX-RES-004: a shared broadcast link must stay inspectable when
// only the list request fails or comes back empty.
describe('Pulse Explorer detail route with a failed or empty list', () => {
  type ListResult = Omit<ReturnType<typeof hookResult>, 'error'> & { error: string | null }
  function renderDetailRoute(list: ListResult, path = '/analytics/explore/pulse-xqc-stream-1') {
    const data = normalizeExplorerEnvelope(rawEnvelope())!
    mockUseExplorerData.mockImplementation((query: { broadcastId?: string }) => (query.broadcastId ? hookResult(data) : list))
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/analytics/explore" element={<AnalyticsExplorerPage />} />
          <Route path="/analytics/explore/:broadcastId" element={<AnalyticsExplorerPage />} />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('keeps the loaded broadcast and reports the list failure in the results column only', () => {
    const { container } = renderDetailRoute({ ...hookResult(null), unavailable: true, error: 'internal_error' })
    const inspector = container.querySelector('aside.explorer-inspector')
    expect(inspector).not.toBeNull()
    expect(screen.getByRole('heading', { level: 2, name: 'xQc' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to broadcasts' })).toBeTruthy()
    const results = container.querySelector('section.explorer-results') as HTMLElement
    expect(results.textContent).toContain('Pulse Explorer is unavailable')
    expect(inspector?.textContent).not.toContain('Pulse Explorer is unavailable')
    expect(container.querySelector('.pulse-explorer__workspace--single')).toBeNull()
  })

  it('keeps the loaded broadcast when the list comes back empty', () => {
    const empty = normalizeExplorerEnvelope({ ...rawEnvelope(), status: 'empty', broadcasts: [], broadcast: undefined, moments: undefined })
    const { container } = renderDetailRoute(hookResult(empty))
    expect(screen.getByRole('heading', { level: 2, name: 'xQc' })).toBeTruthy()
    expect((container.querySelector('section.explorer-results') as HTMLElement).textContent).toContain('No matching broadcasts')
  })

  it('still uses the single workspace on the index route when the list fails', () => {
    const { container } = renderDetailRoute({ ...hookResult(null), unavailable: true, error: 'internal_error' }, '/analytics/explore')
    expect(container.querySelector('aside.explorer-inspector')).toBeNull()
    expect(container.querySelector('.pulse-explorer__workspace--single')).not.toBeNull()
  })
})
