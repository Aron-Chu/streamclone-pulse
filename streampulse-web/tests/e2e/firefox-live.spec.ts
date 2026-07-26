import { test, expect } from '@playwright/test'
import { seedBetaKey } from './helpers/auth'

/**
 * @firefox LIVE (un-mocked) capture against whatever backend the dev server
 * points at. Used for auditing real behaviour / graceful degradation when the
 * hub endpoint is not yet served. Screenshots go to firefox-review/live-*.
 */
test.describe('@firefox live portal capture', () => {
  test.beforeEach(async ({ page }) => {
    await seedBetaKey(page)
    await page.emulateMedia({ reducedMotion: 'reduce' })
  })

  test('landing (live)', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(1200)
    await page.screenshot({ path: 'firefox-review/live-landing.png', fullPage: true })
  })

  test('analytics hub home (live)', async ({ page }) => {
    await page.goto('/analytics')
    await expect(page.getByRole('searchbox').first()).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(1500)
    await page.screenshot({ path: 'firefox-review/live-analytics-hub.png', fullPage: true })
  })

  test('streams directory (live)', async ({ page }) => {
    await page.goto('/analytics/streams')
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(1500)
    await page.screenshot({ path: 'firefox-review/live-streams-directory.png', fullPage: true })
  })
})
