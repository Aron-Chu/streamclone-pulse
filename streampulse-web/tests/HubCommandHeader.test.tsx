import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { normalizePublicHub } from '../src/lib/publicHub'
import type { LiveActivityEvent } from '../src/lib/liveActivity'
import { HubCommandHeader } from '../src/ui/components/analytics/HubCommandHeader'
import { AnalyticsThemeProvider } from '../src/ui/providers/AnalyticsThemeProvider'

function sampleEvent(): LiveActivityEvent {
  return {
    id: 'evt:1',
    kind: 'went_live',
    channel: { id: '1', login: 'xqc', displayName: 'xQc' },
    streamId: 's1',
    occurredAt: new Date(Date.now() - 34_000).toISOString(),
    detectedAt: new Date(Date.now() - 30_000).toISOString(),
    lastSeenLiveAt: null,
    timestampPrecision: 'twitch_started_at',
    category: 'Just Chatting',
    source: 'metadata_poll',
  }
}

function renderHeader(
  overrides: {
    events?: LiveActivityEvent[]
    status?: 'ready' | 'empty' | 'unavailable'
    lastSuccessfulPollAt?: number
    hubEndpointOk?: boolean
    metadataState?: 'current' | 'degraded' | 'stale' | 'unavailable'
  } = {},
) {
  const hub = normalizePublicHub({
    poolSize: 81,
    liveChannels: [
      {
        login: 'xqc',
        viewers: 10000,
        chatPerMin: 100,
        seventvPerMin: 10,
        coverageState: 'synced',
        trendPct: 0,
      },
    ],
    corpusPipeline: {
      collectorActive: 250,
      collectorMax: 250,
      roster: { live: 81 },
      metadataSampledAgoSeconds: 20,
    },
    activity: {
      windowMinutes: 1440,
      channelCount: 1,
      points: [
        { t: Date.now() - 60_000, viewers: 500000, chat: 8000, emotes: 4000, seventv: 4000 },
      ],
      livePoolViewerSum: 330800,
    },
  })

  return render(
    <MemoryRouter>
      <AnalyticsThemeProvider>
        <HubCommandHeader
          hub={hub}
          lastSuccessfulPollAt={overrides.lastSuccessfulPollAt ?? Date.now() - 8_000}
          hubEndpointOk={overrides.hubEndpointOk ?? true}
          liveActivity={{
            events: overrides.events ?? [],
            status: overrides.status ?? (overrides.events?.length ? 'ready' : 'empty'),
            metadata: {
              state: overrides.metadataState ?? 'current',
              lastSuccessfulPollAt: new Date().toISOString(),
            },
            asOf: new Date().toISOString(),
            window: '6h',
            kindFilter: 'all',
            onKindFilterChange: vi.fn(),
            newIds: new Set(),
            lastSuccessfulAt: Date.now(),
          }}
        />
      </AnalyticsThemeProvider>
    </MemoryRouter>,
  )
}

describe('HubCommandHeader command surface', () => {
  it('renders primary KPIs, peak strip, trust line, Live Activity, and coverage diagnostic', () => {
    renderHeader({ events: [sampleEvent()], status: 'ready' })

    expect(screen.getByTestId('live-pool-size')).toBeTruthy()
    expect(screen.getByText('Tracked channels', { exact: true })).toBeTruthy()
    expect(screen.getByText(/Tracked live viewers/i)).toBeTruthy()
    expect(screen.getByText(/Last 1 day peaks/i)).toBeTruthy()
    expect(screen.getByTestId('hub-command-trust').textContent).toMatch(/IRC COVERAGE/)
    expect(screen.getByTestId('live-activity')).toBeTruthy()
    expect(screen.getByTestId('coverage-diagnostic').textContent).toMatch(
      /81 tracked channels · metadata current/i,
    )
    expect(screen.getByTestId('live-activity-row').textContent).toMatch(/Went live/)
    expect(screen.getByText('xQc')).toBeTruthy()
    expect(screen.queryByTestId('pool-wire')).toBeNull()
    expect(screen.queryByText(/POOL\s+Stable/i)).toBeNull()
  })

  it('shows empty Live Activity without POOL Stable copy', () => {
    renderHeader({ events: [], status: 'empty' })
    expect(screen.getByTestId('live-activity-empty').textContent).toMatch(
      /No confirmed stream changes/i,
    )
    expect(screen.queryByText(/POOL\s+Stable/i)).toBeNull()
  })

  it('coverage diagnostic is unavailable when live activity status is unavailable', () => {
    renderHeader({ events: [], status: 'unavailable' })
    expect(screen.getByTestId('coverage-diagnostic').textContent).toMatch(
      /81 tracked channels · metadata unavailable/i,
    )
    expect(screen.getByTestId('coverage-diagnostic').textContent).not.toMatch(/metadata current/)
  })
})
