import { test, expect } from '../helpers/testFixtures.ts'

const accountId = '11111111-1111-4111-8111-1111111a1b2c'
const snapshot = (extra: Record<string, unknown>) => ({
  schemaVersion: 1, accountId, environment: 'live', revision: 1, status: 'none',
  checkoutEnabled: true, installationAccountsEnabled: true, accountKind: 'installation',
  serverTime: new Date().toISOString(), accessFrom: new Date(Date.now() - 60_000).toISOString(), accessUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  cacheUntil: new Date(Date.now() + 60_000).toISOString(), supportPeriods: 0, features: {}, ...extra,
})

for (const scenario of ['checkout-closed', 'installations-closed', 'membership-unavailable', 'enrollment-unavailable'] as const) {
  test(`nonpaid connection keeps ${scenario} from starting checkout`, async ({ extension, prepare }, info) => {
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
    const connect = settings.getByRole('button', { name: 'Connect this extension', exact: true })
    await expect(connect).toBeVisible()
    expect(calls).toEqual([])
    await expect(settings.getByRole('button', { name: 'Become a Supporter', exact: true })).toHaveCount(0)
    await connect.click()
    if (scenario === 'enrollment-unavailable') await expect(settings.getByText('Could not connect. Try again when the service is available.', { exact: true })).toBeVisible()
    else if (scenario === 'membership-unavailable') await expect(settings.locator('[data-journey-state="membership-unknown"]')).toBeVisible()
    else await expect(settings.getByText(scenario === 'checkout-closed' ? "Supporter isn't on sale yet" : 'New Supporter sign-ups are temporarily unavailable.', { exact: true })).toBeVisible()
    await expect(settings.getByRole('button', { name: 'Become a Supporter', exact: true })).toHaveCount(0)
    expect(calls).toEqual(['installation'])
    expect(extension.context.pages().some(page => /^https:\/\/(checkout|billing)\.stripe\.com\//.test(page.url()))).toBe(false)
    await settings.screenshot({ path: info.outputPath(`connection-${scenario}.png`), fullPage: true, animations: 'disabled' })
  })
}
