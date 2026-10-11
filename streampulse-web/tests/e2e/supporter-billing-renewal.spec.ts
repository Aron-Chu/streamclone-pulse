import { test, expect } from '@playwright/test'

// Backend #162 renewal fields on GET /v1/billing/supporter (schemaVersion 1).
// The launch page shows them as its own view (spec §3.5): "Supporter ends
// {date}" after a cancel, a Renews fact while renewing. #78's one-line note
// must not appear on top of that here.
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
  test(`billing renewal state follows the snapshot at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 })
    let snapshot: Record<string, unknown> = ACTIVE
    await page.route('**/v1/billing/supporter', route => route.fulfill({ json: snapshot }))
    const date = async () => page.evaluate(on => new Date(on).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' }), ON)
    for (const name of ['cancelled', 'renewing', 'no-renewal', 'old-backend']) {
      snapshot = name === 'cancelled' ? { ...ACTIVE, renewal: 'ends', endsOn: ON } : name === 'renewing' ? { ...ACTIVE, renewal: 'auto', renewsOn: ON } : name === 'no-renewal' ? { ...ACTIVE, renewal: 'none' } : ACTIVE
      await page.goto('/account/billing')
      if (name === 'cancelled') {
        await expect(page.getByRole('heading', { name: `Supporter ends ${await date()}`, exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeEnabled()
      } else {
        await expect(page.getByRole('heading', { name: 'Supporter active', exact: true })).toBeVisible()
        await expect(page.getByText(name === 'renewing' ? 'Renews' : 'Access through', { exact: true })).toHaveCount(1)
      }
      await expect(page.getByTestId('billing-renewal')).toHaveCount(0)
      await expect(page.getByText(/Cancels on|Renews on/)).toHaveCount(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
      await page.screenshot({ path: info.outputPath(`billing-renewal-${name}-${width}.png`), fullPage: true, animations: 'disabled' })
    }
  })
}
