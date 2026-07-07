import { test, expect } from '@playwright/test'
import { attachConsoleErrorGuard, assertNoConsoleErrors } from './helpers/assertions'
import { installHubUxMock } from './helpers/hubUxMock'
import type { Page } from '@playwright/test'

/** Mock hub where chart peak viewers are much lower than live pool sum — sanity banner should show. */
async function installSparseViewerRollupMock(page: Page): Promise<void> {
  const now = Date.now()
  const bucketMs = 6 * 60_000
  const alignedEnd = Math.floor(now / bucketMs) * bucketMs
  const liveChannels = [
    {
      login: 'xqc',
      displayName: 'xQc',
      category: 'Just Chatting',
      viewers: 45_000,
      chatPerMin: 200,
      emotesPerMin: 80,
      seventvPerMin: 60,
      coverageState: 'synced',
      trendPct: 5,
    },
    {
      login: 'sodapoppin',
      displayName: 'sodapoppin',
      category: 'IRL',
      viewers: 38_000,
      chatPerMin: 180,
      emotesPerMin: 70,
      seventvPerMin: 50,
      coverageState: 'synced',
      trendPct: 3,
    },
  ]

  await page.route(/\/v1\/public\/hub(\?.*)?$/, async (route) => {
    const url = new URL(route.request().url())
    const is24h = url.searchParams.get('activityWindow') === '24h'
    const windowMinutes = is24h ? 24 * 60 : 30
    const activityPoints = is24h
      ? Array.from({ length: 20 }, (_, index) => {
          const t = alignedEnd - (19 - index) * bucketMs
          const viewers = index < 10 ? 450_000 : 43_000
          return {
            t,
            chat: 5000 + index * 100,
            seventv: 400,
            twitch: 200,
            viewers,
            emotes: 800,
            bucketComplete: index < 19,
          }
        })
      : Array.from({ length: 8 }, (_, index) => ({
          t: alignedEnd - (7 - index) * bucketMs,
          chat: 5000,
          seventv: 400,
          twitch: 200,
          viewers: 43_000,
          emotes: 800,
          bucketComplete: index < 7,
        }))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        generatedAt: new Date().toISOString(),
        poolSize: 494,
        corpus: {
          streamsTracked: 14_600,
          momentsDetected: 45000,
          chatMessagesProcessed: 9_000_000,
          emotesIndexed: 120_000,
          vodsAnalyzed: 800,
        },
        coverage: {
          liveChannels: 520,
          trackingMax: 500,
          backfillActive: 0,
          backfillMax: 4,
          syncActive: 0,
          emotesIndexed: 120_000,
          databaseOk: true,
          state: 'operational',
        },
        corpusPipeline: {
          generatedAt: new Date().toISOString(),
          state: 'degraded',
          topN: 500,
          liveAdmissionTopN: 500,
          maxActiveIrcChannels: 500,
          collectorActive: 493,
          collectorMax: 500,
          roster: {
            live: 520,
            collectorTracking: 493,
            expectedCollectorRows: 520,
            liveCollectorDeficitRows: 27,
            metadataOnly: 0,
            metadataStale: 0,
            admissionDisabled: 0,
            capacityBlocked: 0,
            warming: 0,
            collecting: 493,
            viewerOnly: 0,
            zeroChatAfterAge: 0,
          },
        },
        activity: {
          points: activityPoints,
          windowMinutes,
          channelCount: liveChannels.length,
          livePoolViewerSum: 83_000,
          peakViewersAt: activityPoints[9]?.t,
        },
        emoteIntel: {
          emotesPerMin: 88,
          topEmoteSharePct: 22,
          uniqueEmotes: 140,
          biggestPeakPerMin: 320,
          seventvSharePct: 61,
          providerShares: [],
        },
        topEmotes: [],
        topMovers: [],
        liveChannels,
        moments: [],
        livePulseMoments: [],
        featuredSession: { state: 'empty', reason: 'no_qualifying_session' },
      }),
    })
  })

  await page.route(/\/v1\/extension\/health(\?.*)?$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }),
  )
  await page.route(/\/v1\/public\/stats(\?.*)?$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }),
  )
  await page.route(/\/v1\/public\/hub\/moments(\?.*)?$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ready', moments: [] }) }),
  )
}

async function installTogetherChannelMock(page: Page): Promise<void> {
  await installHubUxMock(page)
  await page.route(/\/v1\/public\/hub(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue()
      return
    }
    const response = await route.fetch()
    const hub = await response.json()
    hub.liveChannels = [
      {
        login: 'cucurucho',
        displayName: 'Cucurucho',
        category: 'Just Chatting',
        title: 'Streaming together with xqc',
        viewers: 18_000,
        chatPerMin: 120,
        emotesPerMin: 40,
        seventvPerMin: 30,
        coverageState: 'synced',
        trendPct: 8,
        streamingTogether: true,
        hostLogin: 'xqc',
        togetherWith: ['xqc'],
      },
      ...(Array.isArray(hub.liveChannels) ? hub.liveChannels.slice(1) : []),
    ]
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(hub) })
  })
}

test.describe('hub metrics honesty (mocked hub)', () => {
  test.beforeEach(async ({ page }) => {
    await installHubUxMock(page)
  })

  test('KPI header separates live pool, corpus streams, and live pool viewers', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await page.goto('/analytics')
    await expect(page.getByText('Live in pool', { exact: true })).toBeVisible()
    await expect(page.getByText('Corpus streams', { exact: true })).toBeVisible()
    await expect(page.getByText('Live pool viewers', { exact: true })).toBeVisible()
    await expect(page.getByText('Tracked streams', { exact: true })).toHaveCount(0)
    await expect(page.getByText('1.2K', { exact: true }).first()).toBeVisible()
    await assertNoConsoleErrors(page, errors)
  })

  test('Live Activity legend lists pool, IRC, roster, and corpus separately', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await page.goto('/analytics')
    const legend = page.locator('.figma-global-activity__lede').nth(1)
    await expect(legend).toContainText(/96 live in pool/)
    await expect(legend).toContainText(/40\/96 on IRC/)
    await expect(legend).toContainText(/corpus streams total/)
    await expect(legend).not.toContainText(/live tracked/i)
    await assertNoConsoleErrors(page, errors)
  })

  test('Live channels matrix header distinguishes pool, IRC, and roster', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await page.goto('/analytics')
    const sub = page.locator('.live-channels-matrix .figma-block__sub')
    await expect(sub).toContainText(/live in pool/)
    await expect(sub).toContainText(/IRC collecting/)
    await expect(sub).toContainText(/roster live/)
    await assertNoConsoleErrors(page, errors)
  })

  test('category column shows em dash when game missing', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await page.route(/\/v1\/public\/hub(\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          generatedAt: new Date().toISOString(),
          poolSize: 1,
          corpus: { streamsTracked: 100, momentsDetected: 0, chatMessagesProcessed: 0, emotesIndexed: 0, vodsAnalyzed: 0 },
          coverage: { liveChannels: 1, trackingMax: 100, backfillActive: 0, backfillMax: 0, syncActive: 0, emotesIndexed: 0, databaseOk: true, state: 'operational' },
          corpusPipeline: {
            generatedAt: new Date().toISOString(),
            state: 'healthy',
            topN: 100,
            collectorActive: 1,
            collectorMax: 100,
            roster: { live: 1, collectorTracking: 1, expectedCollectorRows: 1, liveCollectorDeficitRows: 0, metadataOnly: 0, metadataStale: 0, admissionDisabled: 0, capacityBlocked: 0, warming: 0, collecting: 1, viewerOnly: 0, zeroChatAfterAge: 0 },
          },
          activity: { points: [], windowMinutes: 60, channelCount: 1 },
          emoteIntel: { emotesPerMin: 0, topEmoteSharePct: 0, uniqueEmotes: 0, biggestPeakPerMin: 0, seventvSharePct: 0, providerShares: [] },
          topEmotes: [],
          topMovers: [],
          liveChannels: [
            {
              login: 'nocategory',
              displayName: 'NoCategory',
              category: '',
              viewers: 5000,
              chatPerMin: 50,
              seventvPerMin: 20,
              coverageState: 'synced',
              trendPct: 0,
            },
          ],
          moments: [],
          livePulseMoments: [],
          featuredSession: { state: 'empty', reason: 'no_qualifying_session' },
        }),
      })
    })
    await page.goto('/analytics')
    const matrix = page.locator('.live-channels-matrix')
    await expect(matrix).toBeVisible()
    await expect(matrix.getByText('Live now', { exact: true })).toHaveCount(0)
    await expect(matrix.locator('td.live-channels-matrix__hide-md').first()).toHaveText('—')
    await assertNoConsoleErrors(page, errors)
  })
})

test.describe('hub metrics sanity banner (mocked sparse rollups)', () => {
  test('hides sanity banner once live pool floor lifts sparse chart peaks', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await installSparseViewerRollupMock(page)
    await page.goto('/analytics')
    await expect(page.locator('.figma-global-activity__sanity-banner')).toHaveCount(0)
    await expect(page.getByText('Live pool sum now', { exact: true })).toBeVisible()
    await assertNoConsoleErrors(page, errors)
  })

  test('24h view shows live pool sum KPI while chart floors sparse buckets', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await installSparseViewerRollupMock(page)
    await page.goto('/analytics')
    await page.getByRole('button', { name: /^24h$/i }).click()
    await expect(page.getByText('Live pool sum now', { exact: true })).toBeVisible()
    await expect(page.locator('.figma-global-activity__peak-row').getByText('83K', { exact: true })).toBeVisible()
    await assertNoConsoleErrors(page, errors)
  })
})

test.describe('streaming together badge (mocked)', () => {
  test('matrix and rail show Together badge with tooltip', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await installTogetherChannelMock(page)
    await page.goto('/analytics')
    const badge = page.locator('.stream-together-badge').first()
    await expect(badge).toBeVisible()
    await expect(badge).toHaveText('Together')
    await expect(badge).toHaveAttribute('title', /Streaming together with xQc/i)
    await assertNoConsoleErrors(page, errors)
  })
})

test.describe('hub metrics honesty (hosted API)', () => {
  test('hosted hub loads with honest KPI labels', async ({ page }) => {
    test.skip(!!process.env.PLAYWRIGHT_MOCK_ONLY, 'hosted check skipped when PLAYWRIGHT_MOCK_ONLY=1')

    const errors = attachConsoleErrorGuard(page)
    await page.goto('/analytics', { waitUntil: 'domcontentloaded' })

    await expect(page.getByText('Live in pool', { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Corpus streams', { exact: true })).toBeVisible()
    await expect(page.getByText('Tracked streams', { exact: true })).toHaveCount(0)

    const legend = page.locator('.figma-global-activity .figma-global-activity__lede').nth(1)
    await expect(legend).toBeVisible({ timeout: 15_000 })
    await expect(legend).toContainText(/live in pool/)
    await expect(legend).toContainText(/on IRC/)
    await expect(legend).toContainText(/corpus streams total/)

    await assertNoConsoleErrors(page, errors)
  })
})
