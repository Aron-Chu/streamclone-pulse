import { test, expect } from '../helpers/testFixtures.ts'
import type { Page, Worker } from '@playwright/test'

/**
 * Packaged proof of the one sales switch (supporter launch spec §2.5) and the
 * shorter journey from the extension (§3.6), with fixture APIs only.
 *
 *   - Every build: while GET /v1/billing/offer says closed, settings says "not
 *     open yet", the banner chip says "Coming soon", and no control can reach
 *     POST /v1/billing/checkout. Flipping the server answer opens the offer
 *     without a client release (the worker's cache is cleared here instead of
 *     waiting out its minute).
 *   - Twitch sign-in off: open sales point at streampulse.stream; nothing is
 *     bought in the extension.
 *   - `public` builds (PULSE_EXTENSION_TWITCH_SIGNIN=public): a signed-in
 *     Twitch account goes Become a Supporter → one-screen review → Continue to
 *     payment → Stripe stand-in tab → welcome, and a cancelled membership shows
 *     when it ends with Resume.
 *
 * The offer read carries no cookie and no bearer. Nothing here talks to Stripe:
 * the Checkout URL is a fixture and real provider destinations are
 * resolver-blocked by the harness.
 */
const STAGE = process.env.PULSE_EXTENSION_TWITCH_SIGNIN === 'tester' || process.env.PULSE_EXTENSION_TWITCH_SIGNIN === 'public'
  ? process.env.PULSE_EXTENSION_TWITCH_SIGNIN : 'off'
const API = 'https://api.streampulse.stream'
const ATTEMPT = '33333333-3333-4333-8333-333333333333'
const CHECKOUT_URL = 'https://checkout.stripe.com/c/pay/cs_test_launch_fixture'
const LINKED_DEVICE = {
  token: 'a'.repeat(64),
  refreshToken: 'b'.repeat(64),
  accountId: '11111111-1111-4111-8111-1111111a1b2c',
  deviceId: '22222222-2222-4222-8222-222222222222',
  expiresAt: new Date(Date.now() + 20 * 86_400_000).toISOString(),
  refreshExpiresAt: new Date(Date.now() + 80 * 86_400_000).toISOString(),
}
const offerBody = (salesOpen: boolean) => ({
  schemaVersion: 1, salesOpen, environment: 'live',
  price: { unitAmount: 499, currency: 'usd', interval: 'month' },
  tax: { collection: 'automatic', behavior: 'exclusive' },
  termsConsent: true, serverTime: new Date().toISOString(),
})
const PURCHASE = ['Become a Supporter', 'Continue to payment', 'Rejoin Supporter']

function snapshot(status: 'none' | 'pending' | 'active', extra: Record<string, unknown> = {}) {
  const paid = status === 'active'
  return {
    schemaVersion: 1, accountId: LINKED_DEVICE.accountId, accountKind: 'twitch', environment: 'live', revision: paid ? 5 : 4, status,
    checkoutEnabled: true, salesOpen: true,
    serverTime: new Date().toISOString(), accessFrom: new Date(Date.now() - 60_000).toISOString(),
    accessUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(), cacheUntil: new Date(Date.now() + 60_000).toISOString(),
    supportPeriods: paid ? 1 : 0,
    features: { 'supporter.banner.v1': paid, 'supporter.finish.v1': paid, 'supporter.recognition.v1': paid, 'supporter.chat_badge.v1': false },
    ...(paid ? { renewal: 'auto', renewsOn: new Date(Date.now() + 30 * 86_400_000).toISOString() } : { renewal: 'none' }),
    ...extra,
  }
}

async function linkDevice(serviceWorker: Worker) {
  const stored = await serviceWorker.evaluate(async record => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('pulse-account-private-v1', 1)
      open.onupgradeneeded = () => open.result.createObjectStore('account')
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(new Error('open failed'))
    })
    const key = 'https://api.streampulse.stream'
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('account', 'readwrite')
      tx.objectStore('account').put({ kind: 'linked', ...record }, key)
      tx.oncomplete = () => resolve()
      tx.onerror = tx.onabort = () => reject(new Error('seed failed'))
    })
    db.close()
    return 'linked'
  }, LINKED_DEVICE)
  expect(stored).toBe('linked')
}

/** Drop the worker's cached offer, as its minute running out would. */
const forgetOffer = (serviceWorker: Worker) => serviceWorker.evaluate(() => chrome.storage.session.remove('pulseSupporterOffer'))

async function routeOffer(page: Page, state: { open: boolean; reads: Array<{ cookie?: string; authorization?: string }> }) {
  await page.context().route(`${API}/v1/billing/offer`, route => {
    const headers = route.request().headers()
    state.reads.push({ cookie: headers.cookie, authorization: headers.authorization })
    return route.fulfill({ json: offerBody(state.open), headers: { 'cache-control': 'public, max-age=60' } })
  })
}

async function noPurchaseControls(page: Page) {
  for (const name of PURCHASE) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0)
}

test.describe('packaged sales switch', () => {
  test('closed says not open yet everywhere in settings, then a server flip opens the offer without a release', async ({ extension, prepare }, info) => {
    test.setTimeout(90_000)
    await prepare({ scenario: 'live-ready' })
    const context = extension.context
    await context.addCookies([{ name: 'ambient_account_fixture', value: 'must_not_be_sent', domain: 'api.streampulse.stream', path: '/', secure: true }])
    const offer = { open: false, reads: [] as Array<{ cookie?: string; authorization?: string }> }
    const checkouts: string[] = []
    await routeOffer(extension.page, offer)
    await context.route(`${API}/v1/billing/checkout`, route => { checkouts.push(route.request().method()); return route.fulfill({ status: 403, json: { error: 'checkout_disabled' } }) })
    const settings = extension.page
    const options = `chrome-extension://${extension.extensionId}/options/index.html`
    // The settings banner (every section but Account & Supporter) names no price while closed.
    await settings.goto(`${options}#pulse`)
    await expect(settings.locator('[data-supporter-offer-chip]')).toHaveText('· Coming soon')
    await settings.screenshot({ path: info.outputPath(`banner-closed-${STAGE}.png`), animations: 'disabled' })
    await settings.goto(`${options}#supporter`)
    await settings.reload()

    await expect(settings.locator('[data-journey-state]')).toBeVisible()
    await expect(settings.locator('.pulse-journey-title')).toHaveText('Supporter sign-ups are not open yet')
    await noPurchaseControls(settings)
    // Every button on the closed page, clicked, still reaches no Checkout.
    for (const button of await settings.locator('.pulse-journey-actions button:visible').all()) {
      if (/Continue with Twitch|Sign out/.test(await button.innerText())) continue
      await button.click({ trial: false }).catch(() => undefined)
    }
    await settings.screenshot({ path: info.outputPath(`sales-closed-${STAGE}.png`), fullPage: true, animations: 'disabled' })

    offer.open = true
    await forgetOffer(extension.serviceWorker)
    await settings.goto(`${options}#pulse`)
    await settings.reload()
    await expect(settings.locator('[data-supporter-offer-chip]')).toHaveText('· US$4.99/mo')
    await settings.screenshot({ path: info.outputPath(`banner-open-${STAGE}.png`), animations: 'disabled' })
    await settings.goto(`${options}#supporter`)
    await settings.reload()
    if (STAGE === 'off') {
      await expect(settings.locator('.pulse-journey-title')).toHaveText('Supporter is open on streampulse.stream')
      await expect(settings.locator('a[href="https://streampulse.stream/supporter"]').first()).toBeVisible()
      await noPurchaseControls(settings)
    } else {
      await expect(settings.locator('[data-journey-state="signed-out-offer"]')).toBeVisible()
      await expect(settings.locator('.pulse-supporter-terms')).toContainText('US$4.99 / month')
      await expect(settings.locator('.pulse-supporter-terms')).toContainText('plus sales tax or VAT where it applies')
      await expect(settings.getByRole('button', { name: 'Become a Supporter', exact: true })).toBeVisible()
    }
    await settings.screenshot({ path: info.outputPath(`sales-open-${STAGE}.png`), fullPage: true, animations: 'disabled' })

    expect(checkouts).toEqual([])
    expect(offer.reads.length).toBeGreaterThanOrEqual(2)
    // Anonymous: no cookie, no bearer.
    for (const read of offer.reads) expect(read).toEqual({ cookie: undefined, authorization: undefined })
  })

  test('a signed-in Twitch account reviews, pays on the Stripe stand-in and lands on the welcome', async ({ extension, prepare }, info) => {
    test.skip(STAGE !== 'public', 'needs a PULSE_EXTENSION_TWITCH_SIGNIN=public build')
    test.setTimeout(120_000)
    await prepare({ scenario: 'live-ready' })
    const context = extension.context
    await linkDevice(extension.serviceWorker)
    let status: 'none' | 'pending' | 'active' = 'none'
    const offer = { open: true, reads: [] as Array<{ cookie?: string; authorization?: string }> }
    const calls: string[] = []
    await routeOffer(extension.page, offer)
    await context.route(`${API}/v1/account/auth/twitch/**`, route => route.fulfill({ status: 500, json: {} }))
    await context.route(`${API}/v1/billing/supporter`, route => route.request().headers().authorization
      ? route.fulfill({ json: snapshot(status) })
      : route.fulfill({ status: 401, json: { error: 'sign_in_required' } }))
    await context.route(`${API}/v1/billing/checkout`, route => {
      calls.push('checkout')
      expect(route.request().headers().authorization).toBe(`Bearer ${LINKED_DEVICE.token}`)
      expect(route.request().postDataJSON()).toEqual({})
      return route.fulfill({ json: { attemptId: ATTEMPT, url: CHECKOUT_URL, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() } })
    })
    await context.route(`${API}/v1/billing/checkout/${ATTEMPT}`, route => route.fulfill({ json: { attemptId: ATTEMPT, state: status === 'none' ? 'open' : status } }))
    const settings = extension.page
    await settings.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)

    await expect(settings.locator('[data-journey-state="offer"]')).toBeVisible()
    await settings.getByRole('button', { name: 'Become a Supporter', exact: true }).click()
    // One screen before Stripe; choosing Become a Supporter sends nothing.
    const review = settings.locator('[data-journey-review]')
    await expect(review).toContainText('US$4.99 / month')
    await expect(review).toContainText('Today, plus sales tax or VAT where it applies.')
    await expect(review).toContainText(', then monthly')
    await expect(review).toContainText('You keep Supporter until the end of the month you paid for.')
    await expect(settings.getByText('You’ll accept the Supporter terms on Stripe.', { exact: false })).toBeVisible()
    expect(calls).toEqual([])
    await settings.screenshot({ path: info.outputPath('journey-review.png'), fullPage: true, animations: 'disabled' })

    // The worker opens Stripe; the harness resolver-blocks the real host, so
    // record what was opened rather than where the blocked tab ended up.
    await extension.serviceWorker.evaluate(() => {
      const original = chrome.tabs.create.bind(chrome.tabs)
      const opened: string[] = []
      ;(globalThis as unknown as { __launchTabs: string[] }).__launchTabs = opened
      chrome.tabs.create = ((properties: chrome.tabs.CreateProperties) => { opened.push(String(properties.url)); return original(properties) }) as typeof chrome.tabs.create
    })
    await settings.getByRole('button', { name: 'Continue to payment', exact: true }).click()
    await expect.poll(() => extension.serviceWorker.evaluate(() => (globalThis as unknown as { __launchTabs: string[] }).__launchTabs)).toEqual([CHECKOUT_URL])
    expect(calls).toEqual(['checkout'])
    await expect(settings.locator('[data-journey-state="stripe-open"]')).toBeVisible()

    status = 'active'
    await settings.bringToFront()
    await settings.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(settings.locator('[data-journey-state="welcome"]')).toBeVisible({ timeout: 30_000 })
    await expect(settings.getByText('You’re a Supporter. Thank you.', { exact: true })).toBeVisible()
    await expect(settings.getByRole('button', { name: 'Pick your finish', exact: true })).toBeVisible()
    // No receipt promise until the owner turns Stripe receipts on.
    await expect(settings.getByText('Stripe emailed your receipt', { exact: false })).toHaveCount(0)
    await settings.screenshot({ path: info.outputPath('journey-welcome.png'), fullPage: true, animations: 'disabled' })
    expect(calls).toEqual(['checkout'])
  })

  test('a cancelled membership says when it ends and offers Resume', async ({ extension, prepare }, info) => {
    test.skip(STAGE !== 'public', 'needs a PULSE_EXTENSION_TWITCH_SIGNIN=public build')
    await prepare({ scenario: 'live-ready' })
    await linkDevice(extension.serviceWorker)
    const offer = { open: true, reads: [] as Array<{ cookie?: string; authorization?: string }> }
    await routeOffer(extension.page, offer)
    await extension.context.route(`${API}/v1/account/auth/twitch/**`, route => route.fulfill({ status: 500, json: {} }))
    const endsOn = new Date(Date.now() + 12 * 86_400_000).toISOString()
    await extension.context.route(`${API}/v1/billing/supporter`, route => route.fulfill({ json: snapshot('active', { renewal: 'ends', endsOn, renewsOn: undefined }) }))
    const settings = extension.page
    await settings.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
    await expect(settings.locator('[data-journey-state="ending"]')).toBeVisible()
    await expect(settings.locator('.pulse-journey-title')).toHaveText(/^Supporter ends /)
    await expect(settings.locator('.pulse-journey-primary')).toHaveText('Resume')
    await expect(settings.getByText('Resume opens Stripe, where you choose Renew.', { exact: true })).toBeVisible()
    await settings.screenshot({ path: info.outputPath('journey-ending.png'), fullPage: true, animations: 'disabled' })
  })
})
