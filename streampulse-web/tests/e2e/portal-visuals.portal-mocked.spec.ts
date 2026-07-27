import { expect, test } from '@playwright/test'
import {
  assertEmotePlotLines,
  assertNoUnexpected,
  buildDetail,
  buildEmotes30d,
  buildMinutes,
  buildStatus,
  buildStreamRecord,
  buildSummary,
  installPortalAcceptanceHarness,
  loadXqcGames,
  openAnalyticsSession,
  openEmotesRail,
  PORTAL_VOD_ID,
  setChartViewEmotes,
} from './helpers/portalAcceptanceHarness'

async function assertNonBlankScreenshot(page: import('@playwright/test').Page, name: string) {
  const shot = await page.screenshot({ fullPage: false })
  expect(shot.byteLength).toBeGreaterThan(5_000)
  await expect(page).toHaveScreenshot(name, {
    maxDiffPixelRatio: 0.04,
    animations: 'disabled',
  })
}

test.describe('portal responsive visuals (mocked)', () => {
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'narrow', width: 390, height: 844 },
  ] as const) {
    test.describe(viewport.name, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } })

      test(`G: live snapshot (${viewport.name})`, async ({ page }) => {
        const harness = await installPortalAcceptanceHarness(page)
        harness.setMinutesPayload(buildMinutes({ count: 24, withEmotes: true }))
        await openAnalyticsSession(page)
        await expect(page.locator('svg').first()).toBeVisible({ timeout: 25_000 })
        await assertNonBlankScreenshot(page, `portal-live-${viewport.name}.png`)
        await assertNoUnexpected(harness)
      })

      test(`G: ended/resolving snapshot (${viewport.name})`, async ({ page }) => {
        const harness = await installPortalAcceptanceHarness(page)
        harness.setMinutesPayload(buildMinutes({ count: 24 }))
        harness.detail.setFallback({
          kind: 'json',
          body: buildDetail({
            state: 'ended',
            availability: { liveDvrState: 'ended', vodState: 'resolving', chartState: 'usable', chartUsable: true },
            stream: buildStreamRecord({ endedAt: '2026-07-26T04:00:00.000Z', currentViewers: 0 }),
          }),
        })
        harness.status.setFallback({
          kind: 'json',
          body: buildStatus({
            state: 'ended',
            availability: { liveDvrState: 'ended', vodState: 'resolving', chartState: 'usable' },
          }),
        })
        await openAnalyticsSession(page)
        await expect(page.getByText(/Waiting for Twitch VOD/i).first()).toBeVisible({ timeout: 20_000 })
        await assertNonBlankScreenshot(page, `portal-resolving-${viewport.name}.png`)
        await assertNoUnexpected(harness)
      })

      test(`G: linked VOD snapshot (${viewport.name})`, async ({ page }) => {
        const harness = await installPortalAcceptanceHarness(page)
        harness.setMinutesPayload(buildMinutes({ count: 24 }))
        harness.detail.setFallback({
          kind: 'json',
          body: buildDetail({
            state: 'ended',
            vodId: PORTAL_VOD_ID,
            availability: {
              liveDvrState: 'ended',
              vodState: 'linked',
              vodId: PORTAL_VOD_ID,
              chartState: 'usable',
              chartUsable: true,
            },
            stream: buildStreamRecord({
              endedAt: '2026-07-26T04:00:00.000Z',
              vodId: PORTAL_VOD_ID,
              currentViewers: 0,
            }),
          }),
        })
        harness.status.setFallback({
          kind: 'json',
          body: buildStatus({
            state: 'ended',
            vodId: PORTAL_VOD_ID,
            availability: {
              liveDvrState: 'ended',
              vodState: 'linked',
              vodId: PORTAL_VOD_ID,
              chartState: 'usable',
            },
          }),
        })
        await openAnalyticsSession(page)
        await expect(page.getByText(new RegExp(PORTAL_VOD_ID))).toBeVisible({ timeout: 20_000 })
        await assertNonBlankScreenshot(page, `portal-linked-vod-${viewport.name}.png`)
        await assertNoUnexpected(harness)
      })

      test(`G: request failure snapshot (${viewport.name})`, async ({ page }) => {
        const harness = await installPortalAcceptanceHarness(page)
        harness.setMinutesPayload(buildMinutes({ count: 20 }))
        harness.detail.setFallback({
          kind: 'json',
          body: buildDetail({
            state: 'ended',
            availability: {
              liveDvrState: 'ended',
              vodState: 'request_failed',
              vodMessage: 'Helix timeout',
              chartState: 'usable',
              chartUsable: true,
            },
          }),
        })
        harness.status.setFallback({
          kind: 'json',
          body: buildStatus({
            state: 'ended',
            availability: {
              liveDvrState: 'ended',
              vodState: 'request_failed',
              vodMessage: 'Helix timeout',
              chartState: 'usable',
            },
          }),
        })
        await openAnalyticsSession(page)
        await expect(page.getByText(/VOD lookup failed/i).first()).toBeVisible({ timeout: 20_000 })
        await assertNonBlankScreenshot(page, `portal-request-failed-${viewport.name}.png`)
        await assertNoUnexpected(harness)
      })

      test(`G: multi-game timeline snapshot (${viewport.name})`, async ({ page }) => {
        const harness = await installPortalAcceptanceHarness(page)
        const games = loadXqcGames()
        const lastStart = Number(games[games.length - 1].offsetSeconds)
        const sampleOffsets = [0, 60, 15437, 21617, 32237, lastStart, lastStart + 60]
        const minutes = buildMinutes({ count: 2, withEmotes: false })
        minutes.minutes = sampleOffsets.map((offsetSeconds, i) => ({
          offsetSeconds,
          viewerAvg: 10_000 + i,
          viewerMax: 10_100 + i,
          viewerLatest: 10_050 + i,
          viewerSamples: 2,
          chatCount: 30 + i,
          totalEmoteCount: 10,
          seventvEmoteCount: 4,
          topEmotes: [],
        }))
        harness.setMinutesPayload(minutes)
        harness.setGamesPayload(games)
        await openAnalyticsSession(page)
        await expect(page.getByLabel('Games played').first()).toBeVisible({ timeout: 25_000 })
        await assertNonBlankScreenshot(page, `portal-games-${viewport.name}.png`)
        await assertNoUnexpected(harness)
      })

      test(`G: six-emote selection snapshot (${viewport.name})`, async ({ page }) => {
        const harness = await installPortalAcceptanceHarness(page)
        harness.setMinutesPayload(buildMinutes({ count: 30, withEmotes: true }))
        harness.setSummaryPayload(buildSummary())
        harness.setEmotes30dPayload(buildEmotes30d())
        harness.detail.setFallback({
          kind: 'json',
          body: buildDetail({
            state: 'ended',
            availability: { liveDvrState: 'ended', vodState: 'unavailable', chartState: 'usable', chartUsable: true },
          }),
        })
        await openAnalyticsSession(page)
        await openEmotesRail(page)
        await setChartViewEmotes(page)
        await assertEmotePlotLines(page, 6)
        await assertNonBlankScreenshot(page, `portal-six-emotes-${viewport.name}.png`)
        await assertNoUnexpected(harness)
      })

      test(`G: unavailable emote series snapshot (${viewport.name})`, async ({ page }) => {
        const harness = await installPortalAcceptanceHarness(page)
        harness.setMinutesPayload(buildMinutes({ count: 12, withEmotes: false }))
        harness.setSummaryPayload(buildSummary({ topEmotes: [] }))
        harness.setEmotes30dPayload(buildEmotes30d({ topEmotes: [] }))
        harness.detail.setFallback({
          kind: 'json',
          body: buildDetail({
            state: 'ended',
            availability: { liveDvrState: 'ended', vodState: 'unavailable', chartState: 'usable', chartUsable: true },
          }),
        })
        await openAnalyticsSession(page)
        await openEmotesRail(page)
        await expect(
          page.getByText(/No emotes counted|Collected chat has not matched|Emote/i).first(),
        ).toBeVisible({ timeout: 20_000 })
        await assertNonBlankScreenshot(page, `portal-emotes-unavailable-${viewport.name}.png`)
        await assertNoUnexpected(harness)
      })
    })
  }
})
