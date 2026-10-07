/**
 * OP1-RES-007: one wrong-typed field in one hub row used to crash /analytics
 * (string methods and React children both throw on objects). The normaliser
 * drops rows without a text identity and clears other wrong-typed text.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { normalizePublicHub, type PublicHub } from '../src/lib/publicHub'
import { fromHubMoment } from '../src/lib/discoveryMoments'
import AnalyticsLandingPage from '../src/routes/analytics/AnalyticsLandingPage'

const channel = (login: unknown, extra: Record<string, unknown> = {}) => ({
  login,
  displayName: typeof login === 'string' ? login : 'unused',
  category: 'Just Chatting',
  viewers: 1200,
  chatPerMin: 90,
  emotesPerMin: 40,
  seventvPerMin: 20,
  coverageState: 'synced',
  trendPct: 4,
  ...extra,
})

function hostileRawHub() {
  const now = new Date().toISOString()
  return {
    generatedAt: now,
    poolSize: 4,
    corpus: { streamsTracked: 10, momentsDetected: 4, chatMessagesProcessed: 1000, emotesIndexed: 100, vodsAnalyzed: 2 },
    coverage: { liveChannels: 4, trackingMax: 10, backfillActive: 0, backfillMax: 1, syncActive: 0, emotesIndexed: 100, databaseOk: true, state: 'operational' },
    activity: { points: [], windowMinutes: 1440, channelCount: 4 },
    topEmotes: [],
    topMovers: [
      { login: { hostile: true }, displayName: 'Ghost', viewers: 10, chatPerMin: 1, seventvPerMin: 1, trendPct: 0 },
      { login: 'xqc', displayName: { hostile: true }, category: 7, viewers: 900, chatPerMin: 80, seventvPerMin: 30, trendPct: 3 },
    ],
    liveChannels: [
      channel('xqc', { displayName: {} }),
      channel('sodapoppin', { category: 123, title: ['not text'] }),
      channel(null),
      channel('pokimane'),
    ],
    moments: [
      { kind: 'chat_spike', login: 'xqc', label: { hostile: true }, displayName: 42, at: Date.now() },
    ],
    livePulseMoments: [
      { login: 'xqc', streamId: 'stream-1', offsetSeconds: 60, score: 80, label: { hostile: true }, displayName: {}, category: 9 },
      { login: { hostile: true }, streamId: 'stream-2', offsetSeconds: 90, score: 70, label: 'Dropped row' },
      { login: 'pokimane', streamId: 'stream-3', offsetSeconds: 120, score: 60, label: 'Measured live peak' },
    ],
  }
}

const hostileHub = vi.hoisted(() => ({ data: null as PublicHub | null }))

vi.mock('../src/hooks/usePublicHubData', () => ({
  usePublicHubData: () => ({
    data: hostileHub.data,
    loading: false,
    refreshing: false,
    activityRefreshing: false,
    error: null,
    loadSource: 'full',
    hubEndpointOk: true,
    liveEmpty: false,
    lastUpdated: Date.now(),
    lastSuccessfulPollAt: Date.now(),
    pollSequence: 1,
    cachedAt: null,
    refresh: vi.fn(),
  }),
}))
vi.mock('../src/hooks/useHubRecentLogins', () => ({ useHubRecentLogins: () => [] }))
vi.mock('../src/hooks/useNewsroomData', () => ({
  useNewsroomData: () => ({
    data: null, loading: false, refreshing: false, loadingMore: false, error: 'Newsroom unavailable',
    unavailable: true, announcement: '', refresh: vi.fn(), loadMore: vi.fn(),
  }),
}))

describe('hub rows with wrong-typed fields', () => {
  it('drops rows without a text login and clears other wrong-typed text', () => {
    const hub = normalizePublicHub(hostileRawHub() as unknown as Parameters<typeof normalizePublicHub>[0])

    expect(hub.liveChannels.map((row) => row.login)).toEqual(['xqc', 'sodapoppin', 'pokimane'])
    expect(hub.liveChannels[0].displayName).toBeUndefined()
    expect(hub.liveChannels[1].category).toBeUndefined()
    expect(hub.liveChannels[1].title).toBeUndefined()
    expect(hub.liveChannels[2]).toMatchObject({ displayName: 'pokimane', category: 'Just Chatting' })

    expect(hub.topMovers.map((row) => row.login)).toEqual(['xqc'])
    expect(hub.topMovers[0].displayName).toBeUndefined()
    expect(hub.topMovers[0].category).toBeUndefined()

    expect(hub.moments[0].label).toBe('')
    expect(hub.moments[0].displayName).toBeUndefined()

    expect(hub.livePulseMoments.map((row) => row.login)).toEqual(['xqc', 'pokimane'])
    expect(hub.livePulseMoments[0]).toMatchObject({ label: '', displayName: undefined, category: undefined })
    expect(hub.livePulseMoments[1].label).toBe('Measured live peak')
  })

  it('normalises a cleaned row idempotently (cache re-hydrate path)', () => {
    const once = normalizePublicHub(hostileRawHub() as unknown as Parameters<typeof normalizePublicHub>[0])
    const twice = normalizePublicHub(JSON.parse(JSON.stringify(once)))
    expect(twice.liveChannels).toEqual(once.liveChannels)
    expect(twice.livePulseMoments).toEqual(once.livePulseMoments)
  })

  it('gives a Moments Latest row a readable label instead of an object', () => {
    const moment = fromHubMoment({ login: 'xqc', streamId: 'stream-1', offsetSeconds: 60, label: { hostile: true } } as unknown as Parameters<typeof fromHubMoment>[0])
    expect(moment?.label).toBe('Measured reaction')
    expect(fromHubMoment({ login: { hostile: true }, streamId: 'stream-1', offsetSeconds: 60, label: 'x' } as unknown as Parameters<typeof fromHubMoment>[0])).toBeNull()
  })

  it('keeps /analytics rendering when one live channel, mover or moment field has the wrong type', async () => {
    hostileHub.data = normalizePublicHub(hostileRawHub() as unknown as Parameters<typeof normalizePublicHub>[0])
    render(
      <MemoryRouter>
        <AnalyticsLandingPage />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('heading', { name: 'Command center' })).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Analytics navigation' })).toBeTruthy()
    expect(screen.getAllByText('pokimane').length).toBeGreaterThan(0)
  })
})
