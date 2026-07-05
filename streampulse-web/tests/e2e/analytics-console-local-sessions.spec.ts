import { test, expect } from '@playwright/test'
import { attachConsoleErrorGuard, assertNoConsoleErrors } from './helpers/assertions'

const LOGIN = process.env.ANALYTICS_E2E_LOGIN?.trim() || 'jynxzi'
const DATE_SLUGS = (process.env.ANALYTICS_E2E_DATE_SLUGS ?? '2026-06-09,2026-06-30,2026-07-03')
  .split(',')
  .map((slug) => slug.trim())
  .filter(Boolean)

const LOCAL_BACKEND =
  process.env.VITE_BACKEND_URL?.includes('8090') ||
  process.env.PLAYWRIGHT_LOCAL_ANALYTICS === '1'

test.describe('analytics console local sessions', () => {
  test.beforeEach(({ page: _page }, testInfo) => {
    test.skip(!LOCAL_BACKEND, 'Set VITE_BACKEND_URL=http://127.0.0.1:8090 or PLAYWRIGHT_LOCAL_ANALYTICS=1')
    testInfo.setTimeout(120_000)
  })

  test('live channel route mounts without console errors', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    const consoleRoot = page.locator('.sc-analytics-console')

    await page.goto(`/analytics/${LOGIN}`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('main', { name: new RegExp(`Analytics for ${LOGIN}`, 'i') }).waitFor({
      state: 'visible',
      timeout: 60_000,
    })
    await consoleRoot.waitFor({ state: 'visible', timeout: 30_000 })
    await expect(consoleRoot.getByText('Streams', { exact: true })).toBeVisible()
    await expect(consoleRoot.getByText('Live / Current')).toBeVisible()

    await assertNoConsoleErrors(page, errors)
  })

  for (const dateSlug of DATE_SLUGS) {
    test(`historical date slug ${dateSlug} loads without crash`, async ({ page }) => {
      const errors = attachConsoleErrorGuard(page)
      const consoleRoot = page.locator('.sc-analytics-console')
      const path = `/analytics/${LOGIN}/${dateSlug}`

      await page.goto(path, { waitUntil: 'domcontentloaded' })
      await page.getByRole('main', { name: new RegExp(`Analytics for ${LOGIN}`, 'i') }).waitFor({
        state: 'visible',
        timeout: 60_000,
      })
      await consoleRoot.waitFor({ state: 'visible', timeout: 30_000 })

      const sessionNotFound = consoleRoot.getByText(/Session not found/i)
      const chartOrBanner = consoleRoot.locator('svg, [role="status"]')
      await expect(sessionNotFound.or(chartOrBanner.first())).toBeVisible({ timeout: 45_000 })

      await assertNoConsoleErrors(page, errors)
    })
  }
})
