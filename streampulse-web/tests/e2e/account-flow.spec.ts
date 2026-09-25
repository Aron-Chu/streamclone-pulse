import { test, expect } from '@playwright/test'

test.beforeEach(async ({ context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith('/v1/')) return route.fulfill({ status: 503, json: { error: 'fixture_unavailable' } })
    return url.origin === origin ? route.continue() : route.abort()
  })
})

test('email link stays private and requires explicit confirmation', async ({ page }) => {
  let confirmations = 0
  await page.route('**/v1/account/auth/complete', route => {
    confirmations++
    expect(route.request().postDataJSON()).toEqual({ secret: 'a'.repeat(64), confirmed: true })
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"signed_in"}' })
  })
  await page.goto('/account/confirm#' + 'a'.repeat(64))
  await expect(page.getByRole('heading', { name: 'Confirm your sign-in' })).toBeVisible()
  expect(new URL(page.url()).hash).toBe('')
  expect(confirmations).toBe(0)
  expect(await page.locator('body').innerText()).not.toContain('a'.repeat(64))
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain('a'.repeat(64))
  await page.getByRole('button', { name: 'Confirm sign-in', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'You’re signed in' })).toBeVisible()
  expect(confirmations).toBe(1)
})

test('device connection shows the installation before a separate decision', async ({ page }, info) => {
  let approvals = 0
  await page.route('**/v1/account/me', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"accountId":"test-account"}' }))
  await page.route('**/v1/account/device-links/inspect', route => {
    expect(route.request().postDataJSON()).toEqual({ code: 'ABCDE12345' })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ label: 'StreamPulse · Chrome on this PC', expiresAt: new Date(Date.now() + 600000).toISOString() }) })
  })
  await page.route('**/v1/account/device-links/approve', route => {
    approvals++
    expect(route.request().postDataJSON()).toEqual({ code: 'ABCDE12345', approve: false })
    return route.fulfill({ status: 204 })
  })
  await page.goto('/account/link-device')
  await page.getByLabel('Extension code').fill('ABCDE-12345')
  await page.getByRole('button', { name: 'Review extension' }).click()
  await expect(page.getByRole('heading', { name: 'Allow this extension?' })).toBeFocused()
  await expect(page.getByText('StreamPulse · Chrome on this PC')).toBeVisible()
  expect(approvals).toBe(0)
  await page.screenshot({ path: info.outputPath('device-review.png'), fullPage: true })
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  }
  await page.getByRole('button', { name: 'Decline', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Request declined' })).toBeVisible()
  expect(approvals).toBe(1)
})

test('delivery failure does not pretend an email was sent', async ({ page }, info) => {
  await page.route('**/v1/account/auth/start', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"delivery_unavailable"}' }))
  await page.goto('/account/sign-in')
  await page.getByLabel('Email address').fill('fixture@example.com')
  await page.getByRole('button', { name: 'Send sign-in link' }).click()
  await expect(page.getByRole('alert')).toContainText('unavailable')
  await expect(page.getByRole('heading', { name: 'Check your email' })).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('sign-in-unavailable.png'), fullPage: true })
})

test('device approval expires while the review stays open', async ({ page }) => {
  await page.clock.install()
  let approvals = 0
  await page.route('**/v1/account/me', route => route.fulfill({ json: { accountId: 'test-account' } }))
  const expiresAt = await page.evaluate(() => new Date(Date.now() + 60000).toISOString())
  await page.route('**/v1/account/device-links/inspect', route => route.fulfill({ json: { label: 'My extension', expiresAt } }))
  await page.route('**/v1/account/device-links/approve', route => { approvals++; return route.fulfill({ status: 204 }) })
  await page.goto('/account/link-device')
  await page.getByLabel('Extension code').fill('ABCDE-12345')
  await page.getByRole('button', { name: 'Review extension' }).click()
  await expect(page.getByRole('button', { name: 'Approve extension' })).toBeEnabled()
  await page.clock.fastForward(61000)
  await expect(page.getByRole('status')).toContainText('code has expired')
  await expect(page.getByRole('button', { name: 'Approve extension' })).toBeDisabled()
  await page.getByRole('button', { name: 'Use another code' }).click()
  await expect(page.getByLabel('Extension code')).toHaveValue('')
  expect(approvals).toBe(0)
})

for (const returnPath of ['/account/billing', '/account/billing/return?attempt=12345678-1234-4234-8234-123456789abc']) {
  test(`email confirmation in another tab resumes ${returnPath}`, async ({ page, context }) => {
    let signedIn = false
    let emails = 0
    let confirmations = 0
    const billingReads: string[] = []
    await context.route('**/v1/billing/**', route => {
      expect(route.request().method()).toBe('GET')
      const path = new URL(route.request().url()).pathname
      billingReads.push(path)
      return !signedIn
        ? route.fulfill({ status: 401, json: { error: 'unauthorized' } })
        : route.fulfill({ json: path.endsWith('/supporter') ? { schemaVersion: 1, status: 'pending' } : { state: 'pending' } })
    })
    await context.route('**/v1/account/auth/start', route => {
      emails++
      expect(route.request().postDataJSON()).toEqual({ email: 'fixture@example.com' })
      return route.fulfill({ status: 202, json: { status: 'sent' } })
    })
    await context.route('**/v1/account/auth/complete', route => {
      confirmations++
      expect(route.request().postDataJSON()).toEqual({ secret: 'a'.repeat(64), confirmed: true })
      signedIn = true
      return route.fulfill({ json: { status: 'signed_in' } })
    })
    await page.goto(returnPath)
    await page.getByRole('link', { name: 'Sign in to Pulse', exact: true }).click()
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe(returnPath)
    await page.getByLabel('Email address').fill('fixture@example.com')
    await page.getByRole('button', { name: 'Send sign-in link' }).click()
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
    expect(emails).toBe(1)

    const confirmationPage = await context.newPage()
    try {
      await confirmationPage.goto('/account/confirm#' + 'a'.repeat(64))
      await expect(confirmationPage.getByRole('heading', { name: 'Confirm your sign-in' })).toBeVisible()
      expect(new URL(confirmationPage.url()).hash).toBe('')
      expect(confirmations).toBe(0)
      const stored = await confirmationPage.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))
      expect(stored).not.toContain('a'.repeat(64))
      expect(stored).not.toContain('fixture@example.com')
      await confirmationPage.getByRole('button', { name: 'Confirm sign-in', exact: true }).click()
      const continuation = confirmationPage.getByRole('link', { name: 'Continue to billing', exact: true })
      await expect(continuation).toHaveAttribute('href', returnPath)
      expect(confirmations).toBe(1)
      billingReads.length = 0
      await continuation.click()
      await expect(confirmationPage.getByRole('heading', { name: 'Payment pending', exact: true })).toBeVisible()
      expect(new URL(confirmationPage.url()).pathname + new URL(confirmationPage.url()).search).toBe(returnPath)
      expect([...new Set(billingReads)]).toEqual(returnPath.includes('attempt=')
        ? ['/v1/billing/checkout/12345678-1234-4234-8234-123456789abc', '/v1/billing/supporter']
        : ['/v1/billing/supporter'])
      await expect(confirmationPage.getByRole('button', { name: 'Continue to Stripe checkout' })).toHaveCount(0)
      expect(await confirmationPage.evaluate(() => localStorage.getItem('pulse.account.billingReturn.v1'))).toBeNull()
    } finally {
      await confirmationPage.close()
    }
  })
}
