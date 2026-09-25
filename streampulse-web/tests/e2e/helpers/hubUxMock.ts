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
  for (let i = 0; i < 240; i += 1) {
    const t = alignedEnd - i * bucketMs
    points.push({
      t,
      chat: 36 + (i % 7) * 6,
      seventv: 8 + (i % 5),
      twitch: 4,
      bttv: 2,
      ffz: 1,
      viewers: i === 80 ? 920_000 : 500_000 + (i % 48) * 2_000,
      emotes: 40 + i,
      viewerContributors: 14,
      viewerExpectedContributors: 14,
      viewerCoverage: 'complete',
      bucketComplete: true,
    })
  }
  return points.sort((a, b) => a.t - b.t)
}

function build7dDiurnalActivityPoints(now: number) {
  const bucketMs = 10 * 60_000
  const end = Math.floor(now / bucketMs) * bucketMs
  return Array.from({ length: 1008 }, (_, index) => {
    const phase = (index / 1008) * Math.PI * 14
    const viewers = Math.round(400_000 + 300_000 * Math.sin(phase))
    return {
      t: end - (1007 - index) * bucketMs,
      chat: 40 + (index % 9) * 5,
      seventv: 8 + (index % 5), twitch: 4, bttv: 2, ffz: 1,
      // Keep the exceptional peak in the visible newest bucket as well as in
      // the historical series so the 7d screenshot cannot silently crop it.
      viewers: index === 700 || index === 1007 ? 1_200_000 : Math.max(100_000, Math.min(700_000, viewers)),
      emotes: 40 + (index % 80), viewerContributors: 14, viewerExpectedContributors: 14,
      viewerCoverage: 'complete' as const, bucketComplete: true,
    }
  })
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
  historyUnavailable?: boolean
  mode?: HubUxMockMode
  hubDelayMs?: number
  withComparisons?: boolean
  firstMomentProfileImageUrl?: string
  firstMomentArchiveArtwork?: unknown
  firstMomentHandoffRef?: string
  diurnal7d?: boolean
  matchActivityWindow?: boolean
}

export async function installHubUxMock(page: Page, options: HubUxMockOptions = {}): Promise<void> {
  const mode = options.mode ?? 'ready'
  const hubDelayMs = options.hubDelayMs ?? 0
  const noLiveData = mode === 'empty' || mode === 'zero-live'
  const now = options.diurnal7d ? Date.parse('2026-09-13T12:00:00Z') : Date.now()
  const liveChannels = noLiveData || mode === 'error' ? [] : buildLiveChannels(14)
  const activityPoints = noLiveData || mode === 'error' ? [] : options.diurnal7d ? build7dDiurnalActivityPoints(now) : build24hActivityPoints(now)
  const newsroomMomentAt = activityPoints.length >= 2
    ? activityPoints[activityPoints.length - 2].t
    : now - 6 * 60_000
  const comparisonMetric = (currentPerMin: number, baselinePerMin: number) => ({
    state: 'ready', currentPerMin, baselinePerMin,
    multiplier: currentPerMin / baselinePerMin, absoluteDeltaPerMin: currentPerMin - baselinePerMin,
    currentMeasuredMinutes: 1, currentExpectedMinutes: 1,
    baselineMeasuredMinutes: 30, baselineExpectedMinutes: 30, baselineCoveragePct: 100,
  })
  const comparison = options.withComparisons ? {
    baselineKind: 'current_stream_measured_average_before_event', eventAt: newsroomMomentAt,
    baselineWindow: { start: newsroomMomentAt - 30 * 60_000, end: newsroomMomentAt, expectedMinutes: 30, measuredMinutes: 30, coveragePct: 100 },
    chat: comparisonMetric(393, 160), emotes: comparisonMetric(133, 40),
    evidence: { ircBound: true, eventRollupAvailable: true, baselineMeasuredMinutes: 30, baselineExpectedMinutes: 30, baselineCoveragePct: 100 },
  } : undefined

  await page.addInitScript(() => {
    const resetMarker = 'sp:e2e:hub-storage-reset:v1'
    if (window.sessionStorage.getItem(resetMarker) === 'done') return
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
    // Keep cache entries written by the page available across reloads in the
    // same test. A fresh Playwright page/session receives a fresh reset.
    window.sessionStorage.setItem(resetMarker, 'done')
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
    const requestedWindow = new URL(route.request().url()).searchParams.get('activityWindow') ?? '24h'
    const servingRecent = requestedWindow === '30m'
    const requestedMinutes = ({ '30m': 30, '24h': 1440, '7d': 10080, '1m': 43200, '3m': 129600, '1y': 525600 } as Record<string, number>)[requestedWindow] ?? 1440
    const servedWindowMinutes = options.matchActivityWindow ? requestedMinutes : servingRecent ? 30 : options.diurnal7d ? 10080 : 1440
    const bucketMinutes = options.matchActivityWindow ? Math.max(1, servedWindowMinutes / 240) : servingRecent ? 1 : options.diurnal7d ? 10 : 6
    const recoveringRecent = options.historyUnavailable && servingRecent
    if (options.historyUnavailable && !recoveringRecent) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'hub_unavailable' }) })
      return
    }
    const servedPoints = options.matchActivityWindow && activityPoints.length ? Array.from({ length: Math.min(240, servedWindowMinutes) }, (_, i) => ({
      ...activityPoints[i % activityPoints.length],
      chat: activityPoints[i % activityPoints.length].chat * bucketMinutes,
      emotes: activityPoints[i % activityPoints.length].emotes * bucketMinutes,
      seventv: activityPoints[i % activityPoints.length].seventv * bucketMinutes,
      twitch: activityPoints[i % activityPoints.length].twitch * bucketMinutes,
      bttv: activityPoints[i % activityPoints.length].bttv * bucketMinutes,
      ffz: activityPoints[i % activityPoints.length].ffz * bucketMinutes,
      t: Math.floor(now / (bucketMinutes * 60_000)) * bucketMinutes * 60_000 - (Math.min(240, servedWindowMinutes) - 1 - i) * bucketMinutes * 60_000,
    })) : servingRecent && activityPoints.length ? Array.from({ length: 30 }, (_, i) => ({
      ...activityPoints[activityPoints.length - 1],
      t: Math.floor(now / 60_000) * 60_000 - (30 - i) * 60_000,
    })) : activityPoints
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
        generatedAt: new Date(now).toISOString(),
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
          generatedAt: new Date(now).toISOString(),
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
          points: servedPoints,
          windowMinutes: servedWindowMinutes,
          servedWindowMinutes,
          bucketMinutes,
          channelCount: liveChannels.length,
          livePoolViewerSum: liveChannels.reduce((sum, ch) => sum + ch.viewers, 0),
          peakViewersAt: servedPoints.reduce(
            (best, p) => (p.viewers > (best?.viewers ?? 0) ? p : best),
            servedPoints[0],
          )?.t,
          // Healthy historical projection contract — without these, the honest
          // chart window resolver clamps the 24h series to 30m (legacy path),
          // leaving every point an unmeasured placeholder and the chart empty.
          source: recoveringRecent ? 'live_pool' : 'historical_projection',
          state: 'healthy',
           availableWindowMinutes: servedWindowMinutes,
           accountedWindowMinutes: servedWindowMinutes,
           measuredWindowMinutes: servedWindowMinutes,
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
            profileImageUrl: options.firstMomentProfileImageUrl,
            archiveArtwork: options.firstMomentArchiveArtwork,
            handoffRef: options.firstMomentHandoffRef,
            offsetSeconds: 120,
            comparison,
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
        updatedAt: new Date(now).toISOString(),
      }),
    }),
  )
  // Newsroom is additive and production must fail closed on an unsupported
  // contract. Tests that need stories install a later route override.
  await page.route(/\/v1\/public\/newsroom(\/[^?]+)?(\?.*)?$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ schemaVersion: 0 }) }),
  )
}
