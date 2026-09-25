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
})
