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

test.describe('analytics hub Live Wire right rail layout', () => {
  test.beforeEach(async ({ page }) => {
    await installHubUxMock(page)
  })

  for (const viewport of VIEWPORTS) {
    test(`single Live Wire right rail @ ${viewport.width}px`, async ({ page }) => {
      const errors = attachConsoleErrorGuard(page)
      await page.setViewportSize(viewport)
      await page.goto('/analytics')

      // Single mount: one rail <aside>, never duplicated at any width.
      const rail = page.locator('.figma-analytics__right-rail')
      await expect(rail).toHaveCount(1)
      await expect(page.locator('.hub-live-wire--rail')).toBeVisible()
      await expect(page.locator('.hub-live-wire__rail-list .hub-live-wire__rail-card').first()).toBeVisible()

      // Live network feed from the mock → 2 moments in the "Live now" tier.
      await expect(page.locator('.hub-live-wire__rail-tier--live')).toHaveText('Live now')
      await expect(page.locator('.hub-live-wire__rail-list .hub-live-wire__rail-card')).toHaveCount(2)

      // Cards expose sibling actions; no href="#" anywhere in the rail.
      await expect(page.locator('.hub-live-wire__action[href="#"]')).toHaveCount(0)
      await expect(page.locator('.hub-live-wire__action', { hasText: 'View moment' }).first()).toBeVisible()

      const frame = page.locator('.figma-analytics__frame--with-right-rail')
      await expect(frame).toHaveCount(1)
      const mainBox = await page.locator('.figma-analytics__main').boundingBox()
      const railBox = await rail.boundingBox()
      expect(mainBox).toBeTruthy()
      expect(railBox).toBeTruthy()

      if (viewport.width >= 1440) {
        // Rail is the 3rd frame column, to the right of the center column.
        expect(railBox!.x).toBeGreaterThanOrEqual(mainBox!.x + mainBox!.width - 4)
        // Sticky rail participates in the frame grid (not display:none).
        await expect(rail).toHaveCSS('display', 'block')
        await expect(rail).toHaveCSS('position', 'sticky')
      } else {
        // Rail is in-flow below the center column (single mount, repositioned by grid-area).
        expect(railBox!.y).toBeGreaterThanOrEqual(mainBox!.y + mainBox!.height - 4)
      }

      // The old in-chart annotation lane is gone.
      await expect(page.locator('.figma-global-activity__annotation-lane')).toHaveCount(0)
      await expect(page.locator('.hub-live-wire--lane')).toHaveCount(0)

      await assertNoPageHorizontalOverflow(page)
      await assertNoConsoleErrors(page, errors)
    })
  }

  test('rail survives 1440px at deviceScaleFactor 1.25', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1.25,
    })
    const page = await context.newPage()
    const errors = attachConsoleErrorGuard(page)
    await installHubUxMock(page)
    await page.goto('/analytics')
    await expect(page.locator('.figma-analytics__right-rail')).toHaveCount(1)
    await expect(page.locator('.hub-live-wire--rail')).toBeVisible()
    await expect(page.locator('.hub-live-wire__action[href="#"]')).toHaveCount(0)
    await assertNoPageHorizontalOverflow(page)
    await assertNoConsoleErrors(page, errors)
    await context.close()
  })
})