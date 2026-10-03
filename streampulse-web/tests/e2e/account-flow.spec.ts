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

test('a prepared device request opens straight to its review, and approval stays a separate decision', async ({ page }, info) => {
  let approvals = 0
  let inspections = 0
  await page.route('**/v1/account/me', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"accountId":"test-account"}' }))
  await page.route('**/v1/account/device-links/inspect', route => {
    inspections++
    expect(route.request().postDataJSON()).toEqual({ code: 'ABCDE12345' })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ label: 'StreamPulse · Chrome on this PC', expiresAt: new Date(Date.now() + 600000).toISOString() }) })
  })
  await page.route('**/v1/account/device-links/approve', route => {
    approvals++
    expect(route.request().postDataJSON()).toEqual({ code: 'ABCDE12345', approve: false })
    return route.fulfill({ status: 204 })
  })
  await page.goto('/account/link-device#code=ABCDE12345')
  // One consent screen: the code was prepared by the extension, so there is no
  // separate review step to find and click.
  await expect(page.getByRole('heading', { name: 'Allow this extension?' })).toBeFocused()
  expect(new URL(page.url()).hash).toBe('')
  await expect(page.getByText('StreamPulse · Chrome on this PC')).toBeVisible()
  await expect(page.getByText('ABCDE-12345', { exact: true })).toBeVisible()
  await expect(page.getByText(/Check that this code matches the code currently shown in your extension/)).toBeVisible()
  expect(approvals).toBe(0)
  expect(inspections).toBe(1)
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
      await expect(confirmationPage.getByRole('heading', { name: 'Confirming your payment', exact: true })).toBeVisible()
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

for (const width of [1440, 390]) {
  test(`extension purchase journey continues through sign-in, one approval, Stripe and a delayed webhook at ${width}px`, async ({ page, context }, info) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width, height: 900 })
    const attempt = '12345678-1234-4234-8234-123456789abc'
    let signedIn = false
    let paid = false
    let attemptReads = 0
    const writes: string[] = []
    const approvals: unknown[] = []
    await context.route('**/v1/account/me', route => signedIn ? route.fulfill({ json: { accountId: '11111111-1111-4111-8111-1111111a1b2c' } }) : route.fulfill({ status: 401, json: { error: 'sign_in_required' } }))
    await context.route('**/v1/account/auth/start', route => route.fulfill({ status: 202, json: { status: 'sent' } }))
    await context.route('**/v1/account/auth/complete', route => { signedIn = true; return route.fulfill({ json: { status: 'signed_in' } }) })
    await context.route('**/v1/account/device-links/inspect', route => route.fulfill({ json: { label: 'StreamPulse extension · Chrome', expiresAt: new Date(Date.now() + 600_000).toISOString() } }))
    await context.route('**/v1/account/device-links/approve', route => { approvals.push(route.request().postDataJSON()); return route.fulfill({ status: 204 }) })
    await context.route('**/v1/billing/checkout', route => {
      writes.push(route.request().method())
      return route.fulfill({ json: { url: 'https://checkout.stripe.com/c/pay/fixture', attemptId: attempt } })
    })
    await context.route(`**/v1/billing/checkout/${attempt}`, route => {
      attemptReads++
      // The webhook lands after a few reads; until then the attempt is open.
      if (attemptReads >= 3) paid = true
      return route.fulfill({ json: { attemptId: attempt, state: paid ? 'active' : 'open' } })
    })
    await context.route('**/v1/billing/supporter', route => route.fulfill({ json: {
      schemaVersion: 1, accountId: '11111111-1111-4111-8111-1111111a1b2c', environment: 'sandbox', revision: 1,
      status: paid ? 'active' : 'none', checkoutEnabled: true, supportPeriods: paid ? 1 : 0,
      accessUntil: paid ? '2026-11-01T12:00:00Z' : undefined,
    } }))
    await context.route('https://checkout.stripe.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Stripe fixture</title><h1>Stripe Checkout fixture</h1>' }))

    // The extension opened this tab with its request prepared.
    await page.goto('/account/link-device#code=ABCDE12345&then=billing')
    await expect(page.getByRole('heading', { name: 'Sign in to connect your extension' })).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await page.getByLabel('Email address').fill('fixture@example.com')
    await page.getByRole('button', { name: 'Send sign-in link' }).click()
    await expect(page.getByTestId('sign-in-waiting')).toBeVisible()
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain('ABCDE12345')
    await page.screenshot({ path: info.outputPath(`journey-1-sign-in-${width}.png`), fullPage: true, animations: 'disabled' })

    // The email link opens a second tab; confirming there continues the first.
    const email = await context.newPage()
    await email.setViewportSize({ width, height: 900 })
    await email.goto('/account/confirm#' + 'a'.repeat(64))
    await email.getByRole('button', { name: 'Confirm sign-in', exact: true }).click()
    await expect(email.getByText(/Go back to the StreamPulse tab where you started/)).toBeVisible()
    await email.screenshot({ path: info.outputPath(`journey-2-confirmed-${width}.png`), fullPage: true, animations: 'disabled' })
    await email.close()

    await page.bringToFront()
    await expect(page.getByRole('heading', { name: 'Allow this extension?' })).toBeVisible()
    await page.screenshot({ path: info.outputPath(`journey-3-consent-${width}.png`), fullPage: true, animations: 'disabled' })
    await page.getByRole('button', { name: 'Approve and continue' }).click()
    expect(approvals).toEqual([{ code: 'ABCDE12345', approve: true }])

    // Straight on to membership, with the progress kept in view.
    await expect(page).toHaveURL(/\/account\/billing$/)
    await expect(page.getByTestId('billing-connected-note')).toBeVisible()
    const checkout = page.getByRole('button', { name: 'Continue to Stripe checkout' })
    await expect(checkout).toBeEnabled()
    await page.screenshot({ path: info.outputPath(`journey-4-checkout-${width}.png`), fullPage: true, animations: 'disabled' })
    await checkout.dblclick()
    await expect(page).toHaveURL('https://checkout.stripe.com/c/pay/fixture')
    expect(writes).toEqual(['POST'])

    // Stripe sends the buyer back before its webhook has been processed.
    await page.goto(`/account/billing/return?attempt=${attempt}`)
    await expect(page.getByRole('heading', { name: 'Confirming your payment' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Stripe checkout|Return to checkout/ })).toHaveCount(0)
    await page.screenshot({ path: info.outputPath(`journey-5-confirming-${width}.png`), fullPage: true, animations: 'disabled' })
    await expect(page.getByRole('heading', { name: 'You’re a Supporter' })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('··1a1b2c', { exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath(`journey-6-supporter-${width}.png`), fullPage: true, animations: 'disabled' })
    expect(writes).toEqual(['POST'])
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  })
}
