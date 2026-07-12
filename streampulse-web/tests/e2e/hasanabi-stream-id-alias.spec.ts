import { expect, test } from '@playwright/test'

test.describe('hasanabi stream-id alias honesty', () => {
  test.use({ viewport: { width: 1440, height: 1000 } })

  test('2026-07-12 date slug shows Stream Recap / Pulse Moments after canonical match', async ({ page }) => {
    await page.goto('/analytics/hasanabi/2026-07-12', { waitUntil: 'domcontentloaded' })
    const consoleRoot = page.locator('.sc-analytics-console')
    await consoleRoot.waitFor({ state: 'visible', timeout: 60_000 })
    await expect(consoleRoot.getByText('Stream Recap', { exact: true })).toBeVisible({ timeout: 45_000 })
    await expect(consoleRoot.getByText('Pulse Moments', { exact: true })).toBeVisible()
    await expect(consoleRoot.getByText('Top Moments', { exact: true })).toHaveCount(0)
    await expect(page.locator('.session-signal-tape')).toBeVisible()
  })

  test('2026-07-11 keeps Stream Recap / Pulse Moments and tape', async ({ page }) => {
    await page.goto('/analytics/hasanabi/2026-07-11', { waitUntil: 'domcontentloaded' })
    const consoleRoot = page.locator('.sc-analytics-console')
    await consoleRoot.waitFor({ state: 'visible', timeout: 60_000 })
    await expect(consoleRoot.getByText('Stream Recap', { exact: true })).toBeVisible({ timeout: 45_000 })
    await expect(consoleRoot.getByText('Pulse Moments', { exact: true })).toBeVisible()
    await expect(page.locator('.session-signal-tape')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Session signals' })).toContainText(/coverage/i)
  })
})
