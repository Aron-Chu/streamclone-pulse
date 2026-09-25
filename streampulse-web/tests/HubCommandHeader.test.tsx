import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { normalizePublicHub } from '../src/lib/publicHub'
import { HubCommandHeader } from '../src/ui/components/analytics/HubCommandHeader'
import { AnalyticsThemeProvider } from '../src/ui/providers/AnalyticsThemeProvider'
import type { PoolWireEvent } from '../src/lib/poolWireReducer'

function renderHeader(
  overrides: {
    events?: PoolWireEvent[]
    lastSuccessfulPollAt?: number
    hubEndpointOk?: boolean
    loadSource?: 'full' | 'stats-fallback' | 'cache' | null
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
        loadSource={overrides.loadSource ?? 'full'}
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

  it('keeps later Pool Wire changes available through an expandable control', () => {
    const events: PoolWireEvent[] = ['first', 'second', 'third', 'fourth'].map((login) => ({
      id: `evt:${login}`,
      kind: 'went_live',
      channelKey: `login:${login}`,
      login,
      at: Date.now() - 34_000,
      derived: false,
    }))
    renderHeader({ events })

    const toggle = screen.getByRole('button', { name: 'Show 2 more pool changes' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText('first')).toBeTruthy()
    expect(screen.getByText('second')).toBeTruthy()
    expect(screen.queryByText('third')).toBeNull()

    fireEvent.click(toggle)
    expect(screen.getByText('third')).toBeTruthy()
    expect(screen.getByText('fourth')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Show fewer pool changes' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('does not present a cached Pool Wire snapshot as live', () => {
    renderHeader({
      loadSource: 'cache',
      events: [
        {
          id: 'evt:cached',
          kind: 'went_live',
          channelKey: 'login:xqc',
          login: 'xqc',
          displayName: 'xQc',
          at: Date.now() - 34_000,
          derived: false,
        },
      ],
    })

    expect(screen.getByTestId('pool-wire').textContent).toMatch(
      /Pool updates paused · last snapshot is stale/,
    )
    expect(screen.getByTestId('hub-command-trust').textContent).toMatch(/DELAYED/)
    expect(screen.getByTestId('hub-command-trust').textContent).not.toMatch(/LIVE/)
    expect(screen.queryByText('Went live')).toBeNull()
  })

  it('ages a successful poll between network updates and stops claiming LIVE when stale', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-22T18:00:00Z'))
    const lastSuccessfulPollAt = Date.now()
    const view = renderHeader({ lastSuccessfulPollAt })
    try {
      const trust = screen.getByTestId('hub-command-trust')
      expect(trust.textContent).toMatch(/UPDATED 0S AGO · LIVE/)

      act(() => vi.advanceTimersByTime(65_000))
      expect(trust.textContent).toMatch(/UPDATED 1M AGO · DELAYED/)

      act(() => vi.advanceTimersByTime(3 * 60_000))
      expect(trust.textContent).toMatch(/LAST GOOD UPDATE 4M AGO · RECONNECTING/)
    } finally {
      view.unmount()
      vi.useRealTimers()
    }
  })
})
