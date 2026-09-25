import { test, expect } from '@playwright/test'

// Exercise the actual rejected lazy import in dev or a production build.
test('failed analytics module offers real document reload and recovers', async ({ page }) => {
  let fail = true
  await page.route(/\/(?:src\/routes\/analytics\/AnalyticsLandingPage\.tsx|assets\/AnalyticsLandingPage-[^/]+\.js)(?:\?.*)?$/, route => fail ? route.abort() : route.continue())
  await page.goto('/analytics')
  await expect(page.getByRole('heading', { name: 'This page could not load' })).toBeVisible()
  fail = false
  await page.getByRole('button', { name: 'Reload page', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Command center', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'This page could not load' })).toHaveCount(0)
})
