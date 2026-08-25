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
  } = {},
) {
  const { reducedMotion = false, loadSource = 'full', hubEndpointOk = true, pollSequence = 0 } = opts
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
          layout="rail"
        />
      </AnalyticsThemeProvider>
    </MemoryRouter>,
  )
}

describe('HubLiveWireFeed (right rail)', () => {
  beforeEach(() => {
    gsapFrom.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders rail cards as articles with sibling action links (no link-in-link)', () => {
    const feed = networkFeed()
    renderFeed(feed)
    const articles = document.querySelectorAll('article.hub-live-wire__rail-card')
    expect(articles.length).toBeGreaterThan(0)
    expect(document.querySelector('ul[role="list"]')).toBeTruthy()
    expect(document.querySelectorAll('li[role="listitem"]').length).toBe(articles.length)

    // First card is xQc (newest) with category + actions.
    const first = articles[0] as HTMLElement
    expect(first.textContent).toContain('xQc')
    expect(first.textContent).toContain('Minecraft')
    expect(first.textContent).toContain('Twitch emote spike')
    // No outer Link wrapping the article.
    expect(first.closest('a')).toBeNull()
    // Sibling action links live inside the card.
    const actionLinks = [...first.querySelectorAll('a')]
    expect(actionLinks.length).toBeGreaterThan(0)
    expect(actionLinks.some((a) => (a.textContent ?? '').includes('View moment'))).toBe(true)
  })

  it('keeps older-than-30m rows in the Recent detections disclosure (no 30m omission)', () => {
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

    // Older rows are retained but hidden behind the collapsed disclosure.
    expect(screen.queryByText('sodapoppin')).toBeNull()
    const disclosure = screen.getByRole('button', { name: /recent detections/i })
    expect(disclosure.getAttribute('aria-expanded')).toBe('false')
    expect(disclosure.textContent).toContain('1')

    fireEvent.click(disclosure)
    expect(disclosure.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('sodapoppin')).toBeTruthy()
  })

  it('badges NEW only when network + full + hubEndpointOk, with right-entry motion', async () => {
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
            layout="rail"
          />
        </AnalyticsThemeProvider>
      </MemoryRouter>,
    )

    await vi.waitFor(() => {
      expect(screen.getByText('NEW')).toBeTruthy()
    })
    // Right-entry motion: gsap from x:24.
    expect(gsapFrom).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ x: 24, opacity: 0 }),
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
            layout="rail"
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
