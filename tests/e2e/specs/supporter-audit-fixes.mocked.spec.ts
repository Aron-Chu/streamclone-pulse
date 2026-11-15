import { test, expect } from '../helpers/testFixtures.ts'

const ACCOUNT = '11111111-1111-4111-8111-1111111a1b2c'
const ATTEMPT = '33333333-3333-4333-8333-333333333333'
const API = 'https://api.streampulse.stream'
const credentials = () => ({ accountId: ACCOUNT, deviceId: '22222222-2222-4222-8222-222222222222', token: 'a'.repeat(64), refreshToken: 'b'.repeat(64), expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), refreshExpiresAt: new Date(Date.now() + 80 * 86_400_000).toISOString() })
const membership = (status: string) => ({ schemaVersion: 1, accountId: ACCOUNT, environment: 'live', revision: 2, status, accountKind: 'installation', checkoutEnabled: true, installationAccountsEnabled: true, restoreEligible: false, serverTime: new Date().toISOString(), cacheUntil: new Date(Date.now() + 60_000).toISOString(), features: status === 'active' ? { 'supporter.banner.v1': true, 'supporter.finish.v1': true } : {}, accessFrom: new Date(Date.now() - 60_000).toISOString(), accessUntil: new Date(Date.now() + 86_400_000).toISOString(), supportPeriods: 2, cosmetics: { enabled: false, finish: 'glass' } })

test('a refused checkout says nothing was charged and a deliberate retry opens the recovered flow', async ({ extension, prepare }) => {
  await prepare()
  let creates = 0
  await extension.context.route(`${API}/v1/account/installations`, route => route.fulfill({ status: 201, json: credentials() }))
  await extension.context.route(`${API}/v1/billing/supporter`, route => route.fulfill({ json: membership('none') }))
  await extension.context.route(`${API}/v1/billing/checkout`, route => {
    creates++
    return route.fulfill({ status: creates === 1 ? 503 : 200, json: creates === 1
      ? { error: 'billing_unavailable', attemptId: ATTEMPT, expiresAt: new Date(Date.now() + 23 * 3_600_000).toISOString() }
      : { attemptId: '55555555-5555-4555-8555-555555555555', url: 'https://checkout.stripe.com/c/pay/fixture', expiresAt: new Date(Date.now() + 23 * 3_600_000).toISOString() } })
  })
  await extension.context.route(`${API}/v1/billing/checkout/${ATTEMPT}`, route => route.fulfill({ json: { attemptId: ATTEMPT, state: 'failed' } }))
  const page = extension.page
  await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
  await page.getByRole('button', { name: 'Become a Supporter', exact: true }).click()
  const journey = page.locator('[data-journey-state="checkout-not-opened"]')
  await expect(journey).toContainText("Checkout didn't open. Nothing was charged.")
  await expect(journey).not.toContainText('Do not pay again')
  expect(creates).toBe(1)
  await journey.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.locator('[data-journey-state="stripe-open"]')).toBeVisible()
  expect(creates).toBe(2)
})

for (const explicit of [false, true]) test(`a weeks-old completed checkout clears on ${explicit ? 'Check payment status' : 'automatic read'}`, async ({ extension, prepare }) => {
  await prepare()
  let reads = 0, creates = 0
  await extension.context.route(`${API}/v1/billing/supporter`, route => route.fulfill({ json: membership('expired') }))
  await extension.context.route(`${API}/v1/billing/checkout`, route => { creates++; return route.fulfill({ status: 500, json: {} }) })
  await extension.context.route(`${API}/v1/billing/checkout/${ATTEMPT}`, route => { reads++; return route.fulfill({ json: { attemptId: ATTEMPT, state: 'active', expiresAt: new Date(Date.now() - 17 * 86_400_000).toISOString() } }) })
  await extension.serviceWorker.evaluate(async ({ account, attemptId, explicit, origin }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('pulse-account-private-v1', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('account', 'readwrite'), store = tx.objectStore('account')
        store.put({ kind: 'linked', ...account, installation: true }, origin)
        store.put({ billing: { accountId: account.accountId, attemptId, phase: 'confirming', url: 'https://checkout.stripe.com/c/pay/historical', until: Date.now() - 17 * 86_400_000, watchUntil: Date.now() - 18 * 86_400_000, nextPoll: Date.now() + (explicit ? 600_000 : -60_000) } }, 'supporter-pay-first')
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error)
      })
    } finally { db.close() }
  }, { account: credentials(), attemptId: ATTEMPT, explicit, origin: API })
  const page = extension.page
  await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
  if (explicit) {
    await expect(page.locator('.pulse-supporter-card-who')).toContainText('payment pending')
    await page.getByRole('button', { name: 'Check payment status', exact: true }).click()
  }
  await expect(page.locator('.pulse-supporter-card-who')).toContainText('Supporter ended')
  await expect(page.getByRole('button', { name: 'Become a Supporter', exact: true })).toBeVisible()
  await expect(page.getByText('Still confirming your payment', { exact: true })).toHaveCount(0)
  expect(reads).toBe(1)
  expect(creates).toBe(0)
})

test('the current crest, equipped name, selected control and header emotes remain accessible', async ({ extension, prepare }) => {
  await prepare()
  await extension.context.route(`${API}/v1/account/installations`, route => route.fulfill({ status: 201, json: credentials() }))
  await extension.context.route(`${API}/v1/billing/supporter`, route => route.fulfill({ json: membership('active') }))
  const page = extension.page
  await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'SUPPORTER_BILLING', action: 'connect' }))
  await page.reload()
  await expect(page.getByText('Your crest', { exact: true })).toBeVisible()
  await expect(page.getByText('Preview Supporter looks', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('radio', { name: 'Default · Equipped', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Default active', exact: true })).toHaveCount(0)
  const off = page.getByRole('group', { name: 'Emote rain', exact: true }).getByRole('button', { name: 'Off', exact: true })
  await off.click()
  await expect(off).toHaveCSS('outline-style', 'solid')
  await expect(off).toHaveCSS('outline-color', 'rgb(250, 250, 252)')
  const positions = await page.locator('.pulse-supporter-card-banner').evaluate(header => {
    const bounds = header.getBoundingClientRect(), samples: boolean[] = []
    for (const progress of [0, .25, .5, .75, .99]) {
      for (const image of header.querySelectorAll('img')) {
        for (const animation of image.getAnimations()) { animation.pause(); animation.currentTime = Number(animation.effect?.getTiming().duration) * progress }
        const box = image.getBoundingClientRect()
        samples.push(box.top >= bounds.top && box.bottom <= bounds.bottom)
      }
    }
    return samples
  })
  expect(positions.length).toBeGreaterThan(0)
  expect(positions.every(Boolean)).toBe(true)
})
