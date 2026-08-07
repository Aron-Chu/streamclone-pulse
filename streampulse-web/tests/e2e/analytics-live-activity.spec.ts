import { test, expect } from '@playwright/test'
import {
  attachConsoleErrorGuard,
  assertNoConsoleErrors,
} from './helpers/assertions'
import { installHubUxMock } from './helpers/hubUxMock'

test.describe('analytics hub Live Activity', () => {
  test('renders Live Activity distinct from Signal Wire with one moment inspector', async ({
    page,
  }) => {
    const errors = attachConsoleErrorGuard(page)
    await installHubUxMock(page)
    await page.goto('/analytics')

    await expect(page.getByTestId('live-activity')).toBeVisible()
    await expect(
      page.getByTestId('live-activity').getByRole('heading', { name: 'Live Activity' }),
    ).toBeVisible()
    await expect(page.getByTestId('coverage-diagnostic')).toBeVisible()
    await expect(page.getByTestId('live-activity-filter-all')).toBeVisible()
    await expect(page.getByTestId('live-activity-row').first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Confirmed start').first()).toBeVisible()

    await expect(page.locator('#section-signal-wire')).toBeVisible()
    await expect(page.locator('#section-signal-wire .hub-live-wire__title')).toContainText(
      'Signal Wire',
    )
    await expect(page.getByRole('heading', { name: 'Network activity' })).toBeVisible()

    await expect(page.getByTestId('pool-wire')).toHaveCount(0)
    await expect(page.getByText(/POOL\s+Stable/i)).toHaveCount(0)
    await expect(page.locator('[data-testid="figma-moment-inspector"]')).toHaveCount(1)

    await page.getByTestId('live-activity-filter-went-offline').click()
    await expect(page.getByTestId('live-activity-empty')).toBeVisible()

    await assertNoConsoleErrors(page, errors)
  })

  test('shows unavailable without falling back to Pool Wire', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await installHubUxMock(page)
    await page.unroute(/\/v1\/portal\/analytics\/live-activity(\?.*)?$/)
    await page.route(/\/v1\/portal\/analytics\/live-activity(\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'store_unavailable' }),
      })
    })
    await page.goto('/analytics')
    await expect(page.getByTestId('live-activity-unavailable')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('pool-wire')).toHaveCount(0)
    await expect(page.getByText(/POOL\s+Stable/i)).toHaveCount(0)
    // Browser logs the intentional 503; still assert no unexpected JS exceptions.
    const unexpected = errors.filter(
      (line) => !/503|Service Unavailable|store_unavailable/i.test(line),
    )
    expect(unexpected, unexpected.join('\n')).toEqual([])
  })

  test('portal-read gate off omits Live Activity panel without Pool Wire fallback', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await installHubUxMock(page)
    await page.addInitScript(() => {
      window.sessionStorage.setItem('sp.liveActivityPortalRead', 'false')
    })
    await page.goto('/analytics')
    await expect(page.getByTestId('live-activity')).toHaveCount(0)
    await expect(page.getByTestId('pool-wire')).toHaveCount(0)
    await expect(page.getByText(/POOL\s+Stable/i)).toHaveCount(0)
    await expect(page.locator('#section-signal-wire')).toBeVisible()
    await expect(page.locator('[data-testid="figma-moment-inspector"]')).toHaveCount(1)
    await assertNoConsoleErrors(page, errors)
  })
})
