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

test.describe('analytics hub Live Wire annotation lane', () => {
  test.beforeEach(async ({ page }) => {
    await installHubUxMock(page)
  })

  for (const viewport of VIEWPORTS) {
    test(`chart-attached lane stays usable @ ${viewport.width}px`, async ({ page }, testInfo) => {
      const errors = attachConsoleErrorGuard(page)
      await page.setViewportSize(viewport)
      await page.goto('/analytics')

      await expect(page.locator('.figma-analytics__right-rail')).toHaveCount(0)
      await expect(page.locator('#section-live-wire')).toBeVisible()
      await expect(page.locator('.hub-live-wire--lane')).toBeVisible()
      await expect(page.locator('.figma-global-activity__annotation-lane')).toBeVisible()
      await expect(page.locator('.hub-live-wire__chip').first()).toBeVisible()
      await expect(page.getByRole('button', { name: /Recent detections/i })).toHaveCount(0)

      const order = await page.evaluate(() => {
        const wire = document.getElementById('section-live-wire')
        const chart = document.querySelector('.figma-global-activity__hub-chart')
        const chartCol = document.querySelector('.figma-global-activity__chart-col')
        if (!wire || !chart || !chartCol) return null
        const wireBeforeChart =
          Boolean(wire.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING)
        return wireBeforeChart && chartCol.contains(wire) ? 'lane-above-chart-in-col' : 'other'
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

      if (viewport.width === 390 || viewport.width === 1440) {
        await page.locator('.figma-activity-hub').screenshot({
          path: testInfo.outputPath(`live-wire-lane-${viewport.width}.png`),
        })
      }
    })
  }

  test('lane survives 1440px at deviceScaleFactor 1.25', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1.25,
    })
    const page = await context.newPage()
    const errors = attachConsoleErrorGuard(page)
    await installHubUxMock(page)
    await page.goto('/analytics')
    await expect(page.locator('.figma-analytics__right-rail')).toHaveCount(0)
    await expect(page.locator('.hub-live-wire--lane')).toBeVisible()
    await assertNoPageHorizontalOverflow(page)
    await assertNoConsoleErrors(page, errors)
    await context.close()
  })
})
