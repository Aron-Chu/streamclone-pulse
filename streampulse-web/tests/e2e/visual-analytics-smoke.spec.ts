import { test, expect } from '@playwright/test'
import { installMockApi } from './helpers/mockApi'
import { attachConsoleErrorGuard, assertNoConsoleErrors } from './helpers/assertions'

async function mockPortalSessionUnavailable(page: import('@playwright/test').Page): Promise<void> {
  await page.route(/\/v1\/portal\/analytics\/streams\/[^/]+\/peaks/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ streamId: 'fixture-stream', login: 'jynxzi', peaks: [], updatedAt: Date.now() }) }),
  )
  await page.route(/\/v1\/portal\/analytics\/streams\/[^/]+\/coverage-truth/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ streamId: 'fixture-stream', login: 'jynxzi', coverage: { state: 'warming', message: 'preview' }, coverageTruth: [], updatedAt: Date.now() }) }),
  )
  await page.route(/\/v1\/portal\/analytics\/streams\/[^/]+\/replay-heatmap/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ streamId: 'fixture-stream', points: [], updatedAt: Date.now() }) }),
  )
}

test('analytics landing uses hub activity chart', async ({ page }) => {
  const errors = attachConsoleErrorGuard(page)
  await installMockApi(page)
  await page.goto('/analytics')
  await expect(page.locator('.figma-global-activity__hub-chart .hx-chart2')).toBeVisible()
  await assertNoConsoleErrors(page, errors)
})

test('channel analytics renders streamclone console by default', async ({ page }) => {
  const errors = attachConsoleErrorGuard(page)
  await installMockApi(page)
  await mockPortalSessionUnavailable(page)
  await page.goto('/analytics/jynxzi')
  await expect(page.getByRole('main', { name: /Analytics for jynxzi/i })).toBeVisible()
  await expect(page.locator('.sc-analytics-console')).toBeVisible()
  await expect(page.locator('.sc-analytics-console h1')).toBeVisible()
  await expect(page.locator('.sc-analytics-console').getByText('Duration', { exact: true })).toBeVisible()
  await expect(page.locator('.sc-analytics-console').getByText('Streams', { exact: true })).toBeVisible()
  await expect(page.locator('.sc-analytics-console').getByRole('button', { name: 'Moments' })).toBeVisible()
  await expect(page.locator('.figma-channel-page')).toHaveCount(0)
  await assertNoConsoleErrors(page, errors)
})

test('channel analytics figma mode renders session dashboard', async ({ page }) => {
  const errors = attachConsoleErrorGuard(page)
  await installMockApi(page)
  await mockPortalSessionUnavailable(page)
  await page.goto('/analytics/jynxzi?figma=1')
  await expect(page.locator('.figma-channel-page')).toBeVisible()
  await expect(page.locator('.figma-session-bar__stats')).toBeVisible()
  await expect(page.locator('.sc-analytics-console')).toHaveCount(0)
  await assertNoConsoleErrors(page, errors)
})
