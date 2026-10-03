import { expect, test } from '@playwright/test'

const secret = 'a'.repeat(64) // Test-only one-time link, never a real recovery secret.
test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort()
    if (url.pathname.startsWith('/v1/')) return route.fulfill({ status: 503, json: { error: 'fixture_unavailable' } })
    return route.continue()
  })
})

for (const width of [1440, 390]) {
  for (const cancelled of [false, true]) {
    test(`static ${cancelled ? 'cancelled' : 'returned'} Checkout at ${width}px never reads billing or claims payment`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 })
      const apiRequests: string[] = []
      page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/v1/')) apiRequests.push(request.url()) })
      await page.goto(`/supporter/thanks?attempt=untrusted&success=1${cancelled ? '&cancelled=1' : ''}`)
      await expect(page.getByRole('heading', { name: 'Return to your extension' })).toBeVisible()
      await expect(page.getByText(/Your extension will check its status/)).toBeVisible()
      await expect(page.getByText(/Payment received|nothing was charged|Supporter is active/i)).toHaveCount(0)
      expect(apiRequests).toEqual([])
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`thanks-${cancelled ? 'cancelled' : 'returned'}-${width}.png`), fullPage: true })
    })
  }
  test(`restore strips its secret, identifies the installation and waits for confirmation at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    let approvals = 0
    await page.route('**/v1/account/restores/inspect', route => {
      expect(route.request().method()).toBe('POST')
      expect(route.request().postDataJSON()).toEqual({ secret })
      return route.fulfill({ json: { label: 'Chrome extension', comparisonCode: 'A4C8E2', expiresAt: new Date(Date.now() + 900_000).toISOString() } })
    })
    await page.route('**/v1/account/restores/approve', route => {
      expect(route.request().postDataJSON()).toEqual({ secret, comparisonCode: 'A4C8E2', confirmed: true })
      approvals += 1; return route.fulfill({ status: 204 })
    })
    await page.goto(`/account/restore?ignored=1#${secret}`)
    const confirm = page.getByRole('button', { name: 'Confirm restore' })
    await expect(confirm).toBeVisible()
    expect(page.url()).toMatch(/\/account\/restore$/)
    expect(await page.content()).not.toContain(secret)
    await expect(page.getByText('Chrome extension')).toBeVisible()
    await expect(page.getByText('A4C8E2')).toBeVisible()
    await expect(confirm).toBeDisabled()
    await page.getByRole('checkbox', { name: /code matches the extension/i }).focus()
    await page.keyboard.press('Space')
    await expect(page.getByRole('checkbox', { name: /code matches the extension/i })).toBeChecked()
    await expect(confirm).toBeEnabled()
    expect(approvals).toBe(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const box = await confirm.boundingBox(); expect(box?.height).toBeGreaterThanOrEqual(44)
    await page.screenshot({ path: testInfo.outputPath(`restore-confirm-${width}.png`), fullPage: true })
    await confirm.focus(); await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: 'Restore confirmed' })).toBeVisible()
    expect(approvals).toBe(1)
    await page.screenshot({ path: testInfo.outputPath(`restore-confirmed-${width}.png`), fullPage: true })
  })
  for (const failure of ['expired', 'conflict', 'unavailable'] as const) {
    test(`restore ${failure} has honest recovery copy at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 })
      await page.route('**/v1/account/restores/inspect', route => route.fulfill({
        status: failure === 'expired' ? 401 : failure === 'conflict' ? 409 : 503,
        json: { error: failure === 'expired' ? 'restore_invalid_or_expired' : failure === 'conflict' ? 'restore_conflict' : 'unavailable' },
      }))
      await page.goto(`/account/restore#${secret}`)
      await expect(page.getByRole('heading', { name: failure === 'expired' ? 'This restore link is unavailable' : failure === 'conflict' ? 'These memberships cannot be combined' : 'Restore is unavailable right now' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Confirm restore' })).toHaveCount(0)
      expect(page.url()).toMatch(/\/account\/restore$/)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`restore-${failure}-${width}.png`), fullPage: true })
    })
  }
  test(`lost approval response stays uncertain without a second mutation at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    let approvals = 0
    await page.route('**/v1/account/restores/inspect', route => route.fulfill({ json: { label: 'Chrome extension', comparisonCode: 'A4C8E2', expiresAt: new Date(Date.now() + 900_000).toISOString() } }))
    await page.route('**/v1/account/restores/approve', async route => {
      expect(route.request().postDataJSON()).toEqual({ secret, comparisonCode: 'A4C8E2', confirmed: true })
      approvals += 1
      await route.abort('timedout')
    })
    await page.goto(`/account/restore#${secret}`)
    await page.getByRole('checkbox', { name: /code matches the extension/i }).check()
    await page.getByRole('button', { name: 'Confirm restore' }).click()
    await expect(page.getByRole('heading', { name: 'Check your extension for the result' })).toBeVisible()
    await expect(page.getByText(/confirmation may have completed/i)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0)
    expect(approvals).toBe(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`restore-uncertain-${width}.png`), fullPage: true })
  })
  test(`restore inspect rate limit respects Retry-After at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.clock.install()
    let inspections = 0
    await page.route('**/v1/account/restores/inspect', route => {
      inspections += 1
      return route.fulfill({ status: 429, headers: { 'Retry-After': '5' }, json: { error: 'rate_limited' } })
    })
    await page.goto(`/account/restore#${secret}`)
    const retry = page.getByRole('button', { name: 'Try again' })
    await expect(retry).toBeDisabled()
    await expect(page.getByText('Wait 5 seconds before checking again.')).toBeVisible()
    await page.clock.runFor(5_001)
    await expect(retry).toBeEnabled()
    expect(inspections).toBe(1)
  })
}

test('public Supporter describes extension-first purchase while paid sign-ups stay closed', async ({ page }) => {
  await page.goto('/supporter')
  await expect(page.getByRole('link', { name: 'Get the extension', exact: true })).toBeVisible()
  await expect(page.getByText('Become a Supporter', { exact: true })).toBeVisible()
  await expect(page.getByTestId('prelaunch-notice')).toContainText('Paid sign-ups are not open yet.')
  await expect(page.getByRole('link', { name: 'Use a StreamPulse website account' })).toHaveAttribute('href', '/account/billing')
})
