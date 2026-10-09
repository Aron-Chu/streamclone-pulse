import { test, expect } from '@playwright/test'

test.beforeEach(async ({ context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/v1/account/me') return route.fulfill({ json: { accountId: '11111111-1111-4111-8111-111111111111' } })
    if (url.pathname.startsWith('/v1/')) return route.fulfill({ status: 503, json: { error: 'fixture_unavailable' } })
    return url.origin === origin ? route.continue() : route.abort()
  })
})

test('analytics support navigation at desktop and mobile sizes', async ({ page }, info) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/analytics')
    const menu = page.locator('.analytics-topnav__more')
    const trigger = menu.getByRole('button', { name: 'Support and account', exact: true })
    await trigger.click()
    await expect(menu.getByRole('link', { name: 'Manage subscription' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    await page.screenshot({ path: info.outputPath(`analytics-menu-${width}.png`), animations: 'disabled' })
    await trigger.press('Escape')
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  }
})

for (const width of [1440, 390]) {
  test(`checkout return lookup failures remain uncertain and recover at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    let failingStage = 'attempt'
    let failed = true
    const writes: string[] = []
    page.on('request', request => {
      if (new URL(request.url()).pathname.startsWith('/v1/billing/') && request.method() !== 'GET') writes.push(request.url())
    })
    await page.route('**/v1/billing/checkout/*', route => failed && failingStage === 'attempt'
      ? route.fulfill({ status: 503, json: { error: 'unavailable' } })
      : route.fulfill({ json: { state: 'active' } }))
    await page.route('**/v1/billing/supporter', route => failed && failingStage === 'membership'
      ? route.fulfill({ status: 503, json: { error: 'unavailable' } })
      : route.fulfill({ json: { schemaVersion: 1, status: 'active' } }))
    for (const stage of ['attempt', 'membership']) {
      failingStage = stage
      failed = true
      await page.goto('/account/billing/return?attempt=12345678-1234-4234-8234-123456789abc')
      await expect(page.getByRole('heading', { name: 'Billing status is unavailable right now', exact: true })).toBeVisible()
      await expect(page.getByRole('status')).toContainText('Don’t start another checkout.')
      await expect(page.getByText('No purchase has been started.', { exact: false })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Continue to Stripe checkout', exact: true })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Manage subscription', exact: true })).toHaveCount(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
      failed = false
      await page.getByRole('button', { name: 'Check again', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'You’re a Supporter', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Manage subscription', exact: true })).toBeEnabled()
    }
    expect(writes).toEqual([])
  })

  test(`checkout return errors keep authenticated membership usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const attempts: string[] = []
    await page.route('**/v1/billing/checkout/*', route => {
      attempts.push(new URL(route.request().url()).pathname)
      return route.fulfill({ status: 404, json: { error: 'not_found' } })
    })
    await page.route('**/v1/billing/supporter', route => route.fulfill({ json: { schemaVersion: 1, status: 'active' } }))
    for (const attempt of ['invalid', '12345678-1234-4234-8234-123456789abc']) {
      await page.goto(`/account/billing/return?attempt=${attempt}`)
      await expect(page.getByRole('heading', { name: 'Supporter active', exact: true })).toBeVisible()
      await expect(page.getByRole('status')).toContainText(attempt === 'invalid'
        ? 'This checkout link is invalid.' : 'This checkout link is no longer available.')
      await expect(page.getByRole('button', { name: 'Manage subscription', exact: true })).toBeEnabled()
      await expect(page.getByRole('button', { name: 'Continue to Stripe checkout', exact: true })).toHaveCount(0)
      // Development StrictMode may repeat this read. The contract is that
      // invalid IDs never reach the API and valid reads target only that ID.
      if (attempt === 'invalid') expect(attempts).toEqual([])
      else {
        expect(attempts.length).toBeGreaterThan(0)
        expect(new Set(attempts)).toEqual(new Set([`/v1/billing/checkout/${attempt}`]))
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    }
  })

  test(`billing states render their actual membership and controls at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 })
    let state = 'none'
    let checkoutEnabled: boolean | undefined = true
    await page.route('**/v1/billing/supporter', route => route.fulfill({ json: { schemaVersion: 1, status: state, checkoutEnabled, supportPeriods: 2, accessUntil: '2026-10-19T00:00:00Z' } }))
    const headings = {
      none: 'Become a Pulse Supporter',
      pending: 'Confirming your payment',
      active: 'Supporter active',
      grace: 'Payment needs attention',
      expired: 'Supporter ended',
      review: 'Membership needs review',
    }
    for (const [status, heading] of Object.entries(headings)) {
      state = status
      await page.goto('/account/billing')
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
      // Routine states keep a quiet recovery refresh; a payment being confirmed refreshes itself.
      if (status === 'pending') await expect(page.getByRole('button', { name: 'Refresh status' })).toHaveCount(0)
      else await expect(page.getByRole('button', { name: 'Refresh status' })).toBeEnabled()
      const portal = page.getByRole('button', { name: status === 'grace' ? 'Update payment method' : status === 'expired' ? 'Billing history' : 'Manage subscription', exact: true })
      if (status === 'none') await expect(page.getByRole('button', { name: 'Manage subscription', exact: true })).toHaveCount(0)
      else await expect(portal).toBeEnabled()
      await expect(page.getByRole('link', { name: 'Tester sign-in', exact: true })).toHaveCount(0)
      const checkout = page.getByRole('button', { name: status === 'expired' ? 'Rejoin Supporter' : 'Continue to Stripe checkout', exact: true })
      if (['none', 'expired'].includes(status)) await expect(checkout).toBeEnabled()
      else await expect(page.getByRole('button', { name: /Stripe checkout|Rejoin/ })).toHaveCount(0)
      await expect(page.getByText('Access through', { exact: true })).toHaveCount(status === 'active' ? 1 : 0)
      await expect(page.getByText('Access until', { exact: true })).toHaveCount(status === 'grace' ? 1 : 0)
      await page.screenshot({ path: info.outputPath(`billing-${state}-${width}.png`), fullPage: true, animations: 'disabled' })
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    }
    for (const enabled of [false, undefined]) {
      checkoutEnabled = enabled
      for (const status of ['none', 'expired', 'active']) {
        state = status
        await page.goto('/account/billing')
        await expect(page.getByRole('heading', { name: status === 'none' ? 'Supporter sign-ups are not open yet' : headings[status as keyof typeof headings], exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: /Stripe checkout|Rejoin/ })).toHaveCount(0)
        if (status !== 'none') await expect(page.getByRole('button', { name: status === 'expired' ? 'Billing history' : 'Manage subscription', exact: true })).toBeEnabled()
        if (status !== 'active') await expect(page.getByText('New Supporter sign-ups are not open yet.', { exact: false })).toBeVisible()
      }
    }
    // No environment in the snapshot proves nothing, so no test-mode banner.
    await expect(page.getByTestId('billing-sandbox-banner')).toHaveCount(0)
    await page.unroute('**/v1/billing/supporter')
    await page.route('**/v1/billing/supporter', route => route.fulfill({ json: { schemaVersion: 1, status: 'none', checkoutEnabled: true, environment: 'sandbox' } }))
    await page.goto('/account/billing')
    await expect(page.getByTestId('billing-sandbox-banner')).toContainText('Sandbox — test mode, no real charge.')
    await expect(page.getByRole('button', { name: 'Continue to Stripe checkout', exact: true })).toBeEnabled()
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    await page.screenshot({ path: info.outputPath(`billing-sandbox-${width}.png`), fullPage: true, animations: 'disabled' })
    await page.unroute('**/v1/billing/supporter')
    await page.route('**/v1/billing/supporter', route => route.fulfill({ status: 503, json: { error: 'unavailable' } }))
    await page.goto('/account/billing')
    await expect(page.getByRole('heading', { name: 'Billing status is unavailable right now', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Check again' })).toBeEnabled()
    await expect(page.getByRole('button', { name: /checkout/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Manage subscription', exact: true })).toHaveCount(0)
    await page.screenshot({ path: info.outputPath(`billing-unavailable-${width}.png`), fullPage: true })
  })
}
