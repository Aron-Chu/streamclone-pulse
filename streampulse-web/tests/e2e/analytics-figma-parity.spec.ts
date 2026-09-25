import { test, expect } from '@playwright/test'
import { attachConsoleErrorGuard, assertNoConsoleErrors, assertNoPageHorizontalOverflow } from './helpers/assertions'
import { installMockApi } from './helpers/mockApi'

async function mockPortalSessionUnavailable(page: import('@playwright/test').Page): Promise<void> {
  await page.route(/\/v1\/portal\/analytics\/streams\/[^/]+\/peaks/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ streamId: 'fixture-stream', login: 'xqc', peaks: [], updatedAt: Date.now() }) }),
  )
  await page.route(/\/v1\/portal\/analytics\/streams\/[^/]+\/coverage-truth/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ streamId: 'fixture-stream', login: 'xqc', coverage: { state: 'warming', message: 'preview' }, coverageTruth: [], updatedAt: Date.now() }) }),
  )
  await page.route(/\/v1\/portal\/analytics\/streams\/[^/]+\/replay-heatmap/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ streamId: 'fixture-stream', points: [], updatedAt: Date.now() }) }),
  )
}

const VIEWPORTS = [
  { width: 1366, height: 900 },
  { width: 1440, height: 900 },
  { width: 1600, height: 900 },
] as const

for (const viewport of VIEWPORTS) {
  test.describe(`analytics hub @ ${viewport.width}px`, () => {
    test.use({ viewport })

    test('/analytics renders aggregate hub without horizontal overflow', async ({ page }) => {
      const errors = attachConsoleErrorGuard(page)
      await installMockApi(page)
      await page.goto('/analytics')
      await expect(page.getByRole('main', { name: /StreamPulse analytics/i })).toBeVisible()
      await expect(page.getByRole('heading', { level: 1, name: /Command center/i })).toBeVisible()
      await expect(page.locator('.figma-global-activity__annotation-lane .hub-live-wire--lane')).toBeVisible()
      await expect(page.locator('.figma-analytics__right-rail, .hub-live-wire--rail')).toHaveCount(0)
      if (viewport.width >= 1100) {
        await expect(page.getByRole('navigation', { name: /Analytics sections/i })).toBeVisible()
      }
      await expect(page.locator('#section-pulse-moments')).toBeVisible()
      await expect(page.locator('.figma-global-activity__hub-chart .hx-chart2')).toBeVisible()
      await assertNoPageHorizontalOverflow(page)
      await assertNoConsoleErrors(page, errors)
    })

    test('/analytics/xqc renders channel shell without horizontal overflow', async ({ page }) => {
      const errors = attachConsoleErrorGuard(page)
      await installMockApi(page)
      await mockPortalSessionUnavailable(page)
      await page.goto('/analytics/xqc')
      await expect(page.getByRole('main', { name: /Analytics for xqc/i })).toBeVisible()
      await assertNoPageHorizontalOverflow(page)
      await assertNoConsoleErrors(page, errors)
    })

    test('/analytics/xqc/s/fixture-stream renders session route without horizontal overflow', async ({ page }) => {
      const errors = attachConsoleErrorGuard(page)
      await installMockApi(page)
      await mockPortalSessionUnavailable(page)
      await page.goto('/analytics/xqc/s/fixture-stream')
      await expect(page.getByRole('main', { name: /Analytics for xqc/i })).toBeVisible()
      await assertNoPageHorizontalOverflow(page)
      await assertNoConsoleErrors(page, errors)
    })
  })
}
