import { test, expect } from '@playwright/test'
import { installPortalAcceptanceHarness, openAnalyticsSession } from './helpers/portalAcceptanceHarness'

for (const width of [390, 768, 1440, 1920]) test(`session controls stay consistent and contained at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  await installPortalAcceptanceHarness(page)
  await openAnalyticsSession(page)
  const overview = page.getByRole('button', { name: 'Overview', exact: true })
  await expect(overview).toBeVisible()
  expect(await overview.evaluate(el => getComputedStyle(el).textTransform)).toBe('none')
  expect(await overview.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe('rgb(255, 255, 255)')
  await overview.focus()
  expect(await overview.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await page.locator('.sc-analytics-console .animate-pulse').evaluateAll(elements => elements.every(el => getComputedStyle(el).animationName === 'none'))).toBe(true)
})
