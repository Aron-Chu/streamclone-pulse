import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { explorerReasonCopy, normalizeExplorerEnvelope, type ExplorerEnvelope } from '../src/lib/explorer'

const { mockUseExplorerData } = vi.hoisted(() => ({ mockUseExplorerData: vi.fn() }))
vi.mock('../src/hooks/useExplorerData', () => ({ useExplorerData: mockUseExplorerData }))

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

function renderExplorer(data: ExplorerEnvelope) {
  mockUseExplorerData.mockImplementation(() => hookResult(data))
  return render(
    <MemoryRouter initialEntries={['/analytics/explore/pulse-xqc-stream-1']}>
      <Routes><Route path="/analytics/explore/:broadcastId" element={<AnalyticsExplorerPage />} /></Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  mockUseExplorerData.mockReset()
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
})
