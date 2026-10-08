import { expect, test, type Page } from '@playwright/test'
import {
  assertNoUnexpected,
  buildMinutes,
  buildRecap,
  installPortalAcceptanceHarness,
  openAnalyticsSession,
  PORTAL_LOGIN,
  PORTAL_STARTED_AT,
  PORTAL_STREAM_ID,
  type PortalHarness,
} from './helpers/portalAcceptanceHarness'

const PLOT = 'svg[aria-label="Analytics timeline chart"] rect[data-chart-touch-action]'

// Phone/tablet touch regressions for the session chart (OP1-FUN-009,
// OP1-FUN-002 / CX-FUN-009). Mouse behaviour is covered by the desktop suites.
for (const device of [
  { name: 'phone', width: 390, height: 844, deviceScaleFactor: 3 },
  { name: 'tablet', width: 768, height: 1024, deviceScaleFactor: 2 },
] as const) {
  test.describe(`session chart on touch (${device.name})`, () => {
    test.use({
      viewport: { width: device.width, height: device.height },
      deviceScaleFactor: device.deviceScaleFactor,
      hasTouch: true,
      isMobile: true,
      contextOptions: { reducedMotion: 'reduce' },
    })

    async function centerPlot(page: Page) {
      const plot = page.locator(PLOT)
      await expect(plot).toHaveCount(1, { timeout: 25_000 })
      await plot.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }))
      const box = await plot.boundingBox()
      if (!box) throw new Error('plot has no layout box')
      return box
    }

    // No recap moments, so the Moments tab shows the ranked list
    // (MomentReviewPanel) instead of the recap strip.
    async function openRankedSession(page: Page): Promise<PortalHarness> {
      const harness = await installPortalAcceptanceHarness(page)
      harness.setMinutesPayload(buildMinutes({ count: 24, withEmotes: true }))
      harness.setRecapPayload(buildRecap({ topMoments: [] }))
      await openAnalyticsSession(page)
      return harness
    }

    // The last ranked row sits furthest down the list, below the chart.
    async function lastRankedMinute(page: Page) {
      const anchors = page.locator('[data-moment-scroll-anchor]')
      await expect.poll(() => anchors.count(), { timeout: 25_000 }).toBeGreaterThan(1)
      const minuteTs = await anchors.last().getAttribute('data-minute-ts')
      if (!minuteTs) throw new Error('ranked row has no minute')
      const offsetSeconds = Math.round((Date.parse(minuteTs) - Date.parse(PORTAL_STARTED_AT)) / 1000)
      const row = page.locator(`[data-moment-scroll-anchor][data-minute-ts="${minuteTs}"] [data-moment-row]`)
      return { offsetSeconds, row }
    }

    test('a tap on the plot pins the tapped minute', async ({ page }) => {
      const harness = await installPortalAcceptanceHarness(page)
      harness.setMinutesPayload(buildMinutes({ count: 24, withEmotes: true }))
      await openAnalyticsSession(page)
      const box = await centerPlot(page)
      await expect(page.locator('[data-selected-moment-card]')).toHaveCount(0)

      await page.touchscreen.tap(box.x + box.width * 0.4, box.y + box.height * 0.4)

      await expect(page.locator('[data-selected-moment-card]')).toHaveCount(1)
      await assertNoUnexpected(harness)
    })

    test('selecting a ranked minute keeps the chart in view', async ({ page }) => {
      const harness = await openRankedSession(page)
      const { offsetSeconds, row } = await lastRankedMinute(page)
      await centerPlot(page)
      const scrollBefore = await page.evaluate(() => window.scrollY)

      // A #t= change selects the minute the same way a spike tap does.
      await page.evaluate((offset) => { window.location.hash = `t=${offset}` }, offsetSeconds)

      await expect(row).toHaveAttribute('aria-current', 'true')
      await page.waitForTimeout(500)
      expect(Math.abs((await page.evaluate(() => window.scrollY)) - scrollBefore)).toBeLessThan(2)
      const plot = await page.locator(PLOT).boundingBox()
      expect(plot).not.toBeNull()
      expect(plot!.y).toBeGreaterThanOrEqual(0)
      expect(plot!.y + plot!.height).toBeLessThanOrEqual(device.height)
      await assertNoUnexpected(harness)
    })

    test('opening a ranked-minute #t= link does not jump to the Moments list', async ({ page }) => {
      const harness = await openRankedSession(page)
      const { offsetSeconds, row } = await lastRankedMinute(page)

      // Fresh load of the deep link, as when it is opened from a share.
      await page.goto('about:blank')
      await page.goto(`/analytics/${PORTAL_LOGIN}/${PORTAL_STREAM_ID}#t=${offsetSeconds}`, {
        waitUntil: 'domcontentloaded',
      })

      await expect(row).toHaveAttribute('aria-current', 'true', { timeout: 25_000 })
      await page.waitForTimeout(500)
      expect(await page.evaluate(() => window.scrollY)).toBeLessThan(2)
      const plot = await page.locator(PLOT).boundingBox()
      expect(plot).not.toBeNull()
      expect(plot!.y + plot!.height).toBeGreaterThan(0)
      await assertNoUnexpected(harness)
    })
  })
}
