import type { Page } from '@playwright/test'

function build24hActivityPoints(now: number): Array<{
  t: number
  chat: number
  seventv: number
  twitch: number
  bttv: number
  ffz: number
  viewers: number
  emotes: number
  viewerContributors: number
  viewerExpectedContributors: number
  viewerCoverage: 'complete'
  bucketComplete: boolean
}> {
  const bucketMs = 6 * 60_000
  const alignedEnd = Math.floor(now / bucketMs) * bucketMs
  const points: Array<{
    t: number
    chat: number
    seventv: number
    twitch: number
    bttv: number
    ffz: number
    viewers: number
    emotes: number
    viewerContributors: number
    viewerExpectedContributors: number
    viewerCoverage: 'complete'
    bucketComplete: boolean
  }> = []
  for (let i = 0; i < 48; i += 1) {
    const t = alignedEnd - i * bucketMs
    points.push({
      t,
      chat: 36 + (i % 7) * 6,
      seventv: 8 + (i % 5),
      twitch: 4,
      bttv: 2,
      ffz: 1,
      viewers: 500_000 + i * 2_000,
      emotes: 40 + i,
      viewerContributors: 14,
      viewerExpectedContributors: 14,
      viewerCoverage: 'complete',
      bucketComplete: true,
    })
  }
  const historicalT = alignedEnd - 8 * 60 * 60 * 1000
  points.push({
    t: historicalT,
    chat: 42,
    seventv: 10,
    twitch: 6,
    bttv: 3,
    ffz: 2,
    viewers: 920_000,
    emotes: 88,
    viewerContributors: 14,
    viewerExpectedContributors: 14,
    viewerCoverage: 'complete',
    bucketComplete: true,
  })
  return points.sort((a, b) => a.t - b.t)
}

function buildLiveChannels(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const login = index === 0 ? 'xqc' : index === 1 ? 'sodapoppin' : `channel${index}`
    return {
      login,
      displayName: index === 0 ? 'xQc' : login,
      category: 'Just Chatting',
      viewers: 12_000 - index * 200,
      chatPerMin: 200 - index * 3,
      emotesPerMin: 80 - index,
      seventvPerMin: 60 - index,
      coverageState: 'synced',
      trendPct: index % 2 === 0 ? 12 : -4,
    }
  })
}

export type HubUxMockMode = 'ready' | 'empty' | 'error' | 'zero-live'

export type HubUxMockOptions = {
  mode?: HubUxMockMode
  hubDelayMs?: number
}

export async function installHubUxMock(page: Page, options: HubUxMockOptions = {}): Promise<void> {
  const mode = options.mode ?? 'ready'
  const hubDelayMs = options.hubDelayMs ?? 0
  const noLiveData = mode === 'empty' || mode === 'zero-live'
  const now = Date.now()
  const liveChannels = noLiveData || mode === 'error' ? [] : buildLiveChannels(14)
  const activityPoints = noLiveData || mode === 'error' ? [] : build24hActivityPoints(now)
  const newsroomMomentAt = activityPoints.length >= 2
    ? activityPoints[activityPoints.length - 2].t
    : now - 6 * 60_000

  await page.addInitScript(() => {
    const clearStoragePrefix = (storage: Storage, prefix: string) => {
      const keys: string[] = []
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i)
        if (key?.startsWith(prefix)) keys.push(key)
      }
      keys.forEach((key) => storage.removeItem(key))
    }
    clearStoragePrefix(window.localStorage, 'sp:publicHub:v1:')
    clearStoragePrefix(window.sessionStorage, 'sp:bucketMoments:v1:')
  })

  await page.route(/\/v1\/public\/hub\/moments(\?.*)?$/, async (route) => {
    if (mode === 'error') {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'unavailable' }) })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ready',
        reason: undefined,
        moments: noLiveData
          ? []
          : [
          {
            publicMomentId: 'public-xqc-1',
            login: 'xqc',
            displayName: 'xQc',
            streamId: 'hist-1',
            offsetSeconds: 600,
            score: 88,
            label: 'Corpus peak',
            source: 'corpus',
            confidence: 90,
            vodState: 'vod_ready',
            chatPerMin: 220,
            viewerDelta: 90,
            at: now - 8 * 60 * 60 * 1000 + 120_000,
            topEmotes: [
              { name: 'DinoDance', provider: 'twitch', count: 45, sharePct: 30 },
              { name: 'KEKW', provider: '7tv', count: 12, sharePct: 18 },
            ],
          },
        ],
      }),
    })
  })

  await page.route(/\/v1\/public\/hub(\?.*)?$/, async (route) => {
    if (hubDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, hubDelayMs))
    }
    if (mode === 'error') {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'unavailable' }) })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        generatedAt: new Date().toISOString(),
        poolSize: mode === 'empty' ? 0 : 96,
        corpus: {
          streamsTracked: mode === 'empty' ? 0 : 1200,
          momentsDetected: mode === 'empty' ? 0 : 45000,
          chatMessagesProcessed: mode === 'empty' ? 0 : 9_000_000,
          emotesIndexed: mode === 'empty' ? 0 : 120_000,
          vodsAnalyzed: mode === 'empty' ? 0 : 800,
        },
        coverage: {
          liveChannels: liveChannels.length,
          trackingMax: 300,
          backfillActive: 0,
          backfillMax: 4,
          syncActive: 0,
          emotesIndexed: 120_000,
          databaseOk: true,
          state: 'operational',
        },
        corpusPipeline: {
          generatedAt: new Date().toISOString(),
          state: 'healthy',
          topN: 500,
          collectorActive: 40,
          collectorMax: 96,
          roster: {
            live: liveChannels.length,
            collectorTracking: liveChannels.length,
            expectedCollectorRows: liveChannels.length,
            liveCollectorDeficitRows: 0,
            metadataOnly: 0,
            metadataStale: 0,
            admissionDisabled: 0,
            capacityBlocked: 0,
            warming: 0,
            collecting: liveChannels.length,
            viewerOnly: 0,
            zeroChatAfterAge: 0,
          },
        },
        activity: {
          points: activityPoints,
          windowMinutes: 24 * 60,
          channelCount: liveChannels.length,
          livePoolViewerSum: liveChannels.reduce((sum, ch) => sum + ch.viewers, 0),
          peakViewersAt: activityPoints.reduce(
            (best, p) => (p.viewers > (best?.viewers ?? 0) ? p : best),
            activityPoints[0],
          )?.t,
          // Healthy historical projection contract — without these, the honest
          // chart window resolver clamps the 24h series to 30m (legacy path),
          // leaving every point an unmeasured placeholder and the chart empty.
          source: 'historical_projection',
          state: 'healthy',
          availableWindowMinutes: 24 * 60,
          accountedWindowMinutes: 24 * 60,
          measuredWindowMinutes: 24 * 60,
        },
        emoteIntel: noLiveData
          ? {
              emotesPerMin: 0,
              topEmoteSharePct: 0,
              uniqueEmotes: 0,
              biggestPeakPerMin: 0,
              seventvSharePct: 0,
              providerShares: [],
            }
          : {
              emotesPerMin: 88,
              topEmoteSharePct: 22,
              uniqueEmotes: 140,
              biggestPeakPerMin: 320,
              seventvSharePct: 61,
              providerShares: [{ provider: '7TV', count: 1200, sharePct: 58 }],
            },
        topEmotes: noLiveData ? [] : [
          { name: 'KEKW', provider: '7tv', count: 900, sharePct: 22 },
          { name: 'OMEGALUL', provider: 'bttv', count: 640, sharePct: 16 },
        ],
        topMovers: noLiveData ? [] : [
          { login: 'xqc', displayName: 'xQc', emotesPerMin: 40, seventvPerMin: 30 },
          { login: 'sodapoppin', displayName: 'sodapoppin', emotesPerMin: 35, seventvPerMin: 28 },
          { login: 'channel2', displayName: 'channel2', emotesPerMin: 30, seventvPerMin: 22 },
        ],
        liveChannels,
        moments: [],
        livePulseMoments: noLiveData ? [] : [
          {
            publicMomentId: 'public-xqc-1',
            login: 'xqc',
            displayName: 'xQc',
            streamId: 's1',
            offsetSeconds: 120,
            score: 92,
            label: 'Twitch emote spike',
            kind: 'emote_spike',
            source: 'live_irc',
            confidence: 97,
            vodState: 'live_only',
            chatPerMin: 393,
            emotesPerMin: 133,
            viewers: 12_000,
            viewerDelta: 'no change',
            category: 'Minecraft',
            at: newsroomMomentAt,
            topEmotes: [
              { name: 'DinoDance', provider: 'twitch', count: 123, sharePct: 39.2 },
              { name: 'KEKW', provider: '7tv', count: 10, sharePct: 28.5 },
            ],
          },
          {
            publicMomentId: 'public-soda-1',
            login: 'sodapoppin',
            displayName: 'sodapoppin',
            streamId: 's2',
            offsetSeconds: 240,
            score: 84,
            label: 'Chat spike',
            kind: 'chat_spike',
            source: 'live_irc',
            confidence: 91,
            vodState: 'live_only',
            chatPerMin: 280,
            emotesPerMin: 95,
            viewers: 9800,
            viewerDelta: '+120',
            category: 'Just Chatting',
            at: newsroomMomentAt - 6 * 60_000,
            topEmotes: [
              { name: 'OMEGALUL', provider: 'bttv', count: 88, sharePct: 31 },
            ],
          },
        ],
        featuredSession: { state: 'empty', reason: 'no_qualifying_session' },
      }),
    })
  })

  await page.route(/\/v1\/extension\/health(\?.*)?$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, version: 'test' }) }),
  )
  await page.route(/\/v1\/public\/stats(\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        streamsTracked: 1200,
        momentsDetected: 45000,
        chatMessagesProcessed: 9000000,
        emotesIndexed: 120000,
        vodsAnalyzed: 800,
        updatedAt: new Date().toISOString(),
      }),
    }),
  )
  // Newsroom is additive and production must fail closed on an unsupported
  // contract. Tests that need stories install a later route override.
  await page.route(/\/v1\/public\/newsroom(\/[^?]+)?(\?.*)?$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ schemaVersion: 0 }) }),
  )
}
