import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Supporter launch (spec 2026-10-10 §2-§3): the one server-driven sales switch
 * and the shorter checkout, against a local production preview. Every service
 * is a stand-in: GET /v1/billing/offer, the account API, Twitch's authorize page
 * and Stripe Checkout are all fulfilled here; nothing reaches a live API,
 * Twitch or Stripe. The open journey needs a build with VITE_TWITCH_SIGNIN=public.
 */
const TWITCH_PUBLIC = process.env.VITE_TWITCH_SIGNIN === 'public'
const EVIDENCE = process.env.SUPPORTER_LAUNCH_EVIDENCE
const ATTEMPT = '12345678-1234-4234-8234-123456789abc'
const FLOW = 'f'.repeat(32)
const ID_TOKEN = ['eyJhbGciOiJSUzI1NiJ9', 'eyJzdWIiOiJmaXh0dXJlIn0', 'c2lnbmF0dXJl'].join('.')
const OFFER = { schemaVersion: 1, salesOpen: true, environment: 'sandbox', price: { unitAmount: 499, currency: 'usd', interval: 'month' }, tax: { collection: 'automatic', behavior: 'exclusive' }, termsConsent: true, serverTime: '2026-10-10T18:00:00Z' }

test.use({ serviceWorkers: 'block' })

type World = {
  salesOpen: boolean
  signedIn: boolean
  checkoutEnabled: boolean
  status: 'none' | 'active'
  attemptState: 'open' | 'pending' | 'active'
  checkoutPosts: number
  offerReads: number
}

async function stand(context: BrowserContext, origin: string, world: World) {
  await context.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin === 'https://id.twitch.tv') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Twitch stand-in</title><h1>Twitch sign-in stand-in</h1>' })
    if (url.origin === 'https://checkout.stripe.com') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Stripe stand-in</title><h1>Stripe Checkout stand-in</h1>' })
    if (url.pathname === '/v1/billing/offer') {
      world.offerReads++
      expect(request.method()).toBe('GET')
      // The offer read is anonymous: no cookie, no bearer, no beta key.
      const headers = await request.allHeaders()
      expect(headers.authorization).toBeUndefined()
      expect(headers['x-streamclone-beta-key']).toBeUndefined()
      expect(headers.cookie).toBeUndefined()
      return route.fulfill({ json: { ...OFFER, salesOpen: world.salesOpen }, headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=60' } })
    }
    if (url.origin !== origin && !url.pathname.startsWith('/v1/')) return route.abort()
    if (!url.pathname.startsWith('/v1/')) return route.continue()
    if (url.pathname === '/v1/account/me') return world.signedIn ? route.fulfill({ json: { accountId: '11111111-1111-4111-8111-1111111a1b2c' } }) : route.fulfill({ status: 401, json: { error: 'sign_in_required' } })
    if (url.pathname === '/v1/account/auth/twitch/start') {
      expect(request.postDataJSON()).toMatchObject({ purpose: 'signin' })
      const authorize = new URL('https://id.twitch.tv/oauth2/authorize')
      authorize.searchParams.set('client_id', 'fixture')
      authorize.searchParams.set('response_type', 'id_token')
      authorize.searchParams.set('scope', 'openid')
      authorize.searchParams.set('state', FLOW)
      authorize.searchParams.set('redirect_uri', `${origin}/account/twitch/callback`)
      return route.fulfill({ json: { flowId: FLOW, flowSecret: 'a'.repeat(64), authorizeUrl: authorize.toString(), expiresAt: new Date(Date.now() + 600_000).toISOString() } })
    }
    if (url.pathname === '/v1/account/auth/twitch/complete') {
      world.signedIn = true
      // The API sets the readable CSRF cookie beside the HttpOnly session; the
      // page ties the remembered Twitch name to it.
      return route.fulfill({ json: { status: 'signed_in', profile: { displayName: 'FixtureStreamer' } }, headers: { 'Set-Cookie': `__Host-pulse_csrf=${'c'.repeat(64)}; Path=/; Secure; SameSite=Lax` } })
    }
    if (url.pathname === '/v1/billing/supporter') {
      if (!world.signedIn) return route.fulfill({ status: 401, json: { error: 'sign_in_required' } })
      return route.fulfill({ json: {
        schemaVersion: 1, accountId: '11111111-1111-4111-8111-1111111a1b2c', environment: 'sandbox',
        status: world.status, checkoutEnabled: world.checkoutEnabled, salesOpen: world.salesOpen,
        ...(world.status === 'active' ? { supportPeriods: 1, accessUntil: '2026-11-10T18:00:00Z', renewal: 'auto', renewsOn: '2026-11-10T18:00:00Z' } : {}),
      } })
    }
    if (url.pathname === '/v1/billing/checkout' && request.method() === 'POST') {
      world.checkoutPosts++
      expect(request.postDataJSON()).toEqual({})
      return route.fulfill({ json: { url: 'https://checkout.stripe.com/c/pay/fixture', attemptId: ATTEMPT } })
    }
    if (url.pathname === `/v1/billing/checkout/${ATTEMPT}`) return route.fulfill({ json: { attemptId: ATTEMPT, state: world.attemptState } })
    return route.fulfill({ status: 503, json: { error: 'fixture_unavailable' } })
  })
}

function shot(info: TestInfo, name: string) {
  if (!EVIDENCE) return info.outputPath(`${name}.png`)
  mkdirSync(EVIDENCE, { recursive: true })
  return join(EVIDENCE, `${name}.png`)
}

/** Clicks every enabled button in the page body, returning to the page whenever one navigates. */
async function clickEveryButton(page: Page, path: string) {
  const count = await page.locator('#public-main button:visible').count()
  for (let index = 0; index < count; index++) {
    const button = page.locator('#public-main button:visible').nth(index)
    if (!(await button.count()) || await button.isDisabled()) continue
    await button.click({ timeout: 2_000 }).catch(() => {})
    await page.waitForTimeout(150)
    if (new URL(page.url()).pathname + new URL(page.url()).search !== path) await page.goto(path)
  }
}

for (const width of [1440, 390]) {
  test(`closed: no page offers or reaches Checkout at ${width}px`, async ({ page, context, baseURL }, info) => {
    await page.setViewportSize({ width, height: 900 })
    const world: World = { salesOpen: false, signedIn: false, checkoutEnabled: false, status: 'none', attemptState: 'open', checkoutPosts: 0, offerReads: 0 }
    await stand(context, new URL(baseURL!).origin, world)
    for (const [path, signedIn] of [['/supporter', false], ['/terms', false], ['/refunds', false], ['/privacy', false], ['/account/billing', false], ['/account/billing', true], ['/account/billing?intent=subscribe', true]] as const) {
      world.signedIn = signedIn
      await page.goto(path)
      await expect(page.locator('#public-main h1').first()).toBeVisible()
      if (!path.startsWith('/account')) await expect(page.getByTestId('prelaunch-notice')).toBeVisible()
      else await expect(page.getByRole('heading', { name: signedIn ? 'Supporter sign-ups are not open yet' : 'Sign in to see your membership', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: /Become a Supporter|Continue to payment/ })).toHaveCount(0)
      await clickEveryButton(page, path)
      if (width === 1440 || path === '/supporter') await page.screenshot({ path: shot(info, `closed-${path.replace(/[/?=]+/g, '-').replace(/^-/, '')}${signedIn ? '-signed-in' : ''}-${width}`), fullPage: true, animations: 'disabled' })
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    }
    expect(world.checkoutPosts).toBe(0)
    expect(world.offerReads).toBeGreaterThan(0)
  })

  test(`open: Become a Supporter → Twitch → review → Stripe → activation → welcome at ${width}px`, async ({ page, context, baseURL }, info) => {
    test.skip(!TWITCH_PUBLIC, 'The open journey needs a VITE_TWITCH_SIGNIN=public build.')
    await page.setViewportSize({ width, height: 900 })
    const origin = new URL(baseURL!).origin
    const world: World = { salesOpen: true, signedIn: false, checkoutEnabled: true, status: 'none', attemptState: 'open', checkoutPosts: 0, offerReads: 0 }
    await stand(context, origin, world)

    // 01: the offer, with the price and the tax line before any click.
    await page.goto('/supporter')
    const strip = page.getByTestId('supporter-offer-strip')
    await expect(strip).toContainText('US$4.99 per month. Renews monthly until you cancel. Plus sales tax or VAT where it applies.')
    await expect(page.getByTestId('prelaunch-notice')).toHaveCount(0)
    await page.screenshot({ path: shot(info, `open-01-supporter-${width}`), fullPage: true, animations: 'disabled' })

    // 02: one click to Twitch (no StreamPulse sign-in page in between).
    await strip.getByRole('button', { name: 'Become a Supporter' }).click()
    await expect(page).toHaveURL(/^https:\/\/id\.twitch\.tv\/oauth2\/authorize\?/)
    expect(new URL(page.url()).searchParams.get('state')).toBe(FLOW)

    // Twitch returns to the site's callback, which lands on the remembered review.
    await page.goto(`/account/twitch/callback#id_token=${ID_TOKEN}&state=${FLOW}`)
    await expect(page).toHaveURL(`${origin}/account/billing?intent=subscribe`)

    // 03: one-screen review, then Continue to payment.
    await expect(page.getByRole('heading', { name: 'Become a Pulse Supporter', exact: true })).toBeVisible()
    const rows = page.getByTestId('billing-review-rows')
    await expect(rows).toContainText('US$4.99 / month')
    await expect(rows).toContainText('Today, plus sales tax or VAT where it applies.')
    await expect(rows).toContainText('then monthly')
    await expect(page.getByTestId('billing-review-identity')).toContainText('FixtureStreamer')
    await expect(page.getByTestId('billing-review-footnote')).toContainText('You’ll accept the Supporter terms on Stripe.')
    await page.screenshot({ path: shot(info, `open-03-review-${width}`), fullPage: true, animations: 'disabled' })
    expect(world.checkoutPosts).toBe(0)
    await page.getByRole('button', { name: 'Continue to payment', exact: true }).click()
    await expect(page).toHaveURL('https://checkout.stripe.com/c/pay/fixture')
    expect(world.checkoutPosts).toBe(1)

    // Cancel first: nothing was charged, and checkout can resume.
    await page.goto(`/account/billing/return?attempt=${ATTEMPT}&cancelled=1`)
    await expect(page.getByRole('heading', { name: 'Checkout cancelled', exact: true })).toBeVisible()
    await expect(page.getByText('You left Stripe checkout before paying. Nothing was charged.')).toBeVisible()
    await page.screenshot({ path: shot(info, `open-04-cancelled-${width}`), fullPage: true, animations: 'disabled' })

    // 04: back from Stripe, activation progresses on its own.
    world.attemptState = 'pending'
    await page.goto(`/account/billing/return?attempt=${ATTEMPT}`)
    await expect(page.getByRole('heading', { name: 'Activating your membership', exact: true })).toBeVisible()
    await expect(page.getByTestId('billing-activation-steps')).toContainText('✓ Stripe confirmed your payment')
    await expect(page.getByRole('button', { name: /Continue to payment|Return to checkout/ })).toHaveCount(0)
    await page.screenshot({ path: shot(info, `open-05-activating-${width}`), fullPage: true, animations: 'disabled' })
    world.attemptState = 'active'
    world.status = 'active'

    // 05: "here's your look" welcome, which survives a reload.
    await expect(page.getByRole('heading', { name: 'You’re a Supporter. Thank you.', exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('link', { name: 'Open Twitch' })).toHaveAttribute('href', 'https://www.twitch.tv/')
    await expect(page.getByRole('link', { name: 'Get the extension' })).toBeVisible()
    await expect(page.getByText('Renews', { exact: true })).toBeVisible()
    await page.screenshot({ path: shot(info, `open-06-welcome-${width}`), fullPage: true, animations: 'disabled' })
    await page.reload()
    await expect(page.getByRole('heading', { name: 'You’re a Supporter. Thank you.', exact: true })).toBeVisible()
    expect(world.checkoutPosts).toBe(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)

    // Already a Supporter: Become a Supporter leads to Manage, never a second charge.
    await page.goto('/account/billing?intent=subscribe')
    await expect(page.getByRole('heading', { name: 'You’re already a Supporter on this Twitch account', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Continue to payment' })).toHaveCount(0)
    expect(world.checkoutPosts).toBe(1)
  })
}
