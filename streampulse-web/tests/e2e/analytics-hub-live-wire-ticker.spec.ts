import { test, expect } from '@playwright/test'
import {
  attachConsoleErrorGuard,
  assertNoConsoleErrors,
  assertNoPageHorizontalOverflow,
} from './helpers/assertions'
import { installHubUxMock } from './helpers/hubUxMock'

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 900 },
  { width: 1366, height: 900 },
  { width: 1440, height: 900 },
  { width: 1600, height: 900 },
] as const

test.describe('analytics hub Signal Wire ticker layout', () => {
  test.beforeEach(async ({ page }) => {
    await installHubUxMock(page)
  })

  for (const viewport of VIEWPORTS) {
    test(`horizontal ticker above chart @ ${viewport.width}px`, async ({ page }) => {
      const errors = attachConsoleErrorGuard(page)
      await page.setViewportSize(viewport)
      await page.goto('/analytics')

      await expect(page.locator('.figma-analytics__side-rail--right')).toHaveCount(0)
      await expect(page.locator('#section-signal-wire')).toBeVisible()
      await expect(page.locator('.hub-live-wire--lane')).toBeVisible()
      await expect(page.locator('.figma-global-activity__annotation-lane')).toBeVisible()
      await expect(page.locator('.hub-live-wire__ticker-viewport--marquee')).toHaveCount(0)
      await expect(page.locator('.hub-live-wire__chip-event').first()).toBeVisible()

      const activityHub = page.locator('.figma-activity-hub')
      await expect(activityHub).toBeVisible()
      await expect(activityHub.locator('#section-signal-wire')).toBeVisible()
      await expect(
        page.locator('.figma-global-activity__chart-col #section-signal-wire'),
      ).toBeVisible()

      const order = await page.evaluate(() => {
        const wire = document.getElementById('section-signal-wire')
        const chart = document.querySelector('.figma-global-activity__hub-chart')
        if (!wire || !chart) return null
        const wireBeforeChart =
          wire.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING
        const chartCol = document.querySelector('.figma-global-activity__chart-col')
        const wireInChartCol = chartCol?.contains(wire) ?? false
        return wireBeforeChart && wireInChartCol ? 'lane-above-chart-in-col' : 'other'
      })
      expect(order).toBe('lane-above-chart-in-col')

      if (viewport.width >= 1100) {
        const grid = page.locator('.pulse-moments-live--embedded .pulse-moments-live__grid')
        await expect(grid).toBeVisible()
        const mainBox = await page.locator('.figma-analytics__main').boundingBox()
        const gridBox = await grid.boundingBox()
        expect(mainBox).toBeTruthy()
        expect(gridBox).toBeTruthy()
        expect(gridBox!.x + gridBox!.width).toBeLessThanOrEqual(mainBox!.x + mainBox!.width + 2)
      }

      await assertNoPageHorizontalOverflow(page)
      await assertNoConsoleErrors(page, errors)
    })
  }

  test('ticker survives 1440px at deviceScaleFactor 1.25', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1.25,
    })
    const page = await context.newPage()
    const errors = attachConsoleErrorGuard(page)
    await installHubUxMock(page)
    await page.goto('/analytics')
    await expect(page.locator('.hub-live-wire--lane')).toBeVisible()
    await expect(page.locator('.figma-analytics__side-rail--right')).toHaveCount(0)
    await assertNoPageHorizontalOverflow(page)
    await assertNoConsoleErrors(page, errors)
    await context.close()
  })
})
