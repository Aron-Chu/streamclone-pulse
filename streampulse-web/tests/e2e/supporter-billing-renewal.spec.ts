import { test, expect } from '@playwright/test'

// Backend #162 renewal fields on GET /v1/billing/supporter (schemaVersion 1).
const ON = '2026-11-01T17:00:00Z'
const ACTIVE = { schemaVersion: 1, status: 'active', checkoutEnabled: false, supportPeriods: 1, accessUntil: ON }

test.beforeEach(async ({ context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/v1/account/me') return route.fulfill({ json: { accountId: '11111111-1111-4111-8111-111111111111' } })
    if (url.pathname.startsWith('/v1/')) return route.fulfill({ status: 503, json: { error: 'fixture_unavailable' } })
    return url.origin === origin ? route.continue() : route.abort()
  })
})

for (const width of [1440, 390]) {
  test(`billing shows one renewal line from the snapshot at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 })
    let snapshot: Record<string, unknown> = ACTIVE
    await page.route('**/v1/billing/supporter', route => route.fulfill({ json: snapshot }))
    const cases: Array<[string, Record<string, unknown>, string | null]> = [
      ['cancelled', { renewal: 'ends', endsOn: ON }, 'Cancels on'],
      ['renewing', { renewal: 'auto', renewsOn: ON }, 'Renews on'],
      ['old-backend', {}, null],
    ]
    for (const [name, extra, prefix] of cases) {
      snapshot = { ...ACTIVE, ...extra }
      await page.goto('/account/billing')
      await expect(page.getByRole('heading', { name: 'Supporter active', exact: true })).toBeVisible()
      const line = page.getByTestId('billing-renewal')
      if (prefix) {
        const date = await page.evaluate(on => new Date(on).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }), ON)
        await expect(line).toHaveText(`${prefix} ${date}`)
      } else {
        await expect(line).toHaveCount(0)
      }
      await expect(page.getByText('Access through', { exact: true })).toHaveCount(1)
      await expect(page.getByRole('button', { name: 'Manage subscription', exact: true })).toBeEnabled()
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
      await page.screenshot({ path: info.outputPath(`billing-renewal-${name}-${width}.png`), fullPage: true, animations: 'disabled' })
    }
  })
}
