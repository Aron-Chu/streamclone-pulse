import { fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearBucketMomentsCache,
  writeBucketMomentsCache,
} from '../src/lib/bucketMomentsCache'
import {
  type LivePulseMomentsResult,
} from '../src/lib/figmaSessionAnalytics'
import {
  hubCorpusPipelineFixture,
  type PublicHub,
} from '../src/lib/publicHub'
import {
  PulseMomentsLivePanel,
  type PulseMomentsLivePanelProps,
} from '../src/ui/components/analytics/PulseMomentsLivePanel'
import { AnalyticsThemeProvider } from '../src/ui/providers/AnalyticsThemeProvider'

vi.mock('gsap', () => ({
  default: {
    to: vi.fn(),
    from: vi.fn(),
    fromTo: vi.fn(),
    registerPlugin: vi.fn(),
  },
}))

const now = Date.now()

afterEach(() => {
  clearBucketMomentsCache()
})

const feed: LivePulseMomentsResult = {
  source: 'network',
  moments: [
    {
      login: 'xqc',
      displayName: 'xQc',
      streamId: 's1',
      offsetSeconds: 120,
      score: 92,
      label: 'Twitch emote spike',
      kind: 'emote_spike',
      at: now - 60_000,
      chatPerMin: 393,
      emotesPerMin: 133,
      viewers: 12_000,
      topEmotes: [
        { name: 'DinoDance', provider: 'twitch', count: 123, sharePct: 39 },
      ],
    },
    {
      login: 'sodapoppin',
      displayName: 'sodapoppin',
      streamId: 's2',
      offsetSeconds: 60,
      score: 78,
      label: 'Chat spike',
      kind: 'chat_spike',
      at: now - 180_000,
      chatPerMin: 280,
      emotesPerMin: 50,
      viewers: 9800,
    },
    {
      login: 'xqc',
      displayName: 'xQc',
      streamId: 's1',
      offsetSeconds: 300,
      score: 85,
      label: 'Chat spike',
      kind: 'chat_spike',
      at: now - 120_000,
      chatPerMin: 410,
      emotesPerMin: 80,
      viewers: 12500,
    },
  ],
}

function sampleHub(): PublicHub {
  return {
    generatedAt: new Date().toISOString(),
    poolSize: 1,
    corpus: {
      streamsTracked: 1,
      momentsDetected: 1,
      chatMessagesProcessed: 393,
      emotesIndexed: 1,
      vodsAnalyzed: 0,
    },
    coverage: {
      liveChannels: 1,
      trackingMax: 300,
      backfillActive: 0,
      backfillMax: 4,
      syncActive: 0,
      emotesIndexed: 1,
      databaseOk: true,
      state: 'operational',
    },
    corpusPipeline: hubCorpusPipelineFixture({
      generatedAt: new Date().toISOString(),
      state: 'healthy',
      collectorActive: 1,
      collectorMax: 96,
      roster: {
        live: 1,
        collectorTracking: 1,
        expectedCollectorRows: 1,
        liveCollectorDeficitRows: 0,
        metadataOnly: 0,
        metadataStale: 0,
        admissionDisabled: 0,
        capacityBlocked: 0,
        warming: 0,
        collecting: 1,
        viewerOnly: 0,
        zeroChatAfterAge: 0,
      },
    }),
    activity: {
      points: [],
      windowMinutes: 24 * 60,
      channelCount: 1,
    },
    emoteIntel: {
      emotesPerMin: 133,
      topEmoteSharePct: 39,
      uniqueEmotes: 1,
      biggestPeakPerMin: 133,
      seventvSharePct: 0,
      providerShares: [],
    },
    topEmotes: [
      { name: 'DinoDance', provider: 'twitch', count: 123, sharePct: 39 },
    ],
    topMovers: [],
    liveChannels: [
      {
        login: 'xqc',
        displayName: 'xQc',
        category: 'Just Chatting',
        viewers: 12_000,
        chatPerMin: 393,
        emotesPerMin: 133,
        seventvPerMin: 0,
        coverageState: 'synced',
        trendPct: 5,
      },
    ],
    moments: [],
    livePulseMoments: [],
    featuredSession: { state: 'empty', reason: 'no_qualifying_session' },
  }
}

function renderPanel({
  selectedMomentKey,
  onSelectMoment,
}: Pick<
  PulseMomentsLivePanelProps,
  'selectedMomentKey' | 'onSelectMoment'
>) {
  const hub = sampleHub()
  return render(
    <MemoryRouter>
      <AnalyticsThemeProvider>
        <PulseMomentsLivePanel
          hub={hub}
          feed={feed}
          topEmotes={hub.topEmotes}
          layout="embedded"
          selectedMomentKey={selectedMomentKey}
          onSelectMoment={onSelectMoment}
        />
      </AnalyticsThemeProvider>
    </MemoryRouter>,
  )
}

describe('PulseMomentsLivePanel controlled hub selection', () => {
  it('does not invent an initial selection for a controlled hub', async () => {
    const onSelectMoment = vi.fn()
    renderPanel({ selectedMomentKey: undefined, onSelectMoment })

    await waitFor(() =>
      expect(screen.getAllByText('Twitch emote spike').length).toBeGreaterThan(0),
    )
    expect(onSelectMoment).not.toHaveBeenCalled()
    expect(document.querySelector('.pulse-moments__peak-row.is-active')).toBeNull()
  })

  it('keeps an explicit controlled clear instead of auto-selecting again', async () => {
    const onSelectMoment = vi.fn()
    renderPanel({ selectedMomentKey: null, onSelectMoment })

    await waitFor(() =>
      expect(screen.getAllByText('Twitch emote spike').length).toBeGreaterThan(0),
    )
    expect(onSelectMoment).not.toHaveBeenCalled()
    expect(document.querySelector('.pulse-moments__peak-row.is-active')).toBeNull()
  })

  it('does not invite bucket selection while network moments are already visible', () => {
    renderPanel({ selectedMomentKey: null, onSelectMoment: vi.fn() })

    expect(
      screen.queryByText(
        'Click an activity chart bucket to see spikes for that period.',
      ),
    ).toBeNull()
  })
})

describe('PulseMomentsLivePanel sort and channel filter', () => {
  function renderWithMoments(
    overrides: Partial<PulseMomentsLivePanelProps> = {},
  ) {
    const hub = sampleHub()
    hub.liveChannels = [
      {
        login: 'xqc',
        displayName: 'xQc',
        category: 'Just Chatting',
        viewers: 12_000,
        chatPerMin: 393,
        emotesPerMin: 133,
        seventvPerMin: 0,
        coverageState: 'synced',
        trendPct: 5,
      },
      {
        login: 'sodapoppin',
        displayName: 'sodapoppin',
        category: 'Just Chatting',
        viewers: 9_800,
        chatPerMin: 280,
        emotesPerMin: 50,
        seventvPerMin: 0,
        coverageState: 'synced',
        trendPct: -2,
      },
    ]
    return render(
      <MemoryRouter>
        <AnalyticsThemeProvider>
          <PulseMomentsLivePanel
            hub={hub}
            feed={feed}
            topEmotes={hub.topEmotes}
            layout="standalone"
            {...overrides}
          />
        </AnalyticsThemeProvider>
      </MemoryRouter>,
    )
  }

  it('renders channel filter select when multiple channels are present', async () => {
    renderWithMoments()
    await waitFor(() =>
      expect(screen.getAllByText(/spike/i).length).toBeGreaterThan(0),
    )
    const channelSelect = screen.getByRole('combobox', { name: /channel filter/i })
    expect(channelSelect).toBeTruthy()
    expect(channelSelect.querySelectorAll('option').length).toBe(3) // All channels + 2 channels
  })

  it('hides channel filter when only one channel is present', async () => {
    const singleFeed: LivePulseMomentsResult = {
      source: 'network',
      moments: [feed.moments[0]],
    }
    const hub = sampleHub()
    render(
      <MemoryRouter>
        <AnalyticsThemeProvider>
          <PulseMomentsLivePanel
            hub={hub}
            feed={singleFeed}
            topEmotes={hub.topEmotes}
            layout="standalone"
          />
        </AnalyticsThemeProvider>
      </MemoryRouter>,
    )
    await waitFor(() =>
      expect(screen.getAllByText(/spike/i).length).toBeGreaterThan(0),
    )
    expect(screen.queryByRole('combobox', { name: /channel filter/i })).toBeNull()
  })

  it('filters table rows by selected channel', async () => {
    renderWithMoments()
    await waitFor(() =>
      expect(screen.getAllByText(/spike/i).length).toBeGreaterThan(0),
    )

    const channelSelect = screen.getByRole('combobox', { name: /channel filter/i })
    fireEvent.change(channelSelect, { target: { value: 'sodapoppin' } })

    // sodapoppin has 1 moment; xqc's 2 moments should be hidden from table
    // The table rows are inside .pulse-moments__peak-row elements
    const tableRows = document.querySelectorAll('.pulse-moments__peak-row')

    expect(tableRows.length).toBe(1)
    expect(tableRows[0]?.textContent).toContain('sodapoppin')
    expect(tableRows[0]?.textContent).not.toContain('xQc')

    // "Showing 1 of 3" appears in both the toolbar count and the table header meta.
    // Use the toolbar filter bar element to verify count semantics.
    const toolbar = document.querySelector('.pulse-moments-live__filters') as HTMLElement
    expect(toolbar).toBeTruthy()
    expect(within(toolbar).getByText(/Showing 1 of 3/)).toBeTruthy()
  })

  it('resets channel filter to All when feed snapshot changes', async () => {
    const hub = sampleHub()
    // Ensure hub has both channels so the channel select stays visible after rerender
    hub.liveChannels = [
      {
        login: 'xqc', displayName: 'xQc', category: 'Just Chatting',
        viewers: 12_000, chatPerMin: 393, emotesPerMin: 133,
        seventvPerMin: 0, coverageState: 'synced', trendPct: 5,
      },
      {
        login: 'sodapoppin', displayName: 'sodapoppin', category: 'Just Chatting',
        viewers: 9_800, chatPerMin: 280, emotesPerMin: 50,
        seventvPerMin: 0, coverageState: 'synced', trendPct: -2,
      },
    ]
    const { rerender } = render(
      <MemoryRouter>
        <AnalyticsThemeProvider>
          <PulseMomentsLivePanel
            hub={hub}
            feed={feed}
            topEmotes={hub.topEmotes}
            layout="standalone"
          />
        </AnalyticsThemeProvider>
      </MemoryRouter>,
    )
    await waitFor(() =>
      expect(screen.getAllByText(/spike/i).length).toBeGreaterThan(0),
    )
    const channelSelect = screen.getByRole('combobox', { name: /channel filter/i })
    fireEvent.change(channelSelect, { target: { value: 'sodapoppin' } })
    expect((channelSelect as HTMLSelectElement).value).toBe('sodapoppin')

    // Simulate new feed with different moments (new bucket load)
    // Keep moments from both channels so the select remains visible
    const newFeed: LivePulseMomentsResult = {
      source: 'network',
      moments: [
        {
          ...feed.moments[0],
          offsetSeconds: 999, // different offset to change identity
        },
        feed.moments[1], // sodapoppin moment
      ],
    }
    rerender(
      <MemoryRouter>
        <AnalyticsThemeProvider>
          <PulseMomentsLivePanel
            hub={hub}
            feed={newFeed}
            topEmotes={hub.topEmotes}
            layout="standalone"
          />
        </AnalyticsThemeProvider>
      </MemoryRouter>,
    )
    await waitFor(() => {
      const select = screen.getByRole('combobox', { name: /channel filter/i })
      expect((select as HTMLSelectElement).value).toBe('all')
    })
  })

  it('defaults to newest-first sort and allows switching to strongest-first', async () => {
    renderWithMoments()
    await waitFor(() =>
      expect(screen.getAllByText(/spike/i).length).toBeGreaterThan(0),
    )
    const sortSelect = screen.getByRole('combobox', { name: /sort order/i })
    expect((sortSelect as HTMLSelectElement).value).toBe('newest')

    // With newest: first row should be the most recent (at: now - 60_000) → xQc emote spike
    const rows = document.querySelectorAll('.pulse-moments__peak-row')
    expect(rows.length).toBe(3)
    expect(rows[0]?.textContent).toContain('Twitch emote spike')

    fireEvent.change(sortSelect, { target: { value: 'strongest' } })

    // Strongest: score 92 first → xQc emote spike (still)
    const sortedRows = document.querySelectorAll('.pulse-moments__peak-row')
    expect(sortedRows[0]?.textContent).toContain('Twitch emote spike')
    expect((sortSelect as HTMLSelectElement).value).toBe('strongest')

    // Switch to oldest: sodapoppin (at: now - 180_000) first
    fireEvent.change(sortSelect, { target: { value: 'oldest' } })
    const oldestRows = document.querySelectorAll('.pulse-moments__peak-row')
    expect(oldestRows[0]?.textContent).toContain('sodapoppin')
  })

  it('preserves backend order and hides score sorting for a historical bucket', async () => {
    const bucketT = now - 5 * 60_000
    writeBucketMomentsCache(bucketT, '24h', [
      feed.moments[1],
      feed.moments[0],
    ])

    renderWithMoments({
      selectedBucketT: bucketT,
      onClearBucketFilter: vi.fn(),
    })

    await waitFor(() => {
      expect(document.querySelectorAll('.pulse-moments__peak-row').length).toBe(2)
    })
    expect(screen.queryByRole('combobox', { name: /sort order/i })).toBeNull()
    expect(document.querySelectorAll('.pulse-moments__peak-row')[0]?.textContent)
      .toContain('sodapoppin')
  })
})
