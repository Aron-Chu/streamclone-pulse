import { test, expect } from '@playwright/test'
import { attachConsoleErrorGuard, assertNoConsoleErrors } from './helpers/assertions'
import { installHubUxMock } from './helpers/hubUxMock'

/**
 * P4-L04 — Channel Screener must not CSS-hide a second full row tree.
 * Desktop mounts the table; compact mounts cards only.
 */
test.describe('live channels matrix single responsive tree', () => {
  test('desktop mounts table rows only', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await installHubUxMock(page)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/analytics')
    const matrix = page.locator('.live-channels-matrix')
    await expect(matrix).toBeVisible()
    const tableRows = matrix.locator('.live-channels-matrix__table tbody tr')
    const cards = matrix.locator('.live-channels-matrix__card')
    const rowCount = await tableRows.count()
    expect(rowCount).toBeGreaterThan(0)
    await expect(cards).toHaveCount(0)
    await assertNoConsoleErrors(page, errors)
  })

  test('compact viewport mounts cards only', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await installHubUxMock(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/analytics')
    const matrix = page.locator('.live-channels-matrix')
    await expect(matrix).toBeVisible()
    const tableRows = matrix.locator('.live-channels-matrix__table tbody tr')
    const cards = matrix.locator('.live-channels-matrix__card')
    const cardCount = await cards.count()
    expect(cardCount).toBeGreaterThan(0)
    await expect(tableRows).toHaveCount(0)
    await expect(matrix.locator('table')).toHaveCount(0)
    await assertNoConsoleErrors(page, errors)
  })
})
