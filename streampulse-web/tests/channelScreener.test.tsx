import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { LiveChannelsMatrix } from '../src/ui/components/analytics/LiveChannelsMatrix'
import { AnalyticsThemeProvider } from '../src/ui/providers/AnalyticsThemeProvider'
import type { HubLiveChannel } from '../src/lib/publicHub'

const channels: HubLiveChannel[] = [
  {
    login: 'xqc',
    displayName: 'xQc',
    category: 'Just Chatting',
    viewers: 1000,
    chatPerMin: 200,
    emotesPerMin: 50,
    seventvPerMin: 40,
    coverageState: 'synced',
    trendPct: 4,
    screener: {
      chatAcceleration: 1.2,
      emoteAcceleration: 0.8,
      anomalyReason: 'viewer/chat divergence',
      newlyLive: true,
    },
  },
  {
    login: 'caseoh_',
    displayName: 'caseoh_',
    category: 'Just Chatting',
    viewers: 800,
    chatPerMin: 120,
    emotesPerMin: 30,
    seventvPerMin: 20,
    coverageState: 'partial',
    trendPct: -1,
  },
]

describe('LiveChannelsMatrix Channel Screener', () => {
  it('exposes screener views and anomaly filter', () => {
    render(
      <MemoryRouter>
        <AnalyticsThemeProvider>
          <LiveChannelsMatrix channels={channels} />
        </AnalyticsThemeProvider>
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: 'Channel Screener' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Anomalies' }))
    expect(screen.getAllByText('viewer/chat divergence').length).toBeGreaterThan(0)
    expect(screen.queryByText('caseoh_')).toBeNull()
  })

  it('shows momentum acceleration columns when backend fields exist', () => {
    render(
      <MemoryRouter>
        <AnalyticsThemeProvider>
          <LiveChannelsMatrix channels={channels} />
        </AnalyticsThemeProvider>
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Momentum' }))
    expect(screen.getByText('Chat accel')).toBeTruthy()
    expect(screen.getByText('1.2')).toBeTruthy()
  })
})
