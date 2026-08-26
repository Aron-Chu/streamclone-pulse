import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  resolveLivePulseMoments,
  type LivePulseMomentsResult,
} from '../src/lib/figmaSessionAnalytics'
import type { HubLivePulseMoment, PublicHub } from '../src/lib/publicHub'
import { hubCorpusPipelineFixture } from '../src/lib/publicHub'
import { HubLiveWireFeed } from '../src/ui/components/analytics/HubLiveWireFeed'
import { AnalyticsThemeProvider } from '../src/ui/providers/AnalyticsThemeProvider'

const { gsapFrom } = vi.hoisted(() => ({
  gsapFrom: vi.fn(),
}))

vi.mock('gsap', () => ({
  default: {
    to: vi.fn(),
    from: gsapFrom,
    fromTo: vi.fn(),
    registerPlugin: vi.fn(),
  },
}))

/** A peak moment factory that keeps timestamp/identity fields consistent. */
function makeMoment(
  overrides: Partial<HubLivePulseMoment> & Pick<HubLivePulseMoment, 'login'>,
): HubLivePulseMoment {
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
    corpus: {
      streamsTracked: 1200,
      momentsDetected: 45000,
      chatMessagesProcessed: 9_000_000,
      emotesIndexed: 120_000,
      vodsAnalyzed: 800,
    },
    coverage: {
      liveChannels: 2,
      trackingMax: 300,
      backfillActive: 0,
      backfillMax: 4,
      syncActive: 0,
      emotesIndexed: 120_000,
      databaseOk: true,
      state: 'operational',
    },
    corpusPipeline: hubCorpusPipelineFixture({
      generatedAt: new Date().toISOString(),
      state: 'healthy',
      topN: 500,
      collectorActive: 40,
      collectorMax: 96,
      roster: {
        live: 2,
        collectorTracking: 2,
        expectedCollectorRows: 2,
        liveCollectorDeficitRows: 0,
        metadataOnly: 0,
        metadataStale: 0,
        admissionDisabled: 0,
        capacityBlocked: 0,
        warming: 0,
        collecting: 2,
        viewerOnly: 0,
        zeroChatAfterAge: 0,
      },
    }),
    activity: { points: [], windowMinutes: 24 * 60, channelCount: 2 },
    emoteIntel: {
      emotesPerMin: 88,
      topEmoteSharePct: 22,
      uniqueEmotes: 140,
      biggestPeakPerMin: 320,
      seventvSharePct: 61,
      providerShares: [],
    },
    topEmotes: [{ name: 'KEKW', provider: '7tv', count: 900, sharePct: 22 }],
    topMovers: [],
    liveChannels: [
      {
        login: 'xqc',
        displayName: 'xQc',
        category: 'Minecraft',
        viewers: 12000,
        chatPerMin: 393,
        emotesPerMin: 133,
        seventvPerMin: 100,
        coverageState: 'synced',
        trendPct: 5,
      },
      {
        login: 'sodapoppin',
        displayName: 'sodapoppin',
        category: 'Just Chatting',
        viewers: 9800,
        chatPerMin: 280,
        emotesPerMin: 95,
        seventvPerMin: 70,
        coverageState: 'synced',
        trendPct: -2,
      },
    ],
    moments: [],
    livePulseMoments: [],
    featuredSession: { state: 'empty', reason: 'no_qualifying_session' },
  }
}

function networkFeed(now = Date.now()): LivePulseMomentsResult {
  const hub = sampleHub()
  hub.livePulseMoments = [
    makeMoment({
      login: 'xqc',
      displayName: 'xQc',
      streamId: 's1',
      kind: 'emote_spike',
      label: 'Twitch emote spike',
      chatPerMin: 393,
      emotesPerMin: 133,
      viewers: 12_000,
      category: 'Minecraft',
      at: now - 5 * 60_000,
      topEmotes: [{ name: 'DinoDance', provider: 'twitch', count: 123, sharePct: 39 }],
    }),
    makeMoment({
      login: 'sodapoppin',
      displayName: 'sodapoppin',
      streamId: 's2',
      chatPerMin: 280,
      emotesPerMin: 95,
      viewers: 9800,
      category: 'Just Chatting',
      at: now - 8 * 60_000,
      topEmotes: [{ name: 'KEKW', provider: '7tv', count: 10, sharePct: 28 }],
    }),
  ]
  return resolveLivePulseMoments(hub)
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
    onSelectMoment?: (moment: import('../src/lib/figmaSessionAnalytics').FigmaMomentRow) => void
  } = {},
) {
  const {
    reducedMotion = false,
    loadSource = 'full',
    hubEndpointOk = true,
    pollSequence = 0,
    selectedMomentKey,
    onSelectMoment,
  } = opts
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reducedMotion && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }))

  return render(
    <MemoryRouter>
      <AnalyticsThemeProvider>
        <HubLiveWireFeed
          hub={hub}
          feed={feed}
          activityWindow="24h"
          loadSource={loadSource}
          hubEndpointOk={hubEndpointOk}
          pollSequence={pollSequence}
          layout="lane"
          selectedMomentKey={selectedMomentKey}
          onSelectMoment={onSelectMoment}
        />
      </AnalyticsThemeProvider>
    </MemoryRouter>,
  )
}

describe('HubLiveWireFeed (chart annotation lane)', () => {
  beforeEach(() => {
    gsapFrom.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders compact selectable chips without a duplicate card rail', () => {
    const feed = networkFeed()
    const onSelectMoment = vi.fn()
    renderFeed(feed, sampleHub(), { onSelectMoment })
    expect(document.querySelector('.hub-live-wire--lane')).toBeTruthy()
    expect(document.querySelector('.hub-live-wire__rail-card')).toBeNull()
    const chip = screen.getAllByRole('button').find((button) => button.classList.contains('hub-live-wire__chip'))
    expect(chip?.textContent).toContain('xQc')
    expect(chip?.textContent).toContain('Emote spike')
    fireEvent.click(chip!)
    expect(onSelectMoment).toHaveBeenCalledWith(expect.objectContaining({ login: 'xqc' }))
  })

  it('explains an event against earlier stream evidence instead of visible-card normalization', () => {
    const hub = sampleHub()
    const metric = {
      state: 'ready' as const,
      currentPerMin: 80,
      baselinePerMin: 40,
      absoluteDeltaPerMin: 40,
      changePct: 100,
      multiplier: 2,
      currentMeasuredMinutes: 1,
      currentExpectedMinutes: 1,
      baselineMeasuredMinutes: 20,
      baselineExpectedMinutes: 20,
      baselineCoveragePct: 100,
    }
    hub.livePulseMoments = [makeMoment({
      login: 'xqc',
      label: 'Emote surge',
      comparison: {
        baselineKind: 'current_stream_measured_average_before_event',
        eventAt: Date.now() - 60_000,
        baselineWindow: { start: 300_000, end: 1_500_000, expectedMinutes: 20, measuredMinutes: 20, coveragePct: 100 },
        chat: metric,
        emotes: metric,
        evidence: {
          ircBound: true,
          eventRollupAvailable: true,
          baselineMeasuredMinutes: 20,
          baselineExpectedMinutes: 20,
          baselineCoveragePct: 100,
        },
      },
    })]
    renderFeed(resolveLivePulseMoments(hub), hub)
    expect(screen.getByText(/Emotes reached 80\/min · 2.0× this stream's earlier average/)).toBeTruthy()
    expect(screen.getByText('Breakout strength 80/100')).toBeTruthy()
    expect(document.querySelector('.hub-live-wire__rail-comparisons')).toBeNull()
    expect(document.querySelector('.hub-live-wire__bar-fill')).toBeNull()
  })

  it('excludes moments older than 30m from the annotation lane', () => {
    const now = Date.now()
    const hub = sampleHub()
    hub.livePulseMoments = [
      makeMoment({
        login: 'xqc',
        displayName: 'xQc',
        streamId: 's1',
        category: 'Minecraft',
        at: now - 2 * 60_000,
      }),
      makeMoment({
        login: 'sodapoppin',
        displayName: 'sodapoppin',
        streamId: 's2',
        category: 'Just Chatting',
        at: now - 45 * 60_000,
      }),
    ]
    const feed = resolveLivePulseMoments(hub)

    renderFeed(feed, hub, { pollSequence: 1 })

    expect(screen.getByText('xQc')).toBeTruthy()
    expect(screen.queryByText('sodapoppin')).toBeNull()
    expect(screen.queryByRole('button', { name: /recent detections/i })).toBeNull()
  })

  it('badges NEW only when network + full + hubEndpointOk, with left-entry motion', async () => {
    const now = Date.now()
    const hub = sampleHub()
    // Baseline poll (pollSequence 0) seeds the seen-set — no NEW burst.
    hub.livePulseMoments = [makeMoment({ login: 'xqc', displayName: 'xQc', streamId: 's1' })]
    let feed = resolveLivePulseMoments(hub)
    const { rerender } = renderFeed(feed, hub, { pollSequence: 0 })
    await new Promise((r) => setTimeout(r, 30))

    // Second poll brings a brand-new moment.
    hub.livePulseMoments = [
      ...(hub.livePulseMoments ?? []),
      makeMoment({ login: 'jynxzi', displayName: 'Jynxzi', streamId: 's3', at: now - 30_000 }),
    ]
    feed = resolveLivePulseMoments(hub)
    rerender(
      <MemoryRouter>
        <AnalyticsThemeProvider>
          <HubLiveWireFeed
            hub={hub}
            feed={feed}
            activityWindow="24h"
            loadSource="full"
            hubEndpointOk={true}
            pollSequence={1}
            layout="lane"
          />
        </AnalyticsThemeProvider>
      </MemoryRouter>,
    )

    await vi.waitFor(() => {
      expect(screen.getByText('NEW')).toBeTruthy()
    })
    // New annotations enter from the lane's left edge.
    expect(gsapFrom).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ x: -24, opacity: 0 }),
    )
    expect(screen.getByText('Jynxzi')).toBeTruthy()
  })

  it('never shows NEW when the source is not a healthy full network feed', async () => {
    const hub = sampleHub()
    hub.livePulseMoments = [
      makeMoment({ login: 'jynxzi', displayName: 'Jynxzi', streamId: 's3' }),
    ]
    const feed = resolveLivePulseMoments(hub)

    // stats-fallback + hubEndpointOk=false -> not hard-gated healthy.
    renderFeed(feed, hub, { loadSource: 'stats-fallback', hubEndpointOk: false, pollSequence: 1 })
    await new Promise((r) => setTimeout(r, 30))
    expect(screen.queryByText('NEW')).toBeNull()
    expect(gsapFrom).not.toHaveBeenCalled()
    expect(screen.getByText(/aggregate stats only/i)).toBeTruthy()
  })

  it('does not animate when prefers-reduced-motion is set, but keeps semantic NEW', async () => {
    const now = Date.now()
    const hub = sampleHub()
    // Baseline poll seeds the seen-set.
    hub.livePulseMoments = [makeMoment({ login: 'xqc', displayName: 'xQc', streamId: 's1' })]
    let feed = resolveLivePulseMoments(hub)
    const { rerender } = renderFeed(feed, hub, { reducedMotion: true, pollSequence: 0 })
    await new Promise((r) => setTimeout(r, 30))

    // Second poll brings a brand-new moment under reduced motion.
    hub.livePulseMoments = [
      ...(hub.livePulseMoments ?? []),
      makeMoment({ login: 'jynxzi', displayName: 'Jynxzi', streamId: 's3', at: now - 30_000 }),
    ]
    feed = resolveLivePulseMoments(hub)
    rerender(
      <MemoryRouter>
        <AnalyticsThemeProvider>
          <HubLiveWireFeed
            hub={hub}
            feed={feed}
            activityWindow="24h"
            loadSource="full"
            hubEndpointOk={true}
            pollSequence={1}
            layout="lane"
          />
        </AnalyticsThemeProvider>
      </MemoryRouter>,
    )

    await new Promise((r) => setTimeout(r, 30))
    expect(gsapFrom).not.toHaveBeenCalled()
    // Semantic NEW is retained despite no animation.
    expect(screen.getByText('NEW')).toBeTruthy()
    expect(screen.getByText('Jynxzi')).toBeTruthy()
  })

  it('filters lifecycle kinds out of Live Wire (Pool Wire owns openings)', () => {
    const now = Date.now()
    const hub = sampleHub()
    hub.livePulseMoments = [
      makeMoment({ login: 'jynxzi', displayName: 'Jynxzi', streamId: 's3', at: now - 30_000 }),
      {
        ...makeMoment({ login: 'pool', displayName: 'pool', streamId: 's9', at: now - 20_000 }),
        kind: 'stream_opening',
        label: 'Just went live',
      },
    ]
    const feed = resolveLivePulseMoments(hub)
    expect(feed.moments.some((m) => m.kind === 'stream_opening')).toBe(true)
    renderFeed(feed, hub)
    expect(screen.queryByText('pool')).toBeNull()
    expect(screen.queryByText(/Just went live/i)).toBeNull()
    expect(screen.getByText('Jynxzi')).toBeTruthy()
  })

  it('omits future and stale timestamps from the one live lane', () => {
    const now = Date.now()
    const hub = sampleHub()
    hub.livePulseMoments = [
      makeMoment({ login: 'xqc', displayName: 'xQc', streamId: 's1', at: now - 2 * 60_000 }),
      makeMoment({ login: 'sodapoppin', displayName: 'sodapoppin', streamId: 's2', at: now - 45 * 60_000 }),
      makeMoment({ login: 'jynxzi', displayName: 'Jynxzi', streamId: 's3', at: now + 60 * 60_000 }),
    ]
    const feed = resolveLivePulseMoments(hub)
    renderFeed(feed, hub)

    expect(screen.getByText('xQc')).toBeTruthy()
    expect(screen.queryByText('sodapoppin')).toBeNull()
    expect(screen.queryByText('Jynxzi')).toBeNull()
    expect(screen.queryByRole('button', { name: /Recent detections/i })).toBeNull()
  })

  it('uses the frozen quiet message when every valid detection is older than 30m', () => {
    const hub = sampleHub()
    hub.livePulseMoments = [
      makeMoment({
        login: 'sodapoppin',
        displayName: 'sodapoppin',
        streamId: 's2',
        at: Date.now() - 45 * 60_000,
      }),
    ]

    renderFeed(resolveLivePulseMoments(hub), hub)

    expect(screen.queryByText('sodapoppin')).toBeNull()
    expect(screen.getByText('No network breakouts in the last 30m')).toBeTruthy()
  })

  it('shows empty reason and honesty banner when feed has no moments', () => {
    const hub = sampleHub()
    hub.livePulseMomentsReason = 'insufficient_peaks'
    const feed: LivePulseMomentsResult = {
      moments: [],
      source: 'empty',
      reason: 'insufficient_peaks',
    }
    renderFeed(feed, hub)
    expect(screen.getByText(/no peaks were detected yet/i)).toBeTruthy()
  })

  it('keeps the outer container as a single list landmark (no duplicate rail mount)', () => {
    const { container } = renderFeed(networkFeed())
    expect(container.querySelectorAll('.hub-live-wire').length).toBe(1)
  })
})
