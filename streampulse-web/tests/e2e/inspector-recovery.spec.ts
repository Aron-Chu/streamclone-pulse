import { test, expect } from '@playwright/test'

test('a blocked application entry leaves a readable reload fallback', async ({ page }) => {
  await page.route(/\/src\/main\.tsx(?:\?.*)?$/, route => route.abort())
  await page.goto('/analytics/xqc/320241612508')
  await expect(page.getByRole('main', { name: 'Loading StreamPulse' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'reload this page' })).toBeVisible()
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(9, 9, 11)')
})
