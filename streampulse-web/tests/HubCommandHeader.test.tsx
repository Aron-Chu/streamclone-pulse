import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { normalizePublicHub } from '../src/lib/publicHub'
import { HubCommandHeader } from '../src/ui/components/analytics/HubCommandHeader'
import { AnalyticsThemeProvider } from '../src/ui/providers/AnalyticsThemeProvider'
import type { PoolWireEvent } from '../src/lib/poolWireReducer'

function renderHeader(
  overrides: {
    events?: PoolWireEvent[]
    lastSuccessfulPollAt?: number
    hubEndpointOk?: boolean
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
    <AnalyticsThemeProvider>
      <HubCommandHeader
        hub={hub}
        lastSuccessfulPollAt={overrides.lastSuccessfulPollAt ?? Date.now() - 8_000}
        hubEndpointOk={overrides.hubEndpointOk ?? true}
        poolWireEvents={overrides.events ?? []}
        poolWireInitialized
      />
    </AnalyticsThemeProvider>,
  )
}

describe('HubCommandHeader command surface', () => {
  it('renders primary KPIs, peak strip, trust line, and Pool Wire', () => {
    renderHeader({
      events: [
        {
          id: 'evt:1',
          kind: 'went_live',
          channelKey: 'login:xqc',
          login: 'xqc',
          displayName: 'xQc',
          category: 'Just Chatting',
          at: Date.now() - 34_000,
          derived: false,
        },
      ],
    })

    expect(screen.getByTestId('live-pool-size')).toBeTruthy()
    expect(screen.getByText('Tracked channels', { exact: true })).toBeTruthy()
    expect(screen.getByText(/Tracked live viewers/i)).toBeTruthy()
    expect(screen.getByText(/Last 1 day peaks/i)).toBeTruthy()
    expect(screen.getByTestId('hub-command-trust').textContent).toMatch(/IRC COVERAGE/)
    expect(screen.getByTestId('pool-wire')).toBeTruthy()
    expect(screen.getByText('Went live')).toBeTruthy()
    expect(screen.getByText('xQc')).toBeTruthy()
  })

  it('shows compact POOL Stable copy when Pool Wire has no events', () => {
    renderHeader({ events: [] })
    expect(screen.getByTestId('pool-wire-stable').textContent).toMatch(/POOL\s+Stable/i)
    expect(screen.queryByText(/Waiting for lifecycle changes/i)).toBeNull()
  })
})
