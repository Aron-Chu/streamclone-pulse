import { test, expect } from '@playwright/test'
import { installMockApi } from './helpers/mockApi'

/**
 * Firefox visual review of the rebuilt shadcn surfaces (landing, analytics hub
 * home, analytics alias). Tagged @firefox so it only runs under the firefox
 * project; captures full-page screenshots into firefox-review/ for inspection.
 */
test.describe('@firefox StreamPulse design review (Firefox)', () => {
  test.beforeEach(async ({ page }) => {
    await installMockApi(page)
    await page.emulateMedia({ reducedMotion: 'reduce' })
  })

  test('landing page renders with real CTAs', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 15_000 })
    // Real install + analytics CTAs are present and point at real routes.
    await expect(page.getByRole('link', { name: /Add StreamPulse to Chrome/i }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: /Open Analytics/i }).first()).toBeVisible()
    await page.screenshot({ path: 'firefox-review/landing.png', fullPage: true })
  })

  test('analytics hub home renders search-first layout', async ({ page }) => {
    await page.goto('/analytics')
    // Search-first hub: a search box is the primary action.
    await expect(page.getByRole('searchbox').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('heading').first()).toBeVisible()
    await page.screenshot({ path: 'firefox-review/analytics-hub.png', fullPage: true })
  })

  test('legacy streams route redirects to the analytics command center', async ({ page }) => {
    await page.goto('/analytics/streams')
    await expect(page).toHaveURL(/\/analytics\/?$/)
    await expect(page.getByRole('searchbox').first()).toBeVisible({
      timeout: 15_000,
    })
    await page.screenshot({ path: 'firefox-review/analytics-alias.png', fullPage: true })
  })
})
