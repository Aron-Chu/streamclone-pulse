import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  resolveLivePulseMoments,
  type FigmaMomentRow,
  type LivePulseMomentsResult,
} from '../src/lib/figmaSessionAnalytics'
import type { HubLivePulseMoment, PublicHub } from '../src/lib/publicHub'
import { hubCorpusPipelineFixture } from '../src/lib/publicHub'
import { HubLiveWireFeed } from '../src/ui/components/analytics/HubLiveWireFeed'
import { AnalyticsThemeProvider } from '../src/ui/providers/AnalyticsThemeProvider'

const { gsapFrom } = vi.hoisted(() => ({ gsapFrom: vi.fn() }))

vi.mock('gsap', () => ({
  default: { to: vi.fn(), from: gsapFrom, fromTo: vi.fn(), registerPlugin: vi.fn() },
}))

function comparison(eventAt: number) {
  const end = Math.floor(eventAt / 60_000) * 60_000
  const baseline = {
    state: 'ready' as const,
    currentPerMin: 133,
    baselinePerMin: 40,
    absoluteDeltaPerMin: 93,
    changePct: 232.5,
    multiplier: 3.325,
    currentMeasuredMinutes: 1,
    currentExpectedMinutes: 1,
    baselineMeasuredMinutes: 24,
    baselineExpectedMinutes: 30,
    baselineCoveragePct: 80,
  }
  return {
    baselineKind: 'current_stream_measured_average_before_event' as const,
    eventAt,
    baselineWindow: {
      start: end - 30 * 60_000,
      end,
      expectedMinutes: 30,
      measuredMinutes: 24,
      coveragePct: 80,
    },
    chat: { ...baseline, currentPerMin: 393, baselinePerMin: 160, absoluteDeltaPerMin: 233, changePct: 145.6, multiplier: 2.456 },
    emotes: baseline,
    evidence: {
      ircBound: true,
      eventRollupAvailable: true,
      baselineMeasuredMinutes: 24,
      baselineExpectedMinutes: 30,
      baselineCoveragePct: 80,
    },
  }
}

function makeMoment(overrides: Partial<HubLivePulseMoment> & Pick<HubLivePulseMoment, 'login'>): HubLivePulseMoment {
  return {
    offsetSeconds: 60,
    label: 'Chat spike',
    kind: 'chat_spike',
    chatPerMin: 200,
    emotesPerMin: 40,
    viewers: 5000,
    category: 'Just Chatting',
    at: Date.now() - 2 * 60_000,
    streamId: `s-${overrides.login}`,
    ...overrides,
    score: overrides.score ?? 80,
  }
}

function sampleHub(): PublicHub {
  return {
    generatedAt: new Date().toISOString(),
    poolSize: 96,
    corpus: { streamsTracked: 1200, momentsDetected: 45000, chatMessagesProcessed: 9_000_000, emotesIndexed: 120_000, vodsAnalyzed: 800 },
    coverage: { liveChannels: 2, trackingMax: 300, backfillActive: 0, backfillMax: 4, syncActive: 0, emotesIndexed: 120_000, databaseOk: true, state: 'operational' },
    corpusPipeline: hubCorpusPipelineFixture({
      generatedAt: new Date().toISOString(), state: 'healthy', topN: 500, collectorActive: 40, collectorMax: 96,
      roster: { live: 2, collectorTracking: 2, expectedCollectorRows: 2, liveCollectorDeficitRows: 0, metadataOnly: 0, metadataStale: 0, admissionDisabled: 0, capacityBlocked: 0, warming: 0, collecting: 2, viewerOnly: 0, zeroChatAfterAge: 0 },
    }),
    activity: { points: [], windowMinutes: 24 * 60, channelCount: 2 },
    emoteIntel: { emotesPerMin: 88, topEmoteSharePct: 22, uniqueEmotes: 140, biggestPeakPerMin: 320, seventvSharePct: 61, providerShares: [] },
    topEmotes: [{ name: 'KEKW', provider: '7tv', count: 900, sharePct: 22 }],
    topMovers: [],
    liveChannels: [
      { login: 'xqc', displayName: 'xQc', category: 'Minecraft', viewers: 12000, chatPerMin: 393, emotesPerMin: 133, seventvPerMin: 100, coverageState: 'synced', trendPct: 5 },
      { login: 'sodapoppin', displayName: 'sodapoppin', category: 'Just Chatting', viewers: 9800, chatPerMin: 280, emotesPerMin: 95, seventvPerMin: 70, coverageState: 'synced', trendPct: -2 },
    ],
    moments: [], livePulseMoments: [], featuredSession: { state: 'empty', reason: 'no_qualifying_session' },
  }
}

function networkFeed(now = Date.now()): { hub: PublicHub; feed: LivePulseMomentsResult } {
  const hub = sampleHub()
  const eventAt = now - 5 * 60_000
  hub.livePulseMoments = [
    makeMoment({ login: 'xqc', displayName: 'xQc', streamId: 's1', kind: 'emote_spike', label: 'Twitch emote spike', chatPerMin: 393, emotesPerMin: 133, viewers: 12_000, category: 'Minecraft', at: eventAt, comparison: comparison(eventAt), topEmotes: [{ name: 'DinoDance', provider: 'twitch', count: 123, sharePct: 39 }] }),
    makeMoment({ login: 'sodapoppin', displayName: 'sodapoppin', streamId: 's2', chatPerMin: 280, emotesPerMin: 95, viewers: 9800, category: 'Just Chatting', at: now - 8 * 60_000 }),
  ]
  return { hub, feed: resolveLivePulseMoments(hub) }
}

function renderFeed(
  feed: LivePulseMomentsResult,
  hub = sampleHub(),
  opts: {
    reducedMotion?: boolean
    loadSource?: 'full' | 'stats-fallback' | 'cache'
    hubEndpointOk?: boolean
    pollSequence?: number
    selectedMomentKey?: string | null
    onSelectMoment?: (moment: FigmaMomentRow) => void
    canSelectMoment?: (moment: FigmaMomentRow) => boolean
  } = {},
) {
  const { reducedMotion = false, loadSource = 'full', hubEndpointOk = true, pollSequence = 0, selectedMomentKey, onSelectMoment, canSelectMoment } = opts
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reducedMotion && query.includes('prefers-reduced-motion'), media: query, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }))
  return render(
    <MemoryRouter><AnalyticsThemeProvider><HubLiveWireFeed
      hub={hub} feed={feed} activityWindow="24h" loadSource={loadSource}
      hubEndpointOk={hubEndpointOk} pollSequence={pollSequence} layout="lane"
      selectedMomentKey={selectedMomentKey} onSelectMoment={onSelectMoment}
      canSelectMoment={canSelectMoment}
    /></AnalyticsThemeProvider></MemoryRouter>,
  )
}

describe('HubLiveWireFeed (chart event tape)', () => {
  beforeEach(() => gsapFrom.mockClear())
  afterEach(() => vi.restoreAllMocks())

  it('shows streamer-relative facts and evidence instead of feed-relative progress bars', () => {
    const { hub, feed } = networkFeed()
    renderFeed(feed, hub)
    expect(screen.getByText(/3\.3× this stream's earlier average/i)).toBeTruthy()
    expect(screen.getByText(/2\.5× this stream's earlier average/i)).toBeTruthy()
    expect(screen.getByText(/Earlier baseline 24\/30 min · 80% coverage/i)).toBeTruthy()
    expect(screen.getAllByText('Strong · 80/100').length).toBeGreaterThan(0)
    expect(document.querySelector('.hub-live-wire__bar')).toBeNull()
    expect(document.querySelectorAll('.hub-live-wire__event-card').length).toBe(2)
  })

  it('labels raw event measurements when earlier-stream comparison evidence is absent', () => {
    const { hub, feed } = networkFeed()
    renderFeed(feed, hub)
    expect(screen.getByText(/Chat 280\/min · earlier comparison unavailable/i)).toBeTruthy()
    expect(screen.getByText(/Emotes 95\/min · earlier comparison unavailable/i)).toBeTruthy()
    expect(screen.getByText(/^Comparison unavailable$/i)).toBeTruthy()
  })

  it('keeps Live Wire honest by omitting detections older than 30 minutes', () => {
    const now = Date.now()
    const hub = sampleHub()
    hub.livePulseMoments = [
      makeMoment({ login: 'xqc', displayName: 'xQc', streamId: 's1', at: now - 2 * 60_000 }),
      makeMoment({ login: 'sodapoppin', displayName: 'sodapoppin', streamId: 's2', at: now - 45 * 60_000 }),
    ]
    renderFeed(resolveLivePulseMoments(hub), hub)
    expect(screen.getByText('xQc')).toBeTruthy()
    expect(screen.queryByText('sodapoppin')).toBeNull()
    expect(screen.queryByRole('button', { name: /recent detections/i })).toBeNull()
  })

  it('shows one clearly historical latest-verified detection when the live window is quiet', () => {
    const now = Date.now()
    const hub = sampleHub()
    hub.livePulseMoments = [
      makeMoment({ login: 'xqc', displayName: 'xQc', streamId: 's1', at: now - 2 * 60 * 60_000 }),
      makeMoment({ login: 'sodapoppin', displayName: 'sodapoppin', streamId: 's2', at: now - 45 * 60_000 }),
    ]
    renderFeed(resolveLivePulseMoments(hub), hub, { onSelectMoment: vi.fn(), canSelectMoment: () => false })
    expect(screen.getByText('Quiet now')).toBeTruthy()
    expect(screen.getByText(/Latest verified · Chat breakout/i)).toBeTruthy()
    expect(screen.getByText('sodapoppin')).toBeTruthy()
    expect(screen.queryByText('xQc')).toBeNull()
    expect(screen.queryByText('NEW')).toBeNull()
    expect(screen.getByRole('link', { name: /Latest verified historical detection.*Open analytics/i }).getAttribute('href')).toBe('/analytics/sodapoppin/s2#t=60')
  })

  it('inspects a latest-verified detection only after the parent proves its bucket is loaded', () => {
    const hub = sampleHub()
    hub.livePulseMoments = [makeMoment({ login: 'xqc', displayName: 'xQc', streamId: 's1', at: Date.now() - 45 * 60_000 })]
    const onSelectMoment = vi.fn()
    renderFeed(resolveLivePulseMoments(hub), hub, { onSelectMoment, canSelectMoment: () => true })
    const card = screen.getByRole('button', { name: /Latest verified historical detection.*Show this minute/i })
    fireEvent.click(card)
    expect(onSelectMoment).toHaveBeenCalledWith(expect.objectContaining({ streamId: 's1' }))
  })

  it('keeps the simple quiet state when the latest detection is older than 24 hours', () => {
    const hub = sampleHub()
    hub.livePulseMoments = [makeMoment({ login: 'xqc', displayName: 'xQc', streamId: 's1', at: Date.now() - 25 * 60 * 60_000 })]
    renderFeed(resolveLivePulseMoments(hub), hub)
    expect(screen.getByText(/No qualifying breakout occurred in the last 30 minutes/i)).toBeTruthy()
    expect(screen.queryByText(/Latest verified/i)).toBeNull()
    expect(screen.queryByText('xQc')).toBeNull()
  })

  it('selects the matching chart moment without nesting navigation links', () => {
    const { hub, feed } = networkFeed()
    const onSelectMoment = vi.fn()
    renderFeed(feed, hub, { onSelectMoment, canSelectMoment: () => true })
    const card = screen.getByRole('button', { name: /xQc.*show this minute/i })
    fireEvent.click(card)
    expect(onSelectMoment).toHaveBeenCalledWith(expect.objectContaining({ login: 'xqc' }))
    expect(card.querySelector('a')).toBeNull()
  })

  it('uses canonical navigation when a live detection has no rendered chart bucket', () => {
    const { hub, feed } = networkFeed()
    renderFeed(feed, hub, { onSelectMoment: vi.fn(), canSelectMoment: () => false })
    expect(screen.queryByRole('button', { name: /xQc.*show this minute/i })).toBeNull()
    expect(screen.getByRole('link', { name: /xQc.*Open analytics/i }).getAttribute('href'))
      .toBe('/analytics/xqc/s1#t=60')
  })

  it('badges a new healthy-network event and enters it from the chart-reading direction', async () => {
    const now = Date.now()
    const hub = sampleHub()
    hub.livePulseMoments = [makeMoment({ login: 'xqc', displayName: 'xQc', streamId: 's1' })]
    const rendered = renderFeed(resolveLivePulseMoments(hub), hub, { pollSequence: 0 })
    await new Promise((resolve) => setTimeout(resolve, 20))
    hub.livePulseMoments = [...hub.livePulseMoments, makeMoment({ login: 'jynxzi', displayName: 'Jynxzi', streamId: 's3', at: now - 30_000 })]
    rendered.rerender(<MemoryRouter><AnalyticsThemeProvider><HubLiveWireFeed hub={hub} feed={resolveLivePulseMoments(hub)} loadSource="full" hubEndpointOk pollSequence={1} layout="lane" /></AnalyticsThemeProvider></MemoryRouter>)
    await vi.waitFor(() => expect(screen.getByText('NEW')).toBeTruthy())
    expect(gsapFrom).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ x: -24, opacity: 0 }))
  })

  it('keeps semantic NEW but suppresses motion for reduced-motion users', async () => {
    const now = Date.now()
    const hub = sampleHub()
    hub.livePulseMoments = [makeMoment({ login: 'xqc', displayName: 'xQc', streamId: 's1' })]
    const rendered = renderFeed(resolveLivePulseMoments(hub), hub, { reducedMotion: true, pollSequence: 0 })
    await new Promise((resolve) => setTimeout(resolve, 20))
    hub.livePulseMoments = [...hub.livePulseMoments, makeMoment({ login: 'jynxzi', displayName: 'Jynxzi', streamId: 's3', at: now - 30_000 })]
    rendered.rerender(<MemoryRouter><AnalyticsThemeProvider><HubLiveWireFeed hub={hub} feed={resolveLivePulseMoments(hub)} loadSource="full" hubEndpointOk pollSequence={1} layout="lane" /></AnalyticsThemeProvider></MemoryRouter>)
    await vi.waitFor(() => expect(screen.getByText('NEW')).toBeTruthy())
    expect(gsapFrom).not.toHaveBeenCalled()
  })

  it('filters lifecycle events and explains degraded source state', () => {
    const hub = sampleHub()
    hub.livePulseMoments = [
      makeMoment({ login: 'jynxzi', displayName: 'Jynxzi', streamId: 's3' }),
      { ...makeMoment({ login: 'pool', displayName: 'pool', streamId: 's9' }), kind: 'stream_opening', label: 'Just went live' },
    ]
    renderFeed(resolveLivePulseMoments(hub), hub, { loadSource: 'stats-fallback', hubEndpointOk: false })
    expect(screen.getByText('Jynxzi')).toBeTruthy()
    expect(screen.queryByText('pool')).toBeNull()
    expect(screen.getByText(/live network feed paused/i)).toBeTruthy()
    expect(document.querySelectorAll('.hub-live-wire').length).toBe(1)
  })
})
