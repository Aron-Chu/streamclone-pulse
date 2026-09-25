import { expect, test } from '@playwright/test'

import { attachConsoleErrorGuard, assertNoConsoleErrors } from './helpers/assertions'
import { installHubUxMock } from './helpers/hubUxMock'

test.beforeEach(async ({ page }) => {
  // The CI preview points at the hosted API by default. Keep this workflow
  // entirely deterministic and fail closed if a new endpoint is introduced.
  await page.route('**/v1/**', route => route.fulfill({ status: 503, json: { error: 'unmocked_endpoint' } }))
  await installHubUxMock(page)
  await page.route(/\/v1\/channels\/[^/?]+$/, route => {
    const login = new URL(route.request().url()).pathname.split('/').pop()
    return route.fulfill({ json: { login } })
  })
})

test('Live Wire selects an exact measured moment on the graph without changing routes', async ({ page }) => {
  const errors = attachConsoleErrorGuard(page)
  await page.goto('/analytics')

  const wire = page.getByRole('region', { name: 'Live Wire' })
  const event = wire.locator('[data-public-moment-id="public-xqc-1"]')
  await expect(event).toContainText('xQc')
  const before = page.url()
  await event.getByRole('button', { name: /^Show .* on chart$/ }).click()

  const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
  await expect(chart).toHaveAttribute('data-selected', 'true')
  await expect(page.locator('.analytics-discovery-layout__chart .figma-global-activity__inspector')).toBeVisible()
  await expect(wire).toBeVisible()
  expect(page.url()).toBe(before)
  await assertNoConsoleErrors(page, errors)
})

test('a Live Wire save remains available in Pulse Moments after navigation and reload', async ({ page }) => {
  const errors = attachConsoleErrorGuard(page)
  await page.goto('/analytics')

  const event = page.getByRole('region', { name: 'Live Wire' }).locator('[data-public-moment-id="public-xqc-1"]')
  await event.getByRole('button', { name: /^Save / }).click()
  await expect(event.getByRole('button', { name: /^Remove saved / })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('link', { name: 'Browse all moments & saved →' }).click()

  await expect(page).toHaveURL(/\/analytics\/moments$/)
  const saved = page.getByRole('tab', { name: 'Saved (1)', exact: true })
  await saved.click()
  await expect(page.locator('.moments-result').filter({ hasText: 'xQc' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('tab', { name: 'Saved (1)', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.moments-result').filter({ hasText: 'xQc' })).toBeVisible()
  await assertNoConsoleErrors(page, errors)
})
