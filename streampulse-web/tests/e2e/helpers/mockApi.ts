import type { Page } from '@playwright/test'

export interface MockApiOptions {}

export interface MockApi {
  options: MockApiOptions
}

async function json(route: import('@playwright/test').Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

export async function installMockApi(page: Page, options: MockApiOptions = {}): Promise<MockApi> {
  await page.route(/\/v1\/extension\/health(\?.*)?$/, (route) =>
    json(route, 200, { ok: true, version: 'test' }),
  )
  await page.route(/\/v1\/public\/hub(\?.*)?$/, (route) =>
    json(route, 200, {
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
      activity: {
        points: [
          { t: Date.now() - 10 * 60_000, chat: 120, seventv: 40, twitch: 12, bttv: 8, ffz: 5, viewers: 42000, emotes: 65, hasViewerRollup: true, viewerCoverage: 'complete', viewerContributors: 2, viewerExpectedContributors: 2 },
          { t: Date.now() - 5 * 60_000, chat: 180, seventv: 55, twitch: 18, bttv: 11, ffz: 7, viewers: 48000, emotes: 91, hasViewerRollup: true, viewerCoverage: 'complete', viewerContributors: 2, viewerExpectedContributors: 2 },
          { t: Date.now(), chat: 150, seventv: 48, twitch: 15, bttv: 9, ffz: 6, viewers: 45000, emotes: 78, hasViewerRollup: true, viewerCoverage: 'complete', viewerContributors: 2, viewerExpectedContributors: 2 },
        ],
        windowMinutes: 30,
        channelCount: 2,
      },
      emoteIntel: {
        emotesPerMin: 88,
        topEmoteSharePct: 22,
        uniqueEmotes: 140,
        biggestPeakPerMin: 320,
        seventvSharePct: 61,
        providerShares: [
          { provider: '7TV', count: 1200, sharePct: 58 },
          { provider: 'Twitch', count: 420, sharePct: 20 },
          { provider: 'BTTV', count: 280, sharePct: 14 },
          { provider: 'FFZ', count: 170, sharePct: 8 },
        ],
      },
      topEmotes: [
        { name: 'KEKW', provider: '7tv', count: 900, sharePct: 22 },
        { name: 'OMEGALUL', provider: 'bttv', count: 640, sharePct: 16 },
      ],
      topMovers: [],
      liveChannels: [],
      moments: [],
    }),
  )
  await page.route(/\/v1\/public\/stats(\?.*)?$/, (route) =>
    json(route, 200, {
      streamsTracked: 1200,
      momentsDetected: 45000,
      chatMessagesProcessed: 9000000,
      emotesIndexed: 120000,
      vodsAnalyzed: 800,
      updatedAt: new Date().toISOString(),
    }),
  )
  return { options }
}
