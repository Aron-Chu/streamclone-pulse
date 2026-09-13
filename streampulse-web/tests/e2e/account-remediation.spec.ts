import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith('/v1/')) {
      if (url.pathname === '/v1/account/me') return route.fulfill({ json: { accountId: '11111111-1111-4111-8111-111111111111' } })
      if (url.pathname === '/v1/account/devices') return route.fulfill({ json: { devices: [{ id: '22222222-2222-4222-8222-222222222222', label: 'Desktop extension', expiresAt: '2027-01-01T00:00:00Z' }] } })
      return route.fulfill({ status: 503, json: { error: 'fixture_unavailable' } })
    }
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort()
    return route.continue()
  })
})

for (const width of [320, 390, 1440]) {
  test(`built Docs and account fit ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/docs')
    await page.getByText('Developer reference', { exact: true }).click()
    await expect(page.locator('.public-api-reference')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`docs-${width}.png`), fullPage: true })
    await page.goto('/account/settings')
    await expect(page.getByRole('heading', { name: 'Account & devices' })).toBeVisible()
    await expect(page.getByText('Desktop extension', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Revoke Desktop extension' }).click()
    await page.getByRole('button', { name: 'Confirm revocation' }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Confirm revocation' })).toBeEnabled()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`account-${width}.png`), fullPage: true })
  })
}

test('built account/legal routes render without granting payment on return', async ({ page }) => {
  for (const path of ['/account/sign-in', '/account/confirm', '/account/link-device', '/account/billing', '/account/billing/return?success=true', '/terms', '/refunds', '/privacy']) {
    await page.goto(path)
    await expect(page.locator('h1')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Page not found' })).toHaveCount(0)
  }
})

test('account controls revoke the selected device and end the website session', async ({ page }) => {
  let revoked = false
  let loggedOut = false
  await page.route('**/v1/account/devices', route => route.fulfill({ json: { devices: [{ id: '22222222-2222-4222-8222-222222222222', label: 'Desktop extension', expiresAt: '2027-01-01T00:00:00Z', ...(revoked ? { revokedAt: '2026-09-13T00:00:00Z' } : {}) }] } }))
  await page.route('**/v1/account/devices/revoke', route => {
    expect(route.request().postDataJSON()).toEqual({ deviceId: '22222222-2222-4222-8222-222222222222' })
    revoked = true
    return route.fulfill({ status: 204 })
  })
  await page.route('**/v1/account/auth/logout', route => {
    expect(route.request().method()).toBe('POST')
    loggedOut = true
    return route.fulfill({ status: 204 })
  })
  await page.goto('/account/settings')
  await page.getByRole('button', { name: 'Revoke Desktop extension' }).click()
  expect(revoked).toBe(false)
  await page.getByRole('button', { name: 'Confirm revocation' }).click()
  await expect(page.getByText('Revoked', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Sign in to Pulse' })).toBeVisible()
  expect(loggedOut).toBe(true)
  await expect(page.getByText('Desktop extension', { exact: true })).toHaveCount(0)
})
