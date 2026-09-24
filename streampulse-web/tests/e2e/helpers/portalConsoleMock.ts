import type { Page } from '@playwright/test'

async function json(route: import('@playwright/test').Route, body: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

/** Minimal portal analytics mocks for offline channel/session e2e. */
export async function installPortalConsoleMock(
  page: Page,
  login = 'xqc',
  streamId = 'fixture-stream',
): Promise<void> {
  const startedAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
  const minuteTs = new Date(Date.now() - 30 * 60_000).toISOString()

  await page.route(/\/v1\/portal\/analytics\/channels\/[^/]+\/streams(\?.*)?$/, (route) =>
    json(route, {
      channel: login,
      streams: [
        {
          streamId,
          login,
          displayName: login,
          title: 'Fixture stream',
          category: 'Just Chatting',
          startedAt,
          currentViewers: 36_000,
          peakViewers: 42_000,
          chatMessages: 120_000,
          vodId: '',
        },
      ],
      updatedAt: Date.now(),
    }),
  )

  await page.route(/\/v1\/portal\/analytics\/channels\/[^/]+\/live(\?.*)?$/, (route) =>
    json(route, {
      channel: login,
      state: 'live',
      stream: {
        streamId,
        login,
        displayName: login,
        title: 'Fixture stream',
        category: 'Just Chatting',
        startedAt,
        currentViewers: 36_000,
        peakViewers: 42_000,
        viewerSamples: 120,
        chatMessages: 120_000,
      },
      sources: [{ source: 'irc', state: 'ok', label: 'Live IRC' }],
      updatedAt: Date.now(),
    }),
  )

  await page.route(/\/v1\/portal\/analytics\/streams\/[^/]+\/minutes(\?.*)?$/, (route) =>
    json(route, {
      streamId,
      login,
      points: Array.from({ length: 60 }, (_, i) => ({
        minuteTs: new Date(Date.parse(minuteTs) - (59 - i) * 60_000).toISOString(),
        viewerAvg: 30_000 + i * 100,
        viewerMax: 32_000 + i * 100,
        viewerLatest: 31_000 + i * 100,
        viewerSamples: 4,
        chatCount: 80 + i,
        totalEmoteCount: 40 + i,
        seventvEmoteCount: 25 + i,
        emotes: {},
      })),
      updatedAt: Date.now(),
    }),
  )

  await page.route(/\/v1\/portal\/analytics\/streams\/[^/]+\/summary(\?.*)?$/, (route) =>
    json(route, {
      streamId,
      login,
      channel: login,
      state: 'live',
      stream: {
        streamId,
        login,
        displayName: login,
        startedAt,
        category: 'Just Chatting',
        currentViewers: 36_000,
        peakViewers: 42_000,
        chatMessages: 120_000,
      },
      sources: [{ source: 'irc', state: 'ok', label: 'Live IRC' }],
      updatedAt: Date.now(),
    }),
  )

  await page.route(/\/v1\/portal\/analytics\/streams\/[^/]+\/recap(\?.*)?$/, (route) =>
    json(route, {
      streamId,
      login,
      moments: [
        {
          offsetSeconds: 5437,
          score: 32,
          label: 'Moment',
          viewers: 36_000,
          chatPerMin: 180,
          topEmotes: [{ name: 'KEKW', provider: '7tv', count: 12 }],
        },
      ],
      updatedAt: Date.now(),
    }),
  )

  await page.route(/\/v1\/portal\/analytics\/streams\/[^/]+\/peaks(\?.*)?$/, (route) =>
    json(route, { streamId, login, peaks: [], updatedAt: Date.now() }),
  )

  await page.route(/\/v1\/portal\/analytics\/streams\/[^/]+\/coverage-truth(\?.*)?$/, (route) =>
    json(route, {
      streamId,
      login,
      coverage: { state: 'warming', message: 'preview' },
      coverageTruth: [],
      updatedAt: Date.now(),
    }),
  )

  await page.route(/\/v1\/portal\/analytics\/streams\/[^/]+\/replay-heatmap(\?.*)?$/, (route) =>
    json(route, { streamId, points: [], updatedAt: Date.now() }),
  )

  await page.route(/\/v1\/portal\/analytics\/streams\/[^/]+\/games(\?.*)?$/, (route) =>
    json(route, { streamId, segments: [], updatedAt: Date.now() }),
  )

  await page.route(/\/v1\/portal\/analytics\/streams\/[^/]+\/sync\/status(\?.*)?$/, (route) =>
    json(route, {
      streamId,
      phase: 'live',
      message: 'Collecting live chat',
      updatedAt: startedAt,
      stale: false,
    }),
  )

  await page.route(/\/v1\/portal\/analytics\/channels\/[^/]+\/emotes(\?.*)?$/, (route) =>
    json(route, { channel: login, items: [], updatedAt: Date.now() }),
  )

  await page.route(/\/v1\/channels\/[^/]+(\?.*)?$/, (route) =>
    json(route, {
      login,
      displayName: login,
      profileImageUrl: '',
      isLive: true,
    }),
  )

  await page.route(/\/v1\/analytics\/channels\/[^/]+\/watch(\?.*)?$/, (route) =>
    json(route, { state: 'ok' }),
  )
}
