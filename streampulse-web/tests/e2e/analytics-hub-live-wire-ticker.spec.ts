import { test, expect } from '@playwright/test'
import {
  attachConsoleErrorGuard,
  assertNoConsoleErrors,
} from './helpers/assertions'
import { installHubUxMock } from './helpers/hubUxMock'

async function assertNoHorizontalOverflow(page: import('@playwright/test').Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement
    return doc.scrollWidth > doc.clientWidth + 1
  })
  expect(overflow, 'page-level horizontal overflow detected').toBe(false)
}

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 900 },
  { width: 1366, height: 900 },
  { width: 1440, height: 900 },
  { width: 1600, height: 900 },
] as const

test.describe('analytics hub Live Wire ticker layout', () => {
  test.beforeEach(async ({ page }) => {
    await installHubUxMock(page)
  })

  for (const viewport of VIEWPORTS) {
    test(`horizontal ticker above chart @ ${viewport.width}px`, async ({ page }) => {
      const errors = attachConsoleErrorGuard(page)
      await page.setViewportSize(viewport)
      await page.goto('/analytics')

      await expect(page.locator('.figma-analytics__side-rail--right')).toHaveCount(0)
      await expect(page.locator('#section-live-wire')).toBeVisible()
      await expect(page.locator('.hub-live-wire--ticker')).toBeVisible()
      await expect(page.locator('.hub-live-wire__ticker-viewport--marquee')).toHaveCount(0)
      await expect(page.locator('.hub-live-wire__chip-event').first()).toBeVisible()

      const activityHub = page.locator('.figma-activity-hub')
      await expect(activityHub).toBeVisible()
      await expect(activityHub.locator('#section-live-wire')).toBeVisible()

      const order = await page.evaluate(() => {
        const wire = document.getElementById('section-live-wire')
        const chart = document.querySelector('.figma-global-activity__hub-chart')
        if (!wire || !chart) return null
        const wireBeforeChart =
          wire.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING
        const hub = document.querySelector('.figma-activity-hub')
        const wireInHub = hub?.contains(wire) ?? false
        return wireBeforeChart && wireInHub ? 'ticker-above-chart-in-hub' : 'other'
      })
      expect(order).toBe('ticker-above-chart-in-hub')

      if (viewport.width >= 1100) {
        const grid = page.locator('.pulse-moments-live--embedded .pulse-moments-live__grid')
        await expect(grid).toBeVisible()
        const mainBox = await page.locator('.figma-analytics__main').boundingBox()
        const gridBox = await grid.boundingBox()
        expect(mainBox).toBeTruthy()
        expect(gridBox).toBeTruthy()
        expect(gridBox!.x + gridBox!.width).toBeLessThanOrEqual(mainBox!.x + mainBox!.width + 2)
      }

      await assertNoHorizontalOverflow(page)
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
    await expect(page.locator('.hub-live-wire--ticker')).toBeVisible()
    await expect(page.locator('.figma-analytics__side-rail--right')).toHaveCount(0)
    await assertNoHorizontalOverflow(page)
    await assertNoConsoleErrors(page, errors)
    await context.close()
  })
})
