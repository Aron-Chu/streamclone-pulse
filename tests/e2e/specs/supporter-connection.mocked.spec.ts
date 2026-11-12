import { test, expect } from '../helpers/testFixtures.ts'

const accountId = '11111111-1111-4111-8111-1111111a1b2c'
const snapshot = (extra: Record<string, unknown>) => ({
  schemaVersion: 1, accountId, environment: 'live', revision: 1, status: 'none',
  checkoutEnabled: true, installationAccountsEnabled: true, accountKind: 'installation',
  serverTime: new Date().toISOString(), accessFrom: new Date(Date.now() - 60_000).toISOString(), accessUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  cacheUntil: new Date(Date.now() + 60_000).toISOString(), supportPeriods: 0, features: {}, ...extra,
})

// One click on Become a Supporter saves the key and reads the server; only an
// open offer goes on to Checkout. 'enrollment-unavailable' is today's prod,
// which has no installation route and answers 404.
for (const scenario of ['checkout-closed', 'installations-closed', 'membership-unavailable', 'enrollment-unavailable'] as const) {
  test(`one click with ${scenario} never starts checkout`, async ({ extension, prepare }, info) => {
    await prepare()
    const calls: string[] = []
    await extension.context.route('https://api.streampulse.stream/v1/account/installations', route => {
      calls.push('installation')
      return route.fulfill(scenario === 'enrollment-unavailable' ? { status: 404, json: { error: 'not_found' } } : { status: 201, json: {
        accountId, deviceId: '22222222-2222-4222-8222-222222222222',
        token: 'a'.repeat(64), refreshToken: 'b'.repeat(64),
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        refreshExpiresAt: new Date(Date.now() + 80 * 86_400_000).toISOString(),
      } })
    })
    await extension.context.route('https://api.streampulse.stream/v1/billing/supporter', route =>
      route.fulfill(scenario === 'membership-unavailable' ? { status: 503, json: { error: 'unavailable' } } : { json: snapshot({
        checkoutEnabled: scenario !== 'checkout-closed', installationAccountsEnabled: scenario !== 'installations-closed',
      }) }))
    await extension.context.route('https://api.streampulse.stream/v1/billing/checkout', route => { calls.push('checkout'); return route.abort() })
    const settings = await extension.context.newPage()
    await settings.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
    const become = settings.getByRole('button', { name: 'Become a Supporter', exact: true })
    await expect(become).toBeVisible()
    await expect(settings.getByRole('button', { name: 'Connect this extension', exact: true })).toHaveCount(0)
    expect(calls).toEqual([])
    await become.click()
    if (scenario === 'membership-unavailable') await expect(settings.locator('[data-journey-state="membership-unknown"]')).toBeVisible()
    else await expect(settings.getByText(scenario === 'installations-closed' ? 'New Supporter sign-ups are temporarily unavailable.' : "Supporter isn't on sale yet", { exact: true })).toBeVisible()
    await expect(settings.getByText(/Could not connect/)).toHaveCount(0)
    await expect(settings.getByRole('button', { name: 'Become a Supporter', exact: true })).toHaveCount(0)
    expect(calls).toEqual(['installation'])
    expect(extension.context.pages().some(page => /^https:\/\/(checkout|billing)\.stripe\.com\//.test(page.url()))).toBe(false)
    await settings.screenshot({ path: info.outputPath(`connection-${scenario}.png`), fullPage: true, animations: 'disabled' })
  })
}
