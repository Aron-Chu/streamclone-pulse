import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import AnalyticsLandingPage from '../src/routes/analytics/AnalyticsLandingPage'

vi.mock('../src/hooks/useHubRecentLogins', () => ({
  useHubRecentLogins: () => [],
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
      emoteIntel: {
        emotesPerMin: 0,
        topEmoteSharePct: 0,
        uniqueEmotes: 0,
        biggestPeakPerMin: 0,
        seventvSharePct: 0,
        providerShares: [],
      },
      topEmotes: [],
      topMovers: [],
      liveChannels: [],
      moments: [],
      livePulseMoments: [],
      corpusPipeline: {
        generatedAt: new Date().toISOString(),
        state: 'healthy',
        topN: 500,
        collectorActive: 0,
        collectorMax: 100,
        roster: {
          live: 0,
          collectorTracking: 0,
          expectedCollectorRows: 0,
          liveCollectorDeficitRows: 0,
          metadataOnly: 0,
          metadataStale: 0,
          admissionDisabled: 0,
          capacityBlocked: 0,
          warming: 0,
          collecting: 0,
          viewerOnly: 0,
          zeroChatAfterAge: 0,
        },
      },
      featuredSession: { state: 'empty', reason: 'no_qualifying_session' },
    },
    loading: false,
    refreshing: false,
    error: null,
    loadSource: 'full',
    hubEndpointOk: true,
    liveEmpty: true,
    lastUpdated: Date.now(),
    refresh: vi.fn(),
  }),
}))

describe('Analytics hub empty watchlist (HUB-P4)', () => {
  it('still renders hub sections with honest empty states', async () => {
    render(
      <MemoryRouter>
        <AnalyticsLandingPage />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { level: 1, name: /Command center/i })).toBeTruthy()
    expect(screen.getByText(/Stream intelligence/i)).toBeTruthy()
    expect(screen.getByRole('search', { name: /Channel search/i })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /Live Activity/i })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /Live collector readiness/i })).toBeTruthy()
    expect(screen.getAllByText(/No channels live right now/i).length).toBeGreaterThan(0)
    expect(screen.queryByText(/add channels to your watchlist to see live analytics/i)).toBeNull()
  })
})
