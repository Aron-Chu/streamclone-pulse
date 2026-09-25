import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildTopMoversFromLiveChannels,
  enrichTopMoversWithAvatars,
  fetchPublicHub,
  fetchPublicHubBase,
  fetchPublicHubStatsFallback,
  fetchHistoricalHubMoments,
  hasPublicHubResponseShape,
  HUB_TOP_MOVERS_CAP,
  normalizePublicHub,
  normalizePublicHubMoments,
  resolveHubTopMovers,
  sanitizeHubProfileImageUrl,
} from '../src/lib/publicHub'
import { coverageMeta, formatStreamUptime } from '../src/ui/components/analytics/hubFormat'
import { loadedCategories } from '../src/ui/components/moments/MomentCategoryBrowser'

it('rejects future and sentinel starts and peaks instead of fabricating a zero uptime', () => {
  for (const time of ['2099-01-01T00:00:00Z', '0001-01-01T00:00:00Z']) {
    const hub = normalizePublicHub({ activity: { peakViewersAt: time }, featuredSession: { state: 'ready', startedAt: time }, liveChannels: [{ login: 'example', startedAt: time }] } as unknown as Parameters<typeof normalizePublicHub>[0])
    expect(hub.activity.peakViewersAt).toBeUndefined()
    expect(hub.featuredSession?.startedAt).toBeUndefined()
    expect(hub.liveChannels[0].startedAt).toBeUndefined()
    expect(formatStreamUptime(time)).toBe('')
  }
})

it('preserves the explicit live-session scope without confusing it with the activity chart window', () => {
  const hub = normalizePublicHub({ activity: { points: [], windowMinutes: 30, channelCount: 0 }, livePulseMomentsScope: 'current_live_session_peaks' })
  expect(hub.livePulseMomentsScope).toBe('current_live_session_peaks')
  expect(hub.activity.windowMinutes).toBe(30)
})

const apiClient = vi.fn()

vi.mock('../src/lib/apiClient', () => ({
  getBackendUrl: () => 'https://api.streampulse.stream',
  apiClient: (...args: unknown[]) => apiClient(...args),
  // Used by fetchPublicHubBase to rethrow typed 429/Retry-After errors.
  isApiError: (error: unknown) =>
    Boolean(error && typeof error === 'object' && 'kind' in (error as object)),
}))

vi.mock('../src/lib/backendSource', () => ({
  resolveBackendSource: () => 'hosted',
}))

describe('normalizePublicHub', () => {
  it('keeps only allowlisted recent-moment archive artwork with numeric 6–20 digit VOD IDs', () => {
    const artwork = { vodId: '123456', kind: 'archive_thumbnail' as const, url: 'https://static-cdn.jtvnw.net/cf_vods/archive/thumb/test.jpg' }
    const moment = { offsetSeconds: 60, score: 80, label: 'peak', login: 'creator', streamId: 'stream-a' }
    expect(normalizePublicHub({ livePulseMoments: [{ ...moment, archiveArtwork: artwork }] }).livePulseMoments[0].archiveArtwork).toEqual(artwork)
    expect(normalizePublicHub({ livePulseMoments: [{ ...moment, vodId: '', archiveArtwork: artwork }] }).livePulseMoments[0].archiveArtwork).toEqual(artwork)
    for (const vodId of ['654321', '12345', 'malformed']) {
      expect(normalizePublicHub({ livePulseMoments: [{ ...moment, vodId, archiveArtwork: artwork }] }).livePulseMoments[0].archiveArtwork).toBeUndefined()
    }
    for (const archiveArtwork of [
      { ...artwork, vodId: '12345' },
      { ...artwork, vodId: '123456789012345678901' },
      { ...artwork, vodId: 'not-numeric' },
      { ...artwork, kind: 'live_thumbnail' },
      { ...artwork, url: 'https://untrusted.invalid/cf_vods/archive/thumb/test.jpg' },
    ]) {
      const input = { livePulseMoments: [{ ...moment, archiveArtwork }] } as unknown as Parameters<typeof normalizePublicHub>[0]
      const normalized = normalizePublicHub(input)
      expect(normalized.livePulseMoments).toHaveLength(1)
      expect(normalized.livePulseMoments[0].archiveArtwork).toBeUndefined()
    }
  })
  it('keeps only exact allowlisted category artwork tied to a numeric category ID', () => {
    // Synthetic contract fixture; this does not assert the real category identity of Wuthering Waves.
    const moment = { offsetSeconds: 60, score: 80, label: 'peak', login: 'creator', streamId: 'stream-a', category: 'Wuthering Waves' }
    const categoryId = '213490846'
    const artwork144 = `https://static-cdn.jtvnw.net/ttv-boxart/${categoryId}-144x192.jpg`
    const artwork210 = `https://static-cdn.jtvnw.net/ttv-boxart/${categoryId}-210x280.jpg`
    const artworkIgdb = `https://static-cdn.jtvnw.net/ttv-boxart/${categoryId}_IGDB-144x192.jpg`
    for (const boxArtUrl of [artwork144, artwork210, artworkIgdb]) {
      expect(normalizePublicHub({ livePulseMoments: [{ ...moment, categoryId, boxArtUrl }] }).livePulseMoments[0]).toMatchObject({ categoryId, boxArtUrl })
    }
    for (const boxArtUrl of [
      `http://static-cdn.jtvnw.net/ttv-boxart/${categoryId}-144x192.jpg`,
      `https://other.invalid/ttv-boxart/${categoryId}-144x192.jpg`,
      `https://user:pass@static-cdn.jtvnw.net/ttv-boxart/${categoryId}-144x192.jpg`,
      `https://static-cdn.jtvnw.net/ttv-boxart/${categoryId}-144x192.jpg?width=144`,
      `https://static-cdn.jtvnw.net/ttv-boxart/${categoryId}-144x192.jpg#art`,
      `https://static-cdn.jtvnw.net/previews-ttv/live_user_creator-144x192.jpg`,
      `https://static-cdn.jtvnw.net/ttv-boxart/404_boxart-144x192.jpg`,
      `https://static-cdn.jtvnw.net/ttv-boxart/livechannel-${categoryId}-144x192.jpg`,
      `https://static-cdn.jtvnw.net/ttv-boxart/999-144x192.jpg`,
    ]) {
      const normalized = normalizePublicHub({ livePulseMoments: [{ ...moment, categoryId, boxArtUrl }] })
      expect(normalized.livePulseMoments).toHaveLength(1)
      expect(normalized.livePulseMoments[0].categoryId).toBe(categoryId)
      expect(normalized.livePulseMoments[0].boxArtUrl).toBeUndefined()
    }
    for (const invalidId of ['abc', '123456789012345678901']) {
      const normalized = normalizePublicHub({ livePulseMoments: [{ ...moment, categoryId: invalidId, boxArtUrl: artwork144 }] })
      expect(normalized.livePulseMoments).toHaveLength(1)
      expect(normalized.livePulseMoments[0].categoryId).toBeUndefined()
      expect(normalized.livePulseMoments[0].boxArtUrl).toBeUndefined()
      expect(normalized.livePulseMoments[0].categoryMetadataRejected).toBe(true)
    }
  })
  it('applies the same category contract to historical hub moments', () => {
    const categoryId = '213490846'
    const boxArtUrl = `https://static-cdn.jtvnw.net/ttv-boxart/${categoryId}_IGDB-210x280.jpg`
    const response = normalizePublicHubMoments({
      moments: [{ login: 'creator', streamId: 'stream-a', offsetSeconds: 60, score: 80, label: 'Peak', category: 'Wuthering Waves', categoryId, boxArtUrl }],
    })
    expect(response.moments[0]).toMatchObject({ categoryId, boxArtUrl })

    const rejected = normalizePublicHubMoments({
      moments: [{ login: 'creator', streamId: 'stream-a', offsetSeconds: 60, score: 80, label: 'Peak', category: 'Minecraft', categoryId: 'malformed', boxArtUrl }],
    })
    expect(rejected.moments[0].categoryId).toBeUndefined()
    expect(rejected.moments[0].boxArtUrl).toBeUndefined()
    expect(rejected.moments[0].categoryMetadataRejected).toBe(true)
  })
  it('keeps rejected live category metadata neutral across repeated hub normalization', () => {
    const once = normalizePublicHub({ livePulseMoments: [{
      login: 'creator', streamId: 'stream-a', offsetSeconds: 60, score: 80, label: 'Peak', category: 'Minecraft',
      categoryId: 'malformed', boxArtUrl: 'https://untrusted.invalid/box.jpg',
    }] })
    const twice = normalizePublicHub(once)
    expect(twice.livePulseMoments[0].categoryMetadataRejected).toBe(true)
    expect(loadedCategories(twice.livePulseMoments)).toEqual([{ name: 'Minecraft', count: 1 }])
  })
  it('keeps rejected bucket category metadata neutral across repeated normalization', () => {
    const once = normalizePublicHubMoments({ moments: [{
      login: 'creator', streamId: 'stream-a', offsetSeconds: 60, score: 80, label: 'Peak', category: 'Minecraft',
      categoryId: 'malformed', boxArtUrl: 'https://untrusted.invalid/box.jpg',
    }] })
    const twice = normalizePublicHubMoments(once)
    expect(twice.moments[0].categoryMetadataRejected).toBe(true)
    expect(loadedCategories(twice.moments)).toEqual([{ name: 'Minecraft', count: 1 }])
  })
  it('allowlists hub profile image URLs before they reach image components', () => {
    const twitch = 'https://static-cdn.jtvnw.net/jtv_user_pictures/xqc-profile_image-300x300.png'
    expect(sanitizeHubProfileImageUrl(twitch)).toBe(twitch)
    expect(sanitizeHubProfileImageUrl('https://evil.example/avatar.png')).toBeUndefined()
    expect(sanitizeHubProfileImageUrl('javascript:alert(1)')).toBeUndefined()
    expect(sanitizeHubProfileImageUrl('https://static-cdn.jtvnw.net/jtv_user_pictures/x.png?track=1')).toBeUndefined()
    expect(sanitizeHubProfileImageUrl('https://user:pass@static-cdn.jtvnw.net/jtv_user_pictures/x.png')).toBeUndefined()

    const normalized = normalizePublicHub({
      topMovers: [{ login: 'evil', profileImageUrl: 'https://evil.example/avatar.png' }],
      liveChannels: [{ login: 'evil', profileImageUrl: 'https://evil.example/avatar.png' }],
      livePulseMoments: [{ login: 'evil', profileImageUrl: 'https://evil.example/avatar.png', offsetSeconds: 1, score: 1, label: 'peak' }],
    } as unknown as Parameters<typeof normalizePublicHub>[0])
    expect(normalized.topMovers[0]?.profileImageUrl).toBeUndefined()
    expect(normalized.liveChannels[0]?.profileImageUrl).toBeUndefined()
    expect(normalized.livePulseMoments[0]?.profileImageUrl).toBeUndefined()
  })

  it('preserves same-backend avatar proxy URLs without allowing a different origin', () => {
    const backendProxy = 'https://api.streampulse.stream/v1/channels/xqc/avatar'
    expect(sanitizeHubProfileImageUrl('/v1/channels/xqc/avatar')).toBe(backendProxy)
    expect(sanitizeHubProfileImageUrl('https://api.streampulse.stream/v1/channels/xqc/avatar?cache=1')).toBeUndefined()
    expect(sanitizeHubProfileImageUrl('https://api.streampulse.stream.evil.example/v1/channels/xqc/avatar')).toBeUndefined()
  })

  it('drops invalid activity clocks without shifting the measured chart into the future', () => {
    const points = [0, 1, Date.parse('0001-01-01'), Date.parse('2099-01-01'), Date.UTC(2026, 7, 1)]
      .map(t => ({ t, chat: 1, seventv: 1, viewers: 1 }))
    const hub = normalizePublicHub({ activity: { points, windowMinutes: 30, channelCount: 1 } })
    expect(hub.activity.points.map(point => point.t)).toEqual([Date.UTC(2026, 7, 1)])
  })
  it.each(['0001-01-01T00:00:00Z', '2099-01-01T00:00:00Z'])('rejects invalid upstream generation times: %s', generatedAt => {
    const normalized = normalizePublicHub({ generatedAt, corpusPipeline: { generatedAt } })
    expect(normalized.generatedAt).toBe('')
    expect(normalized.corpusPipeline.generatedAt).toBe('')
  })
  it('keeps a missing hub projection unknown without fabricating receipt time or health', () => {
    const normalized = normalizePublicHub(null)
    expect(normalized.generatedAt).toBe('')
    expect(normalized.coverage.databaseOk).toBe(false)
    expect(normalized.coverage.state).not.toBe('operational')
    expect(normalized.corpusPipeline.available).toBe(false)
    expect(normalized.corpusPipeline.state).toBe('unknown')
    expect(normalized.corpusPipeline.generatedAt).toBe('')
  })
  it('preserves true, false, and absent chat rollup states', () => {
    const hub = normalizePublicHub({
      activity: {
        windowMinutes: 30,
        channelCount: 1,
        points: [
          { t: Date.UTC(2026, 7, 1) + 1, chat: 0, seventv: 0, viewers: 1000, hasChatRollup: true },
          { t: Date.UTC(2026, 7, 1) + 2, chat: 0, seventv: 0, viewers: 1000, hasChatRollup: false },
          { t: Date.UTC(2026, 7, 1) + 3, chat: 0, seventv: 0, viewers: 1000 },
        ],
      },
    })

    expect(hub.activity.points.map((point) => point.hasChatRollup)).toEqual([
      true,
      false,
      undefined,
    ])
  })

  it('preserves measured/accounted window honesty fields and attested gapKind', () => {
    const hub = normalizePublicHub({
      activity: {
        windowMinutes: 1440,
        channelCount: 1,
        measuredWindowMinutes: 1439,
        accountedWindowMinutes: 1440,
        registeredGapCount: 1,
        availableWindowMinutes: 1440,
        source: 'historical_projection',
        state: 'healthy',
        points: [
          {
            t: Date.UTC(2026, 7, 1) + 1,
            chat: 0,
            seventv: 0,
            viewers: 0,
            hasChatRollup: false,
            gapKind: 'attested',
          },
        ],
      },
    })

    expect(hub.activity.measuredWindowMinutes).toBe(1439)
    expect(hub.activity.accountedWindowMinutes).toBe(1440)
    expect(hub.activity.registeredGapCount).toBe(1)
    expect(hub.activity.points[0]?.gapKind).toBe('attested')
  })

  it('preserves an explicit all-provider total even when a provider lane is larger', () => {
    const hub = normalizePublicHub({
      activity: {
        windowMinutes: 30,
        channelCount: 1,
        points: [{ t: Date.UTC(2026, 7, 1) + 1, chat: 100, emotes: 0, seventv: 37, viewers: 1000 }],
      },
    })

    expect(hub.activity.points[0].emotes).toBe(0)
  })

  it('uses provider lanes only when the all-provider total is omitted', () => {
    const hub = normalizePublicHub({
      activity: {
        windowMinutes: 30,
        channelCount: 1,
        points: [{ t: Date.UTC(2026, 7, 1) + 1, chat: 100, seventv: 37, viewers: 1000 }],
      },
    })

    expect(hub.activity.points[0].emotes).toBe(37)
  })

  it('preserves provider-field absence and explicit measured zero separately', () => {
    const hub = normalizePublicHub({
      activity: {
        windowMinutes: 30,
        channelCount: 1,
        providerTotalsComplete: true,
        points: [
          { t: Date.UTC(2026, 7, 1) + 1, chat: 1, seventv: 1, viewers: 1 },
          { t: Date.UTC(2026, 7, 1) + 2, chat: 1, seventv: 1, twitch: 0, bttv: 0, ffz: 0, viewers: 1 },
        ],
      },
    })

    expect(hub.activity.providerTotalsComplete).toBe(true)
    expect(hub.activity.points[0]?.twitch).toBeUndefined()
    expect(hub.activity.points[0]?.bttv).toBeUndefined()
    expect(hub.activity.points[1]?.twitch).toBe(0)
    expect(hub.activity.points[1]?.bttv).toBe(0)
    expect(hub.activity.points[1]?.ffz).toBe(0)
  })

  it('normalizes viewer completeness metadata without turning unknown rows into complete rows', () => {
    const hub = normalizePublicHub({
      activity: {
        windowMinutes: 30,
        channelCount: 3,
        points: [
          {
            t: Date.UTC(2026, 7, 1) + 1,
            chat: 1,
            seventv: 1,
            viewers: 100,
            viewerContributors: 2.9,
            viewerExpectedContributors: 3.9,
            viewerCoverage: ' PARTIAL ',
          },
          {
            t: Date.UTC(2026, 7, 1) + 2,
            chat: 1,
            seventv: 1,
            viewers: 100,
            viewerCoverage: ' unknown ',
          },
        ],
      },
    })

    expect(hub.activity.points[0]).toMatchObject({
      viewerContributors: 2,
      viewerExpectedContributors: 3,
      viewerCoverage: 'partial',
    })
    expect(hub.activity.points[1]?.viewerCoverage).toBe('unknown')
  })

  it('enrichTopMoversWithAvatars joins avatars from live channels', () => {
    const movers = enrichTopMoversWithAvatars(
      [{ login: 'xqc', displayName: 'xQc', viewers: 1, seventvPerMin: 1, chatPerMin: 1, trendPct: 0 }],
      [{
        login: 'xqc',
        displayName: 'xQc',
        viewers: 1,
        chatPerMin: 1,
        emotesPerMin: 1,
        seventvPerMin: 1,
        coverageState: 'synced',
        trendPct: 0,
        profileImageUrl: 'https://cdn.example/xqc.png',
      }],
    )
    expect(movers[0]?.profileImageUrl).toBe('https://cdn.example/xqc.png')
  })

  it('buildTopMoversFromLiveChannels returns up to the hub cap sorted by emote velocity', () => {
    const liveChannels = Array.from({ length: 14 }, (_, index) => ({
      login: `ch${index}`,
      displayName: `Ch ${index}`,
      viewers: 1000 - index,
      chatPerMin: 100 - index,
      emotesPerMin: 200 - index * 10,
      seventvPerMin: 50 - index,
      coverageState: 'synced' as const,
      trendPct: 0,
    }))
    const movers = buildTopMoversFromLiveChannels(liveChannels, HUB_TOP_MOVERS_CAP)
    expect(movers).toHaveLength(HUB_TOP_MOVERS_CAP)
    expect(movers[0]?.login).toBe('ch0')
    expect(movers[11]?.login).toBe('ch11')
  })

  it('resolveHubTopMovers prefers live-channel rows over legacy 8-row API payloads', () => {
    const liveChannels = Array.from({ length: 12 }, (_, index) => ({
      login: `ch${index}`,
      displayName: `Ch ${index}`,
      viewers: 1000,
      chatPerMin: 80,
      emotesPerMin: 150 - index * 5,
      seventvPerMin: 40,
      coverageState: 'synced' as const,
      trendPct: 0,
    }))
    const apiMovers = liveChannels.slice(0, 8).map((channel) => ({
      login: channel.login,
      displayName: channel.displayName,
      viewers: channel.viewers,
      emotesPerMin: channel.emotesPerMin,
      seventvPerMin: channel.seventvPerMin,
      chatPerMin: channel.chatPerMin,
      trendPct: channel.trendPct,
    }))
    const movers = resolveHubTopMovers(apiMovers, liveChannels)
    expect(movers).toHaveLength(HUB_TOP_MOVERS_CAP)
    expect(movers[8]?.login).toBe('ch8')
  })

  it('promotes critical collector state into coverage', () => {
    const hub = normalizePublicHub({
      coverage: {
        liveChannels: 95,
        trackingMax: 50,
        backfillActive: 0,
        backfillMax: 0,
        syncActive: 0,
        emotesIndexed: 0,
        databaseOk: true,
        state: 'operational',
      },
      corpusPipeline: {
        generatedAt: new Date().toISOString(),
        state: 'critical',
        topN: 500,
        collectorActive: 3,
        collectorMax: 50,
        roster: {
          live: 95,
          collectorTracking: 2,
          expectedCollectorRows: 50,
          liveCollectorDeficitRows: 48,
          metadataOnly: 13,
          metadataStale: 95,
          admissionDisabled: 95,
          capacityBlocked: 0,
          warming: 0,
          collecting: 2,
          viewerOnly: 80,
          zeroChatAfterAge: 0,
        },
      },
    })

    expect(hub.coverage.state).toBe('critical')
    expect(hub.corpusPipeline.roster.metadataStale).toBe(95)
    expect(hub.corpusPipeline.roster.liveCollectorDeficitRows).toBe(48)
  })

  it('uses authoritative roster liveness instead of tracked pool capacity', () => {
    const hub = normalizePublicHub({
      poolSize: 300,
      coverage: {
        liveChannels: 300,
        trackingMax: 300,
        backfillActive: 0,
        backfillMax: 0,
        syncActive: 0,
        emotesIndexed: 0,
        databaseOk: true,
        state: 'operational',
      },
      corpusPipeline: {
        collectorActive: 300,
        collectorMax: 300,
        roster: { live: 84 },
      },
    })

    expect(hub.poolSize).toBe(300)
    expect(hub.coverage.liveChannels).toBe(84)
  })

  it('keeps legacy coverage.liveChannels when roster.live is absent', () => {
    const hub = normalizePublicHub({
      poolSize: 300,
      coverage: {
        liveChannels: 84,
        trackingMax: 300,
        backfillActive: 0,
        backfillMax: 0,
        syncActive: 0,
        emotesIndexed: 0,
        databaseOk: true,
        state: 'operational',
      },
      corpusPipeline: {
        collectorActive: 80,
        collectorMax: 250,
      },
    })

    expect(hub.poolSize).toBe(300)
    expect(hub.corpusPipeline.roster.live).toBe(0)
    expect(hub.coverage.liveChannels).toBe(84)
  })
})

describe('coverageMeta', () => {
  it('maps collecting and chat-only states to distinct tones', () => {
    expect(coverageMeta('collecting').tone).toBe('collecting')
    expect(coverageMeta('chat_only').tone).toBe('chat')
    expect(coverageMeta('viewer_only').tone).toBe('viewer')
    expect(coverageMeta('synced').tone).toBe('synced')
  })
})

describe('fetchPublicHub performance', () => {
  beforeEach(() => {
    apiClient.mockReset()
  })

  it('requires a real hub envelope before declaring HTTP 200 healthy', async () => {
    const validEmptyHub = {
      generatedAt: new Date().toISOString(),
      poolSize: 0,
      corpus: { streamsTracked: 0, momentsDetected: 0, chatMessagesProcessed: 0, emotesIndexed: 0, vodsAnalyzed: 0 },
      coverage: { databaseOk: true, state: 'operational' },
      activity: { points: [], windowMinutes: 30, channelCount: 0 },
      liveChannels: [], moments: [], topEmotes: [], topMovers: [],
    }
    expect(hasPublicHubResponseShape(validEmptyHub)).toBe(true)
    apiClient.mockResolvedValueOnce({ data: validEmptyHub, status: 200 })
    expect((await fetchPublicHubBase()).hubEndpointOk).toBe(true)

    for (const payload of [null, {}, { error: 'upstream failed' },
      { ...validEmptyHub, coverage: null },
      { ...validEmptyHub, activity: { points: null, windowMinutes: 30, channelCount: 0 } },
      { ...validEmptyHub, generatedAt: '0001-01-01T00:00:00Z' },
    ]) {
      expect(hasPublicHubResponseShape(payload)).toBe(false)
      apiClient.mockResolvedValueOnce({ data: payload, status: 200 })
      await expect(fetchPublicHubBase()).rejects.toMatchObject({
        kind: 'server', status: 200, code: 'invalid_hub_response',
      })
    }
  })

  it('preserves rate limits without attempting a hub fallback', async () => {
    const rateLimit = { kind: 'rate_limited', status: 429, message: 'slow down', retryAfterMs: 3000 }
    apiClient.mockRejectedValueOnce(rateLimit)
    await expect(fetchPublicHubBase()).rejects.toBe(rateLimit)
    expect(apiClient).toHaveBeenCalledTimes(1)
  })

  it('requests and accepts a bounded Moments projection', async () => {
    apiClient.mockResolvedValueOnce({
      status: 200,
      data: {
        generatedAt: new Date().toISOString(),
        poolSize: 1,
        corpus: { streamsTracked: 1, momentsDetected: 1, chatMessagesProcessed: 1, emotesIndexed: 1, vodsAnalyzed: 0 },
        coverage: { databaseOk: true, state: 'operational' },
        activity: { points: [], windowMinutes: 30, channelCount: 1 },
        liveChannels: [], moments: [], topEmotes: [], topMovers: [],
        livePulseMoments: [{ login: 'xqc', streamId: 'stream', offsetSeconds: 30, score: 80, label: 'Peak' }],
        livePulseMomentsStatus: 'ready',
      },
    })
    const result = await fetchPublicHubBase(undefined, '30m', 'moments')
    expect(result.hubEndpointOk).toBe(true)
    expect(result.data.livePulseMoments).toHaveLength(1)
    expect(apiClient.mock.calls[0]?.[0]).toBe('/v1/public/hub?activityWindow=30m&include=livePulseMoments')
  })

  it('returns base hub without readiness fan-out', async () => {
    apiClient.mockResolvedValueOnce({
      data: normalizePublicHub({
        generatedAt: new Date().toISOString(),
        poolSize: 12,
        liveChannels: [{ login: 'rubius', viewers: 1000, chatPerMin: 10, seventvPerMin: 2, coverageState: 'synced', trendPct: 0 }],
        corpusPipeline: {
          topN: 100,
          state: 'healthy',
          generatedAt: new Date().toISOString(),
          collectorActive: 1,
          collectorMax: 50,
          roster: { live: 12, collectorTracking: 1, expectedCollectorRows: 12, liveCollectorDeficitRows: 0, metadataOnly: 0, metadataStale: 0, admissionDisabled: 0, capacityBlocked: 0, warming: 0, collecting: 1, viewerOnly: 0, zeroChatAfterAge: 0 },
        },
      }),
      status: 200,
    })

    const result = await fetchPublicHub()
    expect(result.hubEndpointOk).toBe(true)
    expect(result.data.liveChannels).toHaveLength(1)
    expect(apiClient).toHaveBeenCalledTimes(1)
    expect(String(apiClient.mock.calls[0]?.[0])).toContain('/v1/public/hub')
  })

  it('fetchPublicHub never calls raw readiness endpoints', async () => {
    apiClient.mockRejectedValueOnce(new Error('hub down'))
    apiClient.mockResolvedValueOnce({
      data: { streamsTracked: 1, emotesIndexed: 1, updatedAt: new Date().toISOString() },
      status: 200,
    })
    apiClient.mockResolvedValueOnce({
      data: { status: 'operational', degraded: false, updatedAt: new Date().toISOString() },
      status: 200,
    })

    const result = await fetchPublicHub()
    expect(result.loadSource).toBe('stats-fallback')
    expect(apiClient.mock.calls.every((call) => !String(call[0]).includes('/readiness'))).toBe(true)
    const hubCalls = apiClient.mock.calls.filter((call) => String(call[0]).includes('/v1/public/hub'))
    expect(hubCalls).toHaveLength(1)
  })

  it('fetchPublicHubStatsFallback never re-fetches the full hub', async () => {
    apiClient.mockResolvedValueOnce({
      data: { streamsTracked: 1, emotesIndexed: 1, updatedAt: new Date().toISOString() },
      status: 200,
    })
    apiClient.mockResolvedValueOnce({
      data: { status: 'operational', degraded: false, updatedAt: new Date().toISOString() },
      status: 200,
    })

    const result = await fetchPublicHubStatsFallback()
    expect(result.loadSource).toBe('stats-fallback')
    expect(result.hubEndpointOk).toBe(false)
    expect(apiClient.mock.calls.every((call) => !String(call[0]).includes('/v1/public/hub'))).toBe(true)
  })

  it('stats fallback does not treat corpus-only degradation as database down', async () => {
    apiClient.mockResolvedValueOnce({
      data: { streamsTracked: 1, emotesIndexed: 1, updatedAt: new Date().toISOString() },
      status: 200,
    })
    apiClient.mockResolvedValueOnce({
      data: {
        status: 'degraded',
        api: 'up',
        degraded: true,
        components: { api: 'up', coverage: 'degraded', corpus: 'degraded' },
        updatedAt: new Date().toISOString(),
      },
      status: 200,
    })

    const result = await fetchPublicHubStatsFallback()
    expect(result.data.coverage.databaseOk).toBe(true)
    expect(result.data.coverage.state).toBe('degraded')
  })

  it('fetchPublicHubBase never calls readiness endpoints', async () => {
    apiClient.mockResolvedValueOnce({
      data: normalizePublicHub({ generatedAt: new Date().toISOString(), poolSize: 1, liveChannels: [{ login: 'xqc', viewers: 1, chatPerMin: 1, seventvPerMin: 0, coverageState: 'synced', trendPct: 0 }] }),
      status: 200,
    })

    const base = await fetchPublicHubBase()
    expect(base.hubEndpointOk).toBe(true)
    expect(apiClient).toHaveBeenCalledTimes(1)
    expect(String(apiClient.mock.calls[0]?.[0])).toContain('/v1/public/hub')
  })

  it('stats fallback uses only sanitized public endpoints', async () => {
    apiClient.mockRejectedValueOnce(new Error('hub down'))
    apiClient.mockResolvedValueOnce({
      data: { streamsTracked: 1, emotesIndexed: 1, updatedAt: new Date().toISOString() },
      status: 200,
    })
    apiClient.mockResolvedValueOnce({
      data: { status: 'operational', degraded: false, updatedAt: new Date().toISOString() },
      status: 200,
    })

    await fetchPublicHub()
    const paths = apiClient.mock.calls.map((call) => String(call[0]))
    expect(paths.some((path) => path.includes('/v1/public/stats'))).toBe(true)
    expect(paths.some((path) => path.includes('/v1/public/status'))).toBe(true)
    expect(paths.every((path) => !path.includes('/v1/analytics/'))).toBe(true)
  })
})

describe('public hub JSON safety', () => {
  it('normalizePublicHub omits forbidden top-level keys from partial payloads', () => {
    const hub = normalizePublicHub({
      livePulseMoments: [{ offsetSeconds: 60, score: 80, label: 'peak', login: 'rubius', streamId: '1' }],
    })
    const serialized = JSON.stringify(hub)
    expect(serialized).not.toMatch(/"principal"/)
    expect(serialized).not.toMatch(/"rawChat"/)
    expect(hub.livePulseMoments[0]?.login).toBe('rubius')
  })
})

describe('fetchHistoricalHubMoments', () => {
  beforeEach(() => {
    apiClient.mockReset()
  })

  it('requests bucket-scoped corpus peaks and absolutizes emote URLs', async () => {
    apiClient.mockResolvedValueOnce({
      data: {
        bucketT: 1_719_000_000_000,
        bucketStart: '2024-07-01T12:00:00.000Z',
        bucketEnd: '2024-07-01T12:42:00.000Z',
        hubGeneratedAt: '2026-07-02T12:00:00.000Z',
        source: 'corpus_historical',
        status: 'ready',
        activityWindowMinutes: 10_080,
        moments: [
          {
            offsetSeconds: 120,
            score: 88,
            label: 'Chat spike',
            login: 'xqc',
            streamId: 's1',
            source: 'corpus_historical',
            topEmotes: [{ name: 'Nope', provider: '7tv', count: 12, imageUrl: '/emotes/u/1x.webp' }],
          },
        ],
      },
      status: 200,
    })

    const result = await fetchHistoricalHubMoments(1_719_000_000_000, '7d')
    expect(String(apiClient.mock.calls[0]?.[0])).toContain('/v1/public/hub/moments')
    expect(String(apiClient.mock.calls[0]?.[0])).toContain('bucketT=1719000000000')
    expect(result.status).toBe('ready')
    expect(result.source).toBe('corpus_historical')
    expect(result.hubGeneratedAt).toBe('2026-07-02T12:00:00.000Z')
    expect(result.moments[0]?.topEmotes?.[0]?.imageUrl).toContain('https://api.streampulse.stream/emotes/')
  })

  it('normalizePublicHubMoments keeps hosted-safe shape', () => {
    const payload = normalizePublicHubMoments({
      status: 'empty',
      reason: 'no_corpus_peaks_in_bucket',
      moments: [],
    })
    expect(payload.source).toBe('corpus_historical')
    expect(payload.hubGeneratedAt).toBe('')
    expect(payload.moments).toEqual([])
  })
})
