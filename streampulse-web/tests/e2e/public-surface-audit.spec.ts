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
  ['/help', /^Help$/],
  ['/privacy', /Privacy Policy/i],
  // An old address: it opens Help.
  ['/support', /^Help$/],
  ['/guides/twitch-vod-timestamps', /^Twitch VOD timestamp links$/],
  ['/status', /System Status/i],
] as const

test.describe('public surface audit', () => {
  test('analytics shows the hub heading and the tracked channels without JavaScript instead of a permanent loading state', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false })
    const page = await context.newPage()
    await page.goto(`${baseURL}/analytics`)
    await expect(page.getByRole('heading', { level: 1, name: 'Find your streamer', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Twitch chat stats by streamer' })).toBeVisible()
    await expect(page.getByRole('link', { name: /^HasanAbi/ })).toHaveAttribute('href', '/analytics/hasanabi')
    await expect(page.getByRole('link', { name: 'How the stats are measured' })).toHaveAttribute('href', '/guides/find-twitch-moments#data-details')
    // The channel list's "Browse the Hub" link would point at this page.
    await expect(page.getByRole('link', { name: /Browse the Hub/ })).toHaveCount(0)
    await expect(page.locator('[data-analytics-route-skeleton]')).toBeHidden()
    await context.close()
  })

  test('cold route documents contain their own prerendered heading before hydration', async ({ request }) => {
    const expected = [
      ['/', 'Find the Twitch moments people'],
      ['/help', '>Help</h1>'],
      ['/docs', '>Help</h1>'],
      ['/analytics', 'StreamPulse Analytics'],
      ['/feedback', '>Help</h1>'],
      ['/feedback/', '>Help</h1>'],
      ['/guides/twitch-vod-timestamps', '>Twitch VOD timestamp links</h1>'],
    ] as const
    for (const [route, heading] of expected) {
      const response = await request.get(route)
      expect(response.ok()).toBe(true)
      expect(await response.text()).toContain(heading)
    }
  })

  test('cold route documents carry a large link preview with the shared card image', async ({ request }) => {
    for (const route of ['/', '/help', '/docs', '/status', '/support', '/privacy']) {
      const html = await (await request.get(route)).text()
      const meta = (attribute: string, key: string) =>
        new RegExp(`<meta ${attribute}="${key}" content="([^"]*)"`).exec(html)?.[1]
      expect(meta('name', 'twitter:card'), route).toBe('summary_large_image')
      expect(meta('property', 'og:image'), route).toBe('https://streampulse.stream/og-default.png')
      expect(meta('property', 'og:title'), route).toBeTruthy()
      expect(meta('property', 'og:description'), route).toBeTruthy()
    }
    const image = await request.get('/og-default.png')
    expect(image.ok()).toBe(true)
    expect(image.headers()['content-type']).toContain('image/png')
  })

  test.beforeEach(async ({ page }) => {
    await installPublicMocks(page, [])
  })

  test('old /support and /feedback links open Help, whose private form needs no account and labels public alternatives', async ({ page }) => {
    await page.goto('/support')
    await expect(page).toHaveURL(/\/help#fix$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Help' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'The Chat / Pulse switch is missing' })).toBeVisible()
    await page.goto('/feedback')
    await expect(page).toHaveURL(/\/help#feedback$/)
    const card = page.getByTestId('help-feedback')
    await expect(card).toHaveAttribute('id', 'feedback')
    const form = card.getByTestId('support-form')
    const off = card.getByTestId('support-form-unavailable')
    await expect(form.or(off)).toBeVisible()
    if (await form.isVisible()) {
      await expect(page.getByTestId('help-feedback-sub')).toContainText('No account needed.')
      await expect(page.getByTestId('feedback-private-note')).toContainText('Only the StreamPulse team reads it')
    }
    // The audit build has no Turnstile key, so the card says the private form
    // opens soon and makes no private-delivery promise above it.
    if (await off.isVisible()) {
      await expect(page.getByTestId('help-feedback-sub')).toHaveText('Our private form opens soon. Until then, you can ask in public.')
      await expect(page.getByTestId('feedback-private-note')).toHaveCount(0)
      await expect(off.getByTestId('feedback-public-alternatives')).toContainText('Public alternatives. Anyone can read these')
      await expect(off.getByRole('link', { name: /Open a public issue on GitHub/ })).toBeVisible()
    }
    const footer = page.getByRole('navigation', { name: 'Footer' })
    await expect(footer.getByRole('link', { name: 'Help', exact: true })).toHaveAttribute('href', '/help')
    await expect(footer.getByRole('link', { name: 'Send feedback' })).toHaveCount(0)
  })

  test('cold public entries load no analytics UI or optional demo and report actual font downloads', async ({ page, request }, testInfo) => {
    const budget = await (await request.get('/public-entry-budget.json')).json() as { staticJavaScript: string[]; publicPageJavaScript: string[]; analyticsUiModules: string[] }
    expect(budget.analyticsUiModules).toEqual([])
    // The help and legal pages load on demand, so a cold page may also load its own chunk.
    const allowed = new Set([...budget.staticJavaScript, ...budget.publicPageJavaScript])
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
      expect([...javascript].filter(file => !allowed.has(file))).toEqual([])
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
    await page.goto('/privacy')
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
    await page.getByRole('navigation', { name: 'Main Navigation' }).getByRole('link', { name: 'Help', exact: true }).click()
    await expect(page).toHaveURL(/\/help$/)
    expect(mutations.filter((entry) => /collector|analytics\/.*\/watch/i.test(entry))).toEqual([])
  })

  test('landing menu traps focus, closes with Escape, exposes public routes, and labels samples', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    const menu = page.getByRole('button', { name: 'Menu' })
    await menu.click()
    const dialog = page.getByRole('dialog', { name: 'StreamPulse' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('link', { name: 'Hub', exact: true })).toHaveAttribute('href', '/analytics')
    await expect(dialog.getByRole('link', { name: 'Moments', exact: true })).toHaveAttribute('href', '/analytics/moments')
    await expect(dialog.getByRole('link', { name: 'Help', exact: true })).toHaveAttribute('href', '/help')
    // The drawer's primary button once inherited the text-link colour (#eee on #fafafa, about 1.06:1).
    const openAnalytics = dialog.getByRole('link', { name: 'Open the Hub' })
    await expect(openAnalytics).toBeVisible()
    const contrast = await openAnalytics.evaluate((element) => {
      const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
      const lum = (value: string) => {
        const [r, g, b] = rgb(value).map((channel) => {
          const c = channel / 255
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
        })
        return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
      }
      const style = getComputedStyle(element)
      const [hi, lo] = [lum(style.color), lum(style.backgroundColor)].sort((x, y) => y - x)
      return (hi! + 0.05) / (lo! + 0.05)
    })
    expect(contrast).toBeGreaterThanOrEqual(4.5)
    await page.keyboard.press('Escape')
    await expect(menu).toBeFocused()
    await expect(page.getByText(/Sample data · interactive demonstration/i)).toBeVisible()
    await expect(page.locator('details.sl-optional-demo')).toHaveCount(0)
    await page.locator('#demo .sl-container > div:nth-child(2)').scrollIntoViewIfNeeded()
    await expect(page.locator('.es-demo .es')).toBeVisible()
    await expect(page.getByRole('group', { name: 'Demo steps' })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })

  test('Help sections follow its table of contents', async ({ page }) => {
    await page.goto('/help')
    const toc = await page.getByRole('navigation', { name: 'On this page' }).getByRole('link').allInnerTexts()
    const headings = await page.getByTestId('help-page').locator('h2').allInnerTexts()
    expect(headings.slice(0, toc.length)).toEqual(toc)
  })

  test('old documentation addresses open Help while unknown documentation routes retain not-found metadata', async ({ page }) => {
    await page.goto('/docs/getting-started')
    await expect(page).toHaveURL(/\/help#install$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Help' })).toBeVisible()
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
    await expect(page.getByTestId('status-overall')).toHaveText('Down')
    await expect(page.getByText('Down', { exact: true })).toHaveCount(4)
    await expect(page.getByText('Working', { exact: true })).toHaveCount(0)
  })
})
