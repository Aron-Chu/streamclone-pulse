import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  resolveLivePulseMoments,
  type LivePulseMomentsResult,
} from '../src/lib/figmaSessionAnalytics'
import type { PublicHub } from '../src/lib/publicHub'
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
    {
      login: 'sodapoppin',
      displayName: 'sodapoppin',
      streamId: 's2',
      offsetSeconds: 240,
      score: 84,
      label: 'Chat spike',
      kind: 'chat_spike',
      chatPerMin: 280,
      emotesPerMin: 95,
      viewers: 9800,
      category: 'Just Chatting',
      at: now - 8 * 60_000,
      topEmotes: [{ name: 'KEKW', provider: '7tv', count: 10, sharePct: 28 }],
    },
    {
      login: 'xqc',
      displayName: 'xQc',
      streamId: 's1',
      offsetSeconds: 120,
      score: 92,
      label: 'Twitch emote spike',
      kind: 'emote_spike',
      chatPerMin: 393,
      emotesPerMin: 133,
      viewers: 12_000,
      category: 'Minecraft',
      at: now - 5 * 60_000,
      topEmotes: [{ name: 'DinoDance', provider: 'twitch', count: 123, sharePct: 39 }],
    },
  ]
  return resolveLivePulseMoments(hub)
}

function renderFeed(
  feed: LivePulseMomentsResult,
  hub = sampleHub(),
  reducedMotion = false,
  loadSource: 'full' | 'stats-fallback' | 'cache' = 'full',
  hubEndpointOk = true,
  layout: 'section' | 'ticker' = 'section',
) {
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
          layout={layout}
        />
      </AnalyticsThemeProvider>
    </MemoryRouter>,
  )
}

describe('HubLiveWireFeed', () => {
  beforeEach(() => {
    gsapFrom.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders moments newest-first with kind chips and hrefs', () => {
    const { container } = renderFeed(networkFeed())
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(2)
    expect(links[0]?.getAttribute('href')).toContain('/analytics/xqc')
    expect(links[1]?.getAttribute('href')).toContain('/analytics/sodapoppin')
    const kinds = container.querySelectorAll('.hub-live-wire__kind')
    expect(kinds[0]?.textContent).toContain('Emote spike')
    expect(kinds[1]?.textContent).toContain('Chat spike')
    expect(screen.getByText(/Twitch emote spike/)).toBeTruthy()
  })

  it('animates only newly introduced moments on re-render', async () => {
    const now = Date.now()
    const { rerender } = renderFeed(networkFeed(now), sampleHub(), false)

    const hub = sampleHub()
    hub.livePulseMoments = [
      {
        login: 'jynxzi',
        displayName: 'Jynxzi',
        streamId: 's3',
        offsetSeconds: 60,
        score: 77,
        label: 'Just went live',
        kind: 'stream_opening',
        chatPerMin: 50,
        emotesPerMin: 20,
        at: now - 30_000,
      },
      ...hub.livePulseMoments!,
    ]
    const updatedFeed = resolveLivePulseMoments(hub)

    rerender(
      <MemoryRouter>
        <AnalyticsThemeProvider>
          <HubLiveWireFeed hub={hub} feed={updatedFeed} activityWindow="24h" />
        </AnalyticsThemeProvider>
      </MemoryRouter>,
    )

    await vi.waitFor(() => {
      expect(gsapFrom).toHaveBeenCalled()
    })
    expect(screen.getByText('Jynxzi')).toBeTruthy()
    expect(document.querySelector('.hub-live-wire__kind')?.textContent).toContain('Just went live')
  })

  it('does not animate when prefers-reduced-motion is set', async () => {
    renderFeed(networkFeed(), sampleHub(), true)
    await new Promise((r) => setTimeout(r, 50))
    expect(gsapFrom).not.toHaveBeenCalled()
  })

  it('shows fallback banner without NEW badge for non-network source', () => {
    const hub = sampleHub()
    hub.featuredSession = {
      state: 'ready',
      login: 'xqc',
      streamId: 's1',
      topMoments: [
        {
          offsetSeconds: 60,
          score: 80,
          label: 'Chat spike',
          kind: 'chat',
          chatPerMin: 200,
        },
      ],
    }
    const feed = resolveLivePulseMoments(hub)
    renderFeed(feed, hub)
    expect(screen.getByText(/featured session fallback/i)).toBeTruthy()
    expect(screen.queryByText('NEW')).toBeNull()
    expect(screen.getByText(/snapshot — not live network cadence/i)).toBeTruthy()
  })

  it('shows empty reason when feed has no moments', () => {
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

  it('does not present network-live cadence when hub is stats-fallback', () => {
    renderFeed(networkFeed(), sampleHub(), false, 'stats-fallback', false)
    expect(screen.getByText(/hub unavailable — live network feed paused/i)).toBeTruthy()
    expect(screen.getByText(/aggregate stats only/i)).toBeTruthy()
    expect(screen.queryByText('NEW')).toBeNull()
  })

  it('applies hub-live-wire--ticker class when layout is ticker', () => {
    const { container } = renderFeed(networkFeed(), sampleHub(), false, 'full', true, 'ticker')
    expect(container.querySelector('.hub-live-wire--ticker')).toBeTruthy()
    expect(container.querySelectorAll('.hub-live-wire__chip').length).toBe(2)
    expect(container.querySelector('.hub-live-wire__kind')).toBeNull()
    expect(container.querySelector('.hub-live-wire__ticker-viewport--marquee')).toBeNull()
    expect(container.querySelectorAll('.hub-live-wire__chip-event').length).toBe(2)
    expect(screen.getByText('Emote spike')).toBeTruthy()
    expect(screen.getByText('Chat spike')).toBeTruthy()
    expect(screen.getByText(/DinoDance/)).toBeTruthy()
    expect(screen.getByText('280 chat/m')).toBeTruthy()
    expect(screen.queryByText('133 emotes/m')).toBeNull()
  })

  it('animates horizontally on new moments when layout is ticker', async () => {
    const now = Date.now()
    const { rerender } = renderFeed(networkFeed(now), sampleHub(), false, 'full', true, 'ticker')

    await vi.waitFor(() => {
      expect(gsapFrom).toHaveBeenCalled()
    })
    gsapFrom.mockClear()

    const hub = sampleHub()
    hub.livePulseMoments = [
      {
        login: 'jynxzi',
        displayName: 'Jynxzi',
        streamId: 's3',
        offsetSeconds: 60,
        score: 77,
        label: 'Just went live',
        kind: 'stream_opening',
        chatPerMin: 50,
        emotesPerMin: 20,
        at: now - 30_000,
      },
      ...hub.livePulseMoments!,
    ]
    const updatedFeed = resolveLivePulseMoments(hub)

    rerender(
      <MemoryRouter>
        <AnalyticsThemeProvider>
          <HubLiveWireFeed hub={hub} feed={updatedFeed} activityWindow="24h" layout="ticker" />
        </AnalyticsThemeProvider>
      </MemoryRouter>,
    )

    await vi.waitFor(() => {
      expect(gsapFrom).toHaveBeenCalled()
    })
    expect(gsapFrom).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ x: -24, opacity: 0 }),
    )
    expect(screen.getByText('Jynxzi')).toBeTruthy()
  })
})
