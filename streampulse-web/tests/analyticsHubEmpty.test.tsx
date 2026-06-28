import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import DashboardHome from '../src/routes/dashboard/Home'

vi.mock('../src/hooks/useAnalyticsHubData', () => ({
  useAnalyticsHubData: () => ({
    loading: false,
    error: null,
    watchlistEntries: [],
    pulseByLogin: {},
    liveRows: [],
    recentSessions: [],
    historyUnavailable: false,
    watchlistEmpty: true,
    reload: vi.fn(),
  }),
}))

vi.mock('../src/hooks/usePublicHubData', () => ({
  usePublicHubData: () => ({
    data: {
      generatedAt: new Date().toISOString(),
      poolSize: 0,
      corpus: { streamsTracked: 0, momentsDetected: 0, chatMessagesProcessed: 0, emotesIndexed: 0, vodsAnalyzed: 0 },
      coverage: {
        liveChannels: 0,
        trackingMax: 100,
        backfillActive: 0,
        backfillMax: 4,
        syncActive: 0,
        emotesIndexed: 0,
        databaseOk: true,
        state: 'operational',
      },
      activity: { points: [], windowMinutes: 30, channelCount: 0 },
      emoteIntel: { emotesPerMin: 0, topEmoteSharePct: 0, uniqueEmotes: 0, biggestPeakPerMin: 0, seventvSharePct: 0 },
      topEmotes: [],
      topMovers: [],
      liveChannels: [],
      moments: [],
    },
    loading: false,
    refreshing: false,
    error: null,
    liveEmpty: true,
    lastUpdated: Date.now(),
    refresh: vi.fn(),
  }),
}))

describe('Analytics hub empty watchlist (HUB-P4)', () => {
  it('still renders hub sections with honest empty states', async () => {
    render(
      <MemoryRouter>
        <DashboardHome />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'StreamPulse analytics' })).toBeTruthy()
    expect(screen.getByRole('search')).toBeTruthy()
    expect(screen.getByText('Search-first gateway')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Live now' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Recent sessions' })).toBeTruthy()
    expect(screen.getByText(/No channels live right now/i)).toBeTruthy()
  })
})
