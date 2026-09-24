import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
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
      at: Date.now() - 60_000,
      chatPerMin: 393,
      emotesPerMin: 133,
      viewers: 12_000,
      topEmotes: [
        { name: 'DinoDance', provider: 'twitch', count: 123, sharePct: 39 },
      ],
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
  requireExplicitSelection,
  onPoolMomentsChange,
}: Pick<
  PulseMomentsLivePanelProps,
  'selectedMomentKey' | 'onSelectMoment' | 'requireExplicitSelection' | 'onPoolMomentsChange'
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
          requireExplicitSelection={requireExplicitSelection}
          onPoolMomentsChange={onPoolMomentsChange}
        />
      </AnalyticsThemeProvider>
    </MemoryRouter>,
  )
}

describe('PulseMomentsLivePanel controlled hub selection', () => {
  it('shows the full-width moment browser without an empty inspector', async () => {
    const onPoolMomentsChange = vi.fn()
    renderPanel({ selectedMomentKey: null, onSelectMoment: vi.fn(), requireExplicitSelection: true, onPoolMomentsChange })
    await waitFor(() => expect(onPoolMomentsChange).toHaveBeenCalled())
    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.getByText('Live-session peaks')).toBeTruthy()
    expect(screen.queryByText(/last 24 hours/)).toBeNull()
    expect(screen.queryByLabelText('Moment Inspector')).toBeNull()
    expect(screen.getByRole('toolbar', { name: 'Moment filters' })).toBeTruthy()
    expect(document.querySelector('[data-moment-row][aria-selected="true"]')).toBeNull()
  })

  it('does not substitute another moment for an unresolved explicit identity', () => {
    renderPanel({ selectedMomentKey: 'missing-exact-id', onSelectMoment: vi.fn(), requireExplicitSelection: true })
    expect(screen.queryByLabelText('Moment Inspector')).toBeNull()
  })
  it('selects the exact row with the keyboard and removes the inspector after filtering to no results', () => {
    const onSelectMoment = vi.fn()
    renderPanel({ selectedMomentKey: null, onSelectMoment, requireExplicitSelection: true })
    fireEvent.keyDown(document.querySelector('[data-moment-row]')!, { key: 'Enter' })
    expect(onSelectMoment).toHaveBeenCalledWith(expect.objectContaining({ login: 'xqc', streamId: 's1', offsetSeconds: 120 }))
    fireEvent.click(screen.getByRole('button', { name: 'Chat spikes' }))
    expect(screen.getByText('No moments match this filter')).toBeTruthy()
    expect(screen.queryByLabelText('Moment Inspector')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(document.querySelectorAll('[data-moment-row]')).toHaveLength(1)
  })
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
