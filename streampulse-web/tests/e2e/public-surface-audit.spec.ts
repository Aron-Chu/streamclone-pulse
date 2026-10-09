import { expect, test, type Page } from '@playwright/test'

const transparentPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9WQAAAABJRU5ErkJggg==',
  'base64',
)

async function installPublicMocks(page: Page, requests: string[]): Promise<void> {
  page.on('request', (request) => {
    if (request.method() !== 'GET' && request.method() !== 'HEAD') requests.push(`${request.method()} ${request.url()}`)
  })
  await page.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.resourceType() === 'image' && url.origin !== new URL(page.context().pages()[0]?.url() || 'http://127.0.0.1').origin) {
      await route.fulfill({ status: 200, contentType: 'image/png', body: transparentPng })
      return
    }
    if (url.pathname === '/v1/public/status') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'operational', components: { api: 'operational', coverage: 'operational', corpus: 'operational' } }),
      })
      return
    }
    if (url.pathname === '/v1/extension/health') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, version: 'audit' }) })
      return
    }
    if (url.pathname.startsWith('/v1/')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
      return
    }
    const appOrigin = new URL(process.env.PLAYWRIGHT_BASE_URL ||
      (process.env.PORTAL_E2E_AUDIT_PREVIEW === '1' ? 'http://127.0.0.1:4174' : 'http://127.0.0.1:5173')).origin
    if (url.origin !== appOrigin && url.origin !== 'http://127.0.0.1:4173') {
      await route.abort('blockedbyclient')
      return
    }
    await route.continue()
  })
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }))
  expect(dimensions.document, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport + 1)
  expect(dimensions.body, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport + 1)
}

/** The build under test has Continue with Twitch on (npm run test:e2e:audit inherits VITE_TWITCH_SIGNIN: "1" testers, "public"). */
const TWITCH_SIGNIN = process.env.VITE_TWITCH_SIGNIN === '1' || process.env.VITE_TWITCH_SIGNIN === 'public'
/** The build under test has My Moments on; its item then leads the account menu. */
const ACCOUNT_MOMENTS = process.env.VITE_ACCOUNT_MOMENTS === '1'
/** The build under test has the header account entry on (Sign in link / account menu). Off by default. */
const ACCOUNT_HEADER = process.env.VITE_ACCOUNT_HEADER === '1'

/** The signed-out sign-in page leads with Twitch when the flag is on, else with the email form. */
async function expectSignedOutSignInPage(page: Page): Promise<void> {
  if (TWITCH_SIGNIN) await expect(page.getByRole('button', { name: 'Continue with Twitch' })).toBeVisible()
  else await expect(page.getByLabel('Email address')).toBeVisible()
}

const widths = [360, 390, 720, 768, 1024, 1440]
const coldPages = [
  ['/', /Find the Twitch moments people actually reacted to/i],
  ['/docs', /^Get started with Pulse$/i],
  ['/privacy', /Privacy Policy/i],
  ['/support', /Support & Troubleshooting/i],
  ['/status', /System Status/i],
] as const

test.describe('public surface audit', () => {
  test('analytics keeps a readable guide without JavaScript instead of a permanent loading state', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false })
    const page = await context.newPage()
    await page.goto(`${baseURL}/analytics`)
    await expect(page.getByRole('heading', { name: 'StreamPulse Analytics', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Read the analytics guide' })).toHaveAttribute('href', '/docs#analytics')
    await expect(page.locator('[data-analytics-route-skeleton]')).toBeHidden()
    await context.close()
  })

  test('cold route documents contain their own prerendered heading before hydration', async ({ request }) => {
    const expected = [
      ['/', 'Find the Twitch moments people'],
      ['/docs', 'Get started with Pulse'],
      ['/analytics', 'StreamPulse Analytics'],
    ] as const
    for (const [route, heading] of expected) {
      const response = await request.get(route)
      expect(response.ok()).toBe(true)
      expect(await response.text()).toContain(heading)
    }
  })

  test.beforeEach(async ({ page }) => {
    await installPublicMocks(page, [])
  })

  test('cold public entries load no analytics UI or optional demo and report actual font downloads', async ({ page, request }, testInfo) => {
    const budget = await (await request.get('/public-entry-budget.json')).json() as { staticJavaScript: string[]; analyticsUiModules: string[] }
    expect(budget.analyticsUiModules).toEqual([])
    const receipt: unknown[] = []
    for (const [path, heading] of coldPages) {
      const javascript = new Set<string>()
      const fonts = new Set<string>()
      const onRequest = (request: import('@playwright/test').Request) => {
        const url = new URL(request.url())
        if (url.pathname.endsWith('.js')) javascript.add(url.pathname.slice(1))
        if (/\.woff2?$/.test(url.pathname)) fonts.add(url.pathname)
      }
      page.on('request', onRequest)
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
      await page.evaluate(() => document.fonts.ready)
      expect([...javascript].filter(file => !budget.staticJavaScript.includes(file))).toEqual([])
      expect(fonts.size).toBeLessThanOrEqual(2)
      receipt.push({ path, javascript: [...javascript], fonts: [...fonts] })
      page.off('request', onRequest)
    }
    await testInfo.attach('cold-public-assets.json', { body: JSON.stringify(receipt, null, 2), contentType: 'application/json' })
    console.log('COLD_PUBLIC_ASSETS', JSON.stringify(receipt))
  })

  test('landing remains one-shot over two minutes and respects reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.clock.install()
    let hubRequests = 0
    page.on('request', request => { if (/\/v1\/public\/hub(?:\?|$)/.test(request.url())) hubRequests += 1 })
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect.poll(() => hubRequests).toBe(1)
    await page.clock.fastForward(120_000)
    expect(hubRequests).toBe(1)
    expect(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running' && animation.effect?.getComputedTiming().iterations === Infinity).length)).toBe(0)
  })

  for (const width of widths) {
    test(`cold public routes do not overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      for (const [path, heading] of coldPages) {
        await page.goto(path)
        await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
        await expectNoHorizontalOverflow(page)
      }
    })
  }

  test('public layout menu closes with Escape, restores focus, and routes without mutation', async ({ page }) => {
    const mutations: string[] = []
    await installPublicMocks(page, mutations)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/docs')
    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('#public-main')).toBeFocused()
    const menu = page.getByRole('button', { name: 'Menu' })
    await menu.click()
    await expect(menu).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Escape')
    await expect(menu).toBeFocused()
    await expect(menu).toHaveAttribute('aria-expanded', 'false')
    await menu.click()
    await page.getByRole('navigation', { name: 'Main Navigation' }).getByRole('link', { name: 'Privacy' }).click()
    await expect(page).toHaveURL(/\/privacy$/)
    expect(mutations.filter((entry) => /collector|analytics\/.*\/watch/i.test(entry))).toEqual([])
  })

  test('landing menu traps focus, closes with Escape, exposes public routes, and labels samples', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    const menu = page.getByRole('button', { name: 'Menu' })
    await menu.click()
    const dialog = page.getByRole('dialog', { name: 'StreamPulse' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', '/docs')
    await expect(dialog.getByRole('link', { name: 'Status' })).toHaveAttribute('href', '/status')
    await expect(dialog.getByRole('link', { name: 'Support' })).toHaveAttribute('href', '/support')
    await expect(dialog.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy')
    await page.keyboard.press('Escape')
    await expect(menu).toBeFocused()
    await expect(page.getByText(/Sample data · interactive demonstration/i)).toBeVisible()
    await expect(page.locator('details.sl-optional-demo')).toHaveCount(0)
    await page.locator('#demo .sl-container > div:nth-child(2)').scrollIntoViewIfNeeded()
    await expect(page.locator('.sl-xtour')).toHaveAttribute('data-static', '')
    await expect(page.getByRole('region', { name: 'StreamPulse Pulse sidebar preview' })).toBeVisible()
    await expect(page.locator('.lsg')).toHaveAttribute('data-static', '')
    await expectNoHorizontalOverflow(page)
  })

  test('documentation aliases resolve while unknown documentation routes retain not-found metadata', async ({ page }) => {
    await page.goto('/docs/getting-started')
    await expect(page).toHaveURL(/\/docs#extension$/)
    await expect(page.getByRole('heading', { level: 1, name: /^Get started with Pulse$/i })).toBeVisible()
    await page.goto('/docs/unknown-audit-route')
    await expect(page.getByRole('heading', { level: 1, name: /Page not found/i })).toBeVisible()
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/i)
  })

  test('failed status probes never render an all-green result', async ({ page }) => {
    await page.route('**/v1/public/status', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }))
    await page.route('**/v1/extension/health', (route) => route.fulfill({ status: 502, contentType: 'application/json', body: '{}' }))
    await page.goto('/status')
    await expect(page.getByRole('alert')).toContainText(/could not be completed/i)
    await expect(page.getByText('All Systems Operational')).toHaveCount(0)
    await expect(page.getByText('Reported Services Operational')).toHaveCount(0)
    await expect(page.getByText('Status Unavailable')).toBeVisible()
    await expect(page.getByText('Operational', { exact: true })).toHaveCount(0)
  })

  for (const width of [1440, 375]) {
    test(`anonymous visitors get the enabled header entry and no account request at ${width}px`, async ({ page }, testInfo) => {
      const accountReads: string[] = []
      page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/v1/account/')) accountReads.push(request.url()) })
      await page.setViewportSize({ width, height: 900 })
      for (const [path, header] of [['/docs', 'header.app-nav'], ['/analytics', 'header.analytics-topnav']] as const) {
        await page.goto(path)
        const signIn = page.locator(header).getByRole('link', { name: 'Sign in', exact: true })
        if (ACCOUNT_HEADER) {
          await expect(signIn).toBeVisible()
          await expect(signIn).toHaveAttribute('href', '/account/sign-in')
        } else {
          await expect(page.locator(header)).toBeVisible()
          await expect(page.locator(header).locator('.account-entry')).toHaveCount(0)
          await expect(signIn).toHaveCount(0)
        }
        await expect(page.locator(header).getByRole('button', { name: 'Account', exact: true })).toHaveCount(0)
        await expectNoHorizontalOverflow(page)
        await page.screenshot({ path: testInfo.outputPath(`account-entry-signed-out${path.replace('/', '-')}-${width}.png`) })
      }
      await page.goto('/account/sign-in')
      await expectSignedOutSignInPage(page)
      expect(accountReads).toEqual([])
    })

    test(`signed-in visitors keep master's header while VITE_ACCOUNT_HEADER is off at ${width}px`, async ({ page, baseURL }) => {
      test.skip(ACCOUNT_HEADER, 'this build has the header account entry on')
      await page.context().addCookies([{ name: '__Host-pulse_csrf', value: 'ab'.repeat(32), domain: new URL(baseURL!).hostname, path: '/', secure: true, sameSite: 'Strict' }])
      const accountReads: string[] = []
      page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/v1/account/')) accountReads.push(request.url()) })
      await page.setViewportSize({ width, height: 900 })
      for (const path of ['/docs', '/analytics']) {
        await page.goto(path)
        await expect(page.getByRole('banner')).toBeVisible()
        await expect(page.locator('header .account-entry')).toHaveCount(0)
        await expect(page.getByRole('banner').getByRole('button', { name: 'Account', exact: true })).toHaveCount(0)
      }
      // Before the public Twitch stage the support menu links no account page
      // (the sign-in page is the tester bridge); in the public stage it offers
      // Sign in and Manage subscription. Never a connection code.
      const analyticsHeader = page.locator('header.analytics-topnav')
      await analyticsHeader.getByRole('button', { name: 'Support and account', exact: true }).click()
      const support = analyticsHeader.locator('.analytics-topnav__more-links')
      if (process.env.VITE_TWITCH_SIGNIN === 'public') {
        await expect(support.getByRole('link', { name: 'Sign in', exact: true })).toHaveAttribute('href', '/account/sign-in')
        await expect(support.getByRole('link', { name: 'Manage subscription', exact: true })).toHaveAttribute('href', '/account/billing')
      } else {
        await expect(support.locator('a[href^="/account"]')).toHaveCount(0)
      }
      await expect(support.locator('a[href="/account/link-device"]')).toHaveCount(0)
      await expect(support.getByRole('link', { name: 'Account & devices' })).toHaveCount(0)
      // Header chrome never asks who is signed in.
      expect(accountReads).toEqual([])
    })

    test(`signed-in visitors get an account menu at ${width}px`, async ({ page, baseURL }, testInfo) => {
      test.skip(!ACCOUNT_HEADER, 'needs a VITE_ACCOUNT_HEADER=1 build')
      const csrf = 'ab'.repeat(32)
      await page.context().addCookies([{ name: '__Host-pulse_csrf', value: csrf, domain: new URL(baseURL!).hostname, path: '/', secure: true, sameSite: 'Strict' }])
      let accountReads = 0
      const logouts: Array<string | null> = []
      await page.route('**/v1/account/me', route => {
        accountReads++
        return route.fulfill({ json: { accountId: '11111111-1111-4111-8111-111111111111', expiresAt: '2027-01-01T00:00:00Z' } })
      })
      await page.route('**/v1/account/auth/logout', route => {
        logouts.push(route.request().method() === 'POST' ? route.request().headers()['x-pulse-csrf'] ?? null : 'wrong-method')
        return route.fulfill({ status: 204 })
      })
      await page.setViewportSize({ width, height: 900 })

      await page.goto('/analytics')
      const analyticsHeader = page.locator('header.analytics-topnav')
      const trigger = analyticsHeader.getByRole('button', { name: 'Account', exact: true })
      await expect(trigger).toHaveAttribute('aria-expanded', 'false')
      await expect(analyticsHeader.getByRole('link', { name: 'Sign in', exact: true })).toHaveCount(0)
      await trigger.focus()
      await page.keyboard.press('Enter')
      const menu = page.getByRole('menu', { name: 'Account' })
      if (ACCOUNT_MOMENTS) {
        await expect(menu.getByRole('menuitem', { name: 'My Moments' })).toBeFocused()
        await expect(menu.getByRole('menuitem', { name: 'My Moments' })).toHaveAttribute('href', '/account/moments')
        await page.keyboard.press('ArrowDown')
      } else {
        await expect(menu.getByRole('menuitem', { name: 'My Moments' })).toHaveCount(0)
      }
      await expect(menu.getByRole('menuitem', { name: 'Account & devices' })).toBeFocused()
      await expect(menu.getByRole('menuitem', { name: 'Account & devices' })).toHaveAttribute('href', '/account/settings')
      await expect(menu.getByRole('menuitem', { name: 'Membership & billing' })).toHaveAttribute('href', '/account/billing')
      await page.keyboard.press('ArrowDown')
      await expect(menu.getByRole('menuitem', { name: 'Membership & billing' })).toBeFocused()
      const box = await page.locator('.account-entry__panel').boundingBox()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(width)
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: testInfo.outputPath(`account-entry-menu-analytics-${width}.png`), animations: 'disabled' })
      await page.keyboard.press('Escape')
      await expect(menu).toHaveCount(0)
      await expect(trigger).toBeFocused()

      // The support menu points signed-in visitors at their account, not the email form.
      await analyticsHeader.getByRole('button', { name: 'Support and account', exact: true }).click()
      const support = analyticsHeader.locator('.analytics-topnav__more-links')
      await expect(support.getByRole('link', { name: 'Account & devices' })).toHaveAttribute('href', '/account/settings')
      await expect(support.getByRole('link', { name: 'Sign in' })).toHaveCount(0)
      await page.keyboard.press('Escape')

      await page.goto('/docs')
      const publicHeader = page.locator('header.app-nav')
      const publicTrigger = publicHeader.getByRole('button', { name: 'Account', exact: true })
      await publicTrigger.click()
      await expect(page.getByRole('menu', { name: 'Account' })).toBeVisible()
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: testInfo.outputPath(`account-entry-menu-public-${width}.png`), animations: 'disabled' })
      // The answer lasts for the page: client navigation does not ask again.
      if (width <= 960) await publicHeader.getByRole('button', { name: 'Menu', exact: true }).click()
      await publicHeader.getByRole('link', { name: 'Analytics', exact: true }).click()
      await expect(page).toHaveURL(/\/analytics$/)
      await expect(analyticsHeader.getByRole('button', { name: 'Account', exact: true })).toBeVisible()
      expect(accountReads).toBe(2)

      await analyticsHeader.getByRole('button', { name: 'Account', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Sign out' }).click()
      await expect(analyticsHeader.getByRole('link', { name: 'Sign in', exact: true })).toBeFocused()
      expect(logouts).toEqual([csrf])
    })

    test(`the sign-in page offers next steps instead of the form when signed in at ${width}px`, async ({ page, baseURL }, testInfo) => {
      await page.context().addCookies([{ name: '__Host-pulse_csrf', value: 'cd'.repeat(32), domain: new URL(baseURL!).hostname, path: '/', secure: true, sameSite: 'Strict' }])
      await page.route('**/v1/account/me', route => route.fulfill({ json: { accountId: '11111111-1111-4111-8111-111111111111' } }))
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/account/sign-in')
      await expect(page.getByRole('heading', { level: 1, name: 'You’re signed in' })).toBeVisible()
      await expect(page.getByLabel('Email address')).toHaveCount(0)
      const actions = page.locator('.pulse-account-actions')
      await expect(actions.getByRole('link', { name: 'Account & devices' })).toHaveAttribute('href', '/account/settings')
      await expect(actions.getByRole('link', { name: 'Membership & billing' })).toHaveAttribute('href', '/account/billing')
      await expect(actions.getByRole('button', { name: 'Sign out' })).toBeEnabled()
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: testInfo.outputPath(`account-sign-in-signed-in-${width}.png`), fullPage: true })
    })
  }

  test('a rejected session check falls back to the signed-out entry and the email form', async ({ page, baseURL }) => {
    await page.context().addCookies([{ name: '__Host-pulse_csrf', value: 'ef'.repeat(32), domain: new URL(baseURL!).hostname, path: '/', secure: true, sameSite: 'Strict' }])
    await page.route('**/v1/account/me', route => route.fulfill({ status: 401, json: { error: 'sign_in_required' } }))
    await page.goto('/account/sign-in')
    await expectSignedOutSignInPage(page)
    if (ACCOUNT_HEADER) await expect(page.locator('header.app-nav').getByRole('link', { name: 'Sign in', exact: true })).toBeVisible()
    else await expect(page.locator('header.app-nav .account-entry')).toHaveCount(0)
  })
})

// Continue with Twitch, mocked end to end: the API start/complete routes and
// Twitch's authorize page are intercepted; nothing leaves the machine. Run with
// the flag on:  VITE_TWITCH_SIGNIN=1 npm run test:e2e:audit -- --grep "Twitch"
test.describe('Continue with Twitch', () => {
  const FLOW_ID = '0123456789abcdef0123456789abcdef'
  const FLOW_SECRET = 'f'.repeat(64)
  const ID_TOKEN = /* A stand-in, built at runtime so secret scanners see no token literal. */ [{ alg: 'RS256' }, { sub: '42424242' }].map(part => btoa(JSON.stringify(part))).concat(btoa('mocked-signature')).map(part => part.replace(/=+$/, '')).join('.')
  const AVATAR = 'https://static-cdn.jtvnw.net/jtv_user_pictures/pulse-profile_image-300x300.png'

  /** Stands in for Twitch: approve and come back with the ID token in the fragment. */
  function twitchApproves(origin: string): string {
    const target = `${origin}/account/twitch/callback#id_token=${ID_TOKEN}&scope=openid&state=${FLOW_ID}`
    return `<!doctype html><title>Twitch (mock)</title><script>location.replace(${JSON.stringify(target)})</script>`
  }

  function startReply(origin: string) {
    const authorize = new URLSearchParams({
      client_id: 'mockedclientid0000000000000000', redirect_uri: `${origin}/account/twitch/callback`,
      response_type: 'id_token', scope: 'openid', nonce: 'n'.repeat(64), state: FLOW_ID, force_verify: 'false',
    })
    return {
      flowId: FLOW_ID, flowSecret: FLOW_SECRET, authorizeUrl: `https://id.twitch.tv/oauth2/authorize?${authorize}`,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    }
  }

  test('is absent and the callback path is an ordinary 404 while VITE_TWITCH_SIGNIN is off', async ({ page }) => {
    test.skip(TWITCH_SIGNIN, 'this build has Continue with Twitch on')
    const twitchCalls: string[] = []
    page.on('request', request => { if (request.url().includes('/twitch/')) twitchCalls.push(request.url()) })
    await page.goto('/account/sign-in')
    await expect(page.getByLabel('Email address')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Continue with Twitch' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Tester email sign-in' })).toHaveCount(0)
    // Even with the flag off, a token that lands on the callback is stripped and never used.
    await page.goto(`/account/twitch/callback#id_token=${ID_TOKEN}&state=${FLOW_ID}`)
    await expect(page.getByTestId('not-found')).toBeVisible()
    expect(await page.evaluate(() => window.location.href)).not.toContain(ID_TOKEN)
    expect(twitchCalls.filter(url => url.includes('/v1/'))).toEqual([])
  })

  for (const width of [1440, 375]) {
    test(`signed out → Continue with Twitch → Twitch → callback → signed in at ${width}px`, async ({ page, baseURL }, testInfo) => {
      test.skip(!TWITCH_SIGNIN, 'needs a VITE_TWITCH_SIGNIN=1 build')
      const origin = new URL(baseURL!).origin
      const host = new URL(baseURL!).hostname
      const urls: string[] = []
      const starts: Array<{ body: unknown; origin?: string }> = []
      const completes: Array<{ body: unknown; origin?: string }> = []
      let signedIn = false
      page.on('request', request => urls.push(request.url()))

      // Hermetic: unknown API paths answer 404 and other origins are refused.
      // Routes registered later take precedence over this one.
      await page.route('**/*', route => {
        const url = new URL(route.request().url())
        if (url.origin === origin && url.pathname.startsWith('/v1/')) return route.fulfill({ status: 404, json: { error: 'not_found' } })
        return url.origin === origin ? route.continue() : route.abort('blockedbyclient')
      })
      await page.route('https://static-cdn.jtvnw.net/**', route => route.fulfill({ contentType: 'image/png', body: transparentPng }))
      await page.route('**/v1/account/me', route => signedIn
        ? route.fulfill({ json: { accountId: '11111111-1111-4111-8111-111111111111', expiresAt: '2027-01-01T00:00:00Z' } })
        : route.fulfill({ status: 401, json: { error: 'sign_in_required' } }))
      await page.route('**/v1/account/devices', route => route.fulfill({ json: { devices: [] } }))
      await page.route('**/v1/account/auth/twitch/start', route => {
        starts.push({ body: route.request().postDataJSON(), origin: route.request().headers().origin })
        return route.fulfill({ status: 201, json: startReply(origin) })
      })
      await page.route('https://id.twitch.tv/oauth2/authorize**', route => route.fulfill({ contentType: 'text/html', body: twitchApproves(origin) }))
      await page.route('**/v1/account/auth/twitch/complete', async route => {
        completes.push({ body: route.request().postDataJSON(), origin: route.request().headers().origin })
        // The API sets the session cookies on this response.
        await page.context().addCookies([{ name: '__Host-pulse_csrf', value: '34'.repeat(32), domain: host, path: '/', secure: true, sameSite: 'Strict' }])
        signedIn = true
        return route.fulfill({ json: { status: 'signed_in', created: false, profile: { displayName: 'PulseTester', picture: AVATAR } } })
      })

      await page.setViewportSize({ width, height: 900 })
      await page.goto('/account/sign-in')
      const header = page.locator('header.app-nav')
      if (ACCOUNT_HEADER) await expect(header.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible()
      const twitch = page.getByRole('button', { name: 'Continue with Twitch' })
      await expect(twitch).toBeVisible()
      await expect(twitch).toHaveCSS('background-color', 'rgb(145, 70, 255)')
      await expect(page.getByLabel('Email address')).toHaveCount(0)
      const disclosure = page.getByRole('button', { name: 'Tester email sign-in' })
      await expect(disclosure).toHaveAttribute('aria-expanded', 'false')
      expect((await twitch.boundingBox())!.y).toBeLessThan((await disclosure.boundingBox())!.y)
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: testInfo.outputPath(`twitch-sign-in-${width}.png`), fullPage: true })

      await twitch.click()
      await page.waitForURL(`${origin}/account/settings`)

      if (ACCOUNT_HEADER) {
        const account = header.getByRole('button', { name: 'Account: PulseTester', exact: true })
        await expect(account).toBeVisible()
        await expect(account.locator('img')).toHaveAttribute('src', 'https://static-cdn.jtvnw.net/jtv_user_pictures/pulse-profile_image-70x70.png')
      } else {
        await expect(header.locator('.account-entry')).toHaveCount(0)
      }
      await expect(header.getByRole('link', { name: 'Sign in', exact: true })).toHaveCount(0)
      await expect(page.getByTestId('twitch-account-row')).toContainText('Signed in with Twitch as PulseTester')
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: testInfo.outputPath(`twitch-signed-in-settings-${width}.png`), fullPage: true })

      expect(starts).toEqual([{ body: { purpose: 'signin' }, origin }])
      expect(completes).toEqual([{ body: { flowId: FLOW_ID, flowSecret: FLOW_SECRET, idToken: ID_TOKEN }, origin }])
      // The token and flow secret never ride in a request URL, and the flow does not linger.
      expect(urls.filter(url => url.includes(ID_TOKEN) || url.includes(FLOW_SECRET))).toEqual([])
      expect(await page.evaluate(() => [window.location.href, sessionStorage.getItem('pulse.account.twitchFlow.v1')]))
        .toEqual([`${origin}/account/settings`, null])
    })
  }

  test('explains a pilot refusal on the callback and offers email', async ({ page, baseURL }, testInfo) => {
    test.skip(!TWITCH_SIGNIN, 'needs a VITE_TWITCH_SIGNIN=1 build')
    const origin = new URL(baseURL!).origin
    await page.route('**/v1/account/me', route => route.fulfill({ status: 401, json: { error: 'sign_in_required' } }))
    await page.route('**/v1/account/auth/twitch/start', route => route.fulfill({ status: 201, json: startReply(origin) }))
    await page.route('https://id.twitch.tv/oauth2/authorize**', route => route.fulfill({ contentType: 'text/html', body: twitchApproves(origin) }))
    await page.route('**/v1/account/auth/twitch/complete', route => route.fulfill({ status: 403, json: { error: 'pilot_only' } }))
    await page.setViewportSize({ width: 375, height: 900 })
    await page.goto('/account/sign-in')
    await page.getByRole('button', { name: 'Continue with Twitch' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Twitch sign-in is invite-only for now' })).toBeVisible()
    expect(page.url()).toBe(`${origin}/account/twitch/callback`)
    await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: testInfo.outputPath('twitch-callback-pilot-only-375.png'), fullPage: true })
    await page.getByRole('link', { name: 'Tester email sign-in' }).click()
    await expect(page.getByLabel('Email address')).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })

  // Sign out everywhere (backend #162, POST /v1/account/sessions/revoke-all),
  // mocked: first the route is missing (not deployed or not relayed yet), then
  // a recent-auth refusal, then success.
  for (const width of [1440, 375]) {
    test(`Sign out everywhere asks first, is honest while unavailable, and ends signed out at ${width}px`, async ({ page, baseURL }, testInfo) => {
      test.skip(!TWITCH_SIGNIN, 'needs a VITE_TWITCH_SIGNIN=1 build')
      const origin = new URL(baseURL!).origin
      const host = new URL(baseURL!).hostname
      const answers = [
        { status: 404, json: { error: 'not_found' } },
        { status: 403, json: { error: 'recent_auth_required' } },
        { status: 204 },
      ]
      const revokes: Array<{ body: unknown; csrf?: string; origin?: string }> = []
      let signedIn = true
      await page.route('**/*', route => {
        const url = new URL(route.request().url())
        if (url.origin === origin && url.pathname.startsWith('/v1/')) return route.fulfill({ status: 404, json: { error: 'not_found' } })
        return url.origin === origin ? route.continue() : route.abort('blockedbyclient')
      })
      await page.context().addCookies([{ name: '__Host-pulse_csrf', value: '56'.repeat(32), domain: host, path: '/', secure: true, sameSite: 'Strict' }])
      await page.route('**/v1/account/me', route => signedIn
        ? route.fulfill({ json: { accountId: '11111111-1111-4111-8111-111111111111', signInMethods: ['twitch'], expiresAt: '2027-01-01T00:00:00Z' } })
        : route.fulfill({ status: 401, json: { error: 'sign_in_required' } }))
      await page.route('**/v1/account/devices', route => route.fulfill({ json: { devices: [{ id: 'dev-1', label: 'Chrome on Windows', expiresAt: '2027-01-01T00:00:00Z' }] } }))
      await page.route('**/v1/account/sessions/revoke-all', async route => {
        const request = route.request()
        revokes.push({ body: request.postDataJSON(), csrf: request.headers()['x-pulse-csrf'], origin: request.headers().origin })
        const answer = answers.shift()!
        if (answer.status === 204) {
          // The API clears this browser's session cookies with the 204.
          await page.context().clearCookies()
          signedIn = false
          return route.fulfill({ status: 204, body: '' })
        }
        return route.fulfill({ status: answer.status, json: answer.json })
      })

      await page.setViewportSize({ width, height: 900 })
      await page.goto('/account/settings')
      const section = page.getByTestId('sign-out-everywhere')
      await expect(section.getByRole('heading', { level: 2, name: 'Sign out everywhere' })).toBeVisible()
      await section.getByRole('button', { name: 'Sign out everywhere' }).click()
      const confirm = section.getByRole('button', { name: 'Confirm sign out everywhere' })
      await expect(confirm).toBeVisible()
      expect(revokes).toEqual([])
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: testInfo.outputPath(`sign-out-everywhere-confirm-${width}.png`), fullPage: true })

      await confirm.click()
      await expect(page.getByTestId('revoke-all-unavailable')).toHaveText('Sign out everywhere isn’t available yet. Nothing was signed out. You can still sign out here and revoke each extension above.')
      await expect(page.getByText('You’re signed in to StreamPulse.')).toBeVisible()
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: testInfo.outputPath(`sign-out-everywhere-unavailable-${width}.png`), fullPage: true })

      await confirm.click()
      const prompt = page.getByTestId('revoke-all-confirm-twitch')
      await expect(prompt).toContainText('Confirm it’s you')
      await expect(prompt.getByRole('button', { name: 'Continue with Twitch' })).toBeVisible()
      await expect(page.getByTestId('revoke-all-unavailable')).toHaveCount(0)
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: testInfo.outputPath(`sign-out-everywhere-confirm-its-you-${width}.png`), fullPage: true })

      await confirm.click()
      await expect(page.getByTestId('revoke-all-done')).toContainText('You’re signed out everywhere.')
      await expect(page.getByTestId('settings-signed-out')).toBeVisible()
      await expect(page.getByText('You’re signed in to StreamPulse.')).toHaveCount(0)
      await expect(page.getByText('Chrome on Windows')).toHaveCount(0)
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: testInfo.outputPath(`sign-out-everywhere-done-${width}.png`), fullPage: true })

      expect(revokes).toHaveLength(3)
      for (const revoke of revokes) expect(revoke).toEqual({ body: {}, csrf: '56'.repeat(32), origin })
    })
  }
})
