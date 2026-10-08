import { expect, test, type Page } from '@playwright/test'

/**
 * /support feedback card in a real browser. The form, the Turnstile widget and
 * the Discord links only render on a build given the activation inputs
 * (VITE_TURNSTILE_SITE_KEY, VITE_PUBLIC_DISCORD_INVITE_URL). CI builds set
 * neither, so the "configured build" cases skip there; run them against a
 * preview of a configured build with PLAYWRIGHT_BASE_URL.
 */

/**
 * Stands in for Cloudflare's api.js. Like the real widget it honours `size`
 * (compact 150px wide, normal 300px, flexible fills its host with a 300px
 * floor). By default it takes the worst case and asks the reader to interact,
 * so the widget is visible; with `window.__turnstilePasses` set it passes
 * invisibly, as interaction-only does for most readers. Every render and
 * reset issues a fresh token.
 */
const TURNSTILE_STUB = `
(() => {
  let issued = 0
  const widgets = {}
  window.__turnstileRenders = []
  window.turnstile = {
    render(el, opts) {
      const id = 'stub-' + (Object.keys(widgets).length + 1)
      widgets[id] = opts
      window.__turnstileRenders.push({ size: opts.size, appearance: opts.appearance })
      const box = document.createElement('div')
      box.dataset.turnstileStub = opts.size || 'normal'
      box.style.height = opts.size === 'compact' ? '140px' : '65px'
      if (opts.size === 'flexible') { box.style.width = '100%'; box.style.minWidth = '300px' }
      else box.style.width = opts.size === 'compact' ? '150px' : '300px'
      box.style.background = '#333'
      if (window.__turnstilePasses) box.style.display = 'none'
      el.appendChild(box)
      if (!window.__turnstilePasses && opts['before-interactive-callback']) opts['before-interactive-callback']()
      setTimeout(() => opts.callback('stub-token-' + (++issued)), 0)
      return id
    },
    reset(id) { const opts = widgets[id]; if (opts) setTimeout(() => opts.callback('stub-token-' + (++issued)), 0) },
    remove(id) { delete widgets[id] },
  }
})()
`

type CaseReply = { status: number; body: unknown; delayMs?: number }

/** Mocks the network: the support case endpoint answers from `replies`, other API calls 503. */
async function mockNetwork(page: Page, baseURL: string | undefined, replies: CaseReply[] = []) {
  const origin = new URL(baseURL ?? 'http://127.0.0.1:4173').origin
  const queue = [...replies]
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin === 'https://challenges.cloudflare.com') {
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: TURNSTILE_STUB })
    }
    if (url.pathname === '/v1/portal/support/cases' && route.request().method() === 'POST') {
      const reply = queue.shift() ?? { status: 500, body: { error: 'unexpected' } }
      if (reply.delayMs) await new Promise(resolve => setTimeout(resolve, reply.delayMs))
      return route.fulfill({ status: reply.status, contentType: 'application/json', body: JSON.stringify(reply.body) })
    }
    if (url.pathname.startsWith('/v1/')) {
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'unavailable' }) })
    }
    if (url.origin === origin) return route.continue()
    return route.abort('blockedbyclient')
  })
}

/** Opens /support; skips the test when the build has no Turnstile site key (no form). */
async function openConfiguredSupport(page: Page) {
  await page.goto('/support')
  const form = page.getByTestId('support-form')
  const off = page.getByTestId('support-form-unavailable')
  await expect(form.or(off)).toBeVisible()
  test.skip(await off.isVisible(), 'build has no VITE_TURNSTILE_SITE_KEY, so /support shows no form')
  await expect.poll(() => page.evaluate(() => (window as { __turnstileRenders?: unknown[] }).__turnstileRenders?.length ?? 0)).toBe(1)
}

/** The card's height and where the content after it starts, once fonts are in. */
async function cardLayout(page: Page) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  return page.locator('#send-feedback').evaluate((card) => ({
    card: Math.round(card.getBoundingClientRect().height),
    next: Math.round(card.nextElementSibling!.getBoundingClientRect().top + scrollY),
  }))
}

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth }))

test.describe('any build', () => {
  test('the page h1 comes before every other heading on /support', async ({ page, baseURL }) => {
    await mockNetwork(page, baseURL)
    await page.goto('/support')
    await expect(page.getByRole('heading', { level: 1, name: 'Support & Troubleshooting' })).toBeVisible()
    const tags = await page.locator('main h1, main h2, main h3, main h4, main h5, main h6').evaluateAll(hs => hs.map(h => h.tagName))
    expect(tags[0]).toBe('H1')
    expect(tags.filter(tag => tag === 'H1')).toHaveLength(1)
  })
})

test.describe('configured build', () => {
  for (const width of [320, 360, 390, 768, 1440]) {
    test(`the challenge fits a ${width}px viewport without horizontal scroll`, async ({ page, baseURL }) => {
      await page.setViewportSize({ width, height: 800 })
      await mockNetwork(page, baseURL)
      await openConfiguredSupport(page)
      await expect(page.locator('[data-turnstile-stub]')).toBeVisible()
      const { scrollWidth, innerWidth } = await noHorizontalScroll(page)
      expect(scrollWidth).toBeLessThanOrEqual(innerWidth)
      const card = await page.locator('.feedback-card').boundingBox()
      expect(card!.x).toBeGreaterThanOrEqual(0)
      expect(card!.x + card!.width).toBeLessThanOrEqual(width)
      const [render] = await page.evaluate(() => (window as unknown as { __turnstileRenders: { size: string; appearance: string }[] }).__turnstileRenders)
      // Invisible unless Cloudflare needs the reader ("Turnstile runs invisibly").
      expect(render!.appearance).toBe('interaction-only')
      // The 300px widgets do not fit the ~261px a 320px phone leaves in the card.
      const hostWidth = await page.getByTestId('support-turnstile').evaluate(element => element.clientWidth)
      expect(render!.size).toBe(hostWidth < 300 ? 'compact' : 'flexible')
      if (width === 320) expect(render!.size).toBe('compact')
    })
  }

  for (const width of [390, 1440]) {
    test(`the prerendered card already takes the live form's space at ${width}px`, async ({ page, baseURL }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.addInitScript(() => { (window as { __turnstilePasses?: boolean }).__turnstilePasses = true })
      await mockNetwork(page, baseURL)
      // The page as prerendered, before JavaScript: same document, module script removed.
      await page.route('**/support', async (route) => {
        if (route.request().resourceType() !== 'document') return route.fallback()
        const response = await route.fetch()
        const html = (await response.text()).replace(/<script\b[^>]*type="module"[^>]*>\s*<\/script>/g, '')
        await route.fulfill({ response, body: html })
      })
      await page.goto('/support')
      // Without a site key the card prerenders the unavailable panel instead.
      test.skip(await page.getByTestId('support-form-unavailable').isVisible(), 'build has no VITE_TURNSTILE_SITE_KEY, so /support prerenders no form')
      const prerendered = await cardLayout(page)
      await expect(page.locator('.feedback-form--shell')).toBeVisible()

      await page.unroute('**/support')
      await page.goto('/support')
      await expect(page.locator('.feedback-form')).not.toHaveClass(/feedback-form--shell/)
      await expect.poll(() => page.evaluate(() => (window as { __turnstileRenders?: unknown[] }).__turnstileRenders?.length ?? 0)).toBe(1)
      await expect(page.getByLabel('Your message')).toBeEnabled()
      const live = await cardLayout(page)
      // Nothing below the card moves when the live form replaces the shell.
      expect(Math.abs(live.card - prerendered.card)).toBeLessThanOrEqual(1)
      expect(Math.abs(live.next - prerendered.next)).toBeLessThanOrEqual(1)
    })
  }

  test.describe('without JavaScript', () => {
    test.use({ javaScriptEnabled: false })

    test('shows the unavailable panel instead of the disabled shell', async ({ page }) => {
      await page.goto('/support')
      test.skip(await page.locator('.feedback-form--shell').count() === 0, 'build has no VITE_TURNSTILE_SITE_KEY, so /support prerenders no form')
      await expect(page.locator('.feedback-form--shell')).toBeHidden()
      const off = page.getByTestId('support-form-unavailable')
      await expect(off).toBeVisible()
      await expect(off.getByRole('link', { name: 'Open a public issue on GitHub' })).toBeVisible()
    })
  })

  test('the chosen feedback type stays visible in forced colours', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 390, height: 900 })
    await page.emulateMedia({ forcedColors: 'active' })
    await mockNetwork(page, baseURL)
    await openConfiguredSupport(page)
    const radios = page.locator('.feedback-choice input[type="radio"]')
    await expect(radios).toHaveCount(2)
    // The system radio is drawn, so the checked one is shown without colour.
    for (const radio of await radios.all()) {
      await expect(radio).toBeVisible()
      expect(await radio.evaluate(element => getComputedStyle(element).opacity)).toBe('1')
    }
    await expect(radios.nth(0)).toBeChecked()
    await page.getByText('I have an idea').click()
    await expect(radios.nth(1)).toBeChecked()
    const outline = (index: number) => page.locator('.feedback-choice__opt').nth(index).evaluate(element => getComputedStyle(element).outlineStyle)
    expect(await outline(1)).toBe('solid')
    expect(await outline(0)).toBe('none')
    await page.emulateMedia({ forcedColors: 'none' })
    expect(await radios.nth(0).evaluate(element => getComputedStyle(element).opacity)).toBe('0')
  })

  test('landing nav links stay on one line beside the Discord button just above the Menu breakpoint', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 1100, height: 800 })
    await mockNetwork(page, baseURL)
    await page.goto('/')
    await expect(page.locator('.sl-nav')).toBeVisible()
    test.skip(await page.locator('.sl-nav--discord').count() === 0, 'build has no VITE_PUBLIC_DISCORD_INVITE_URL, so the nav has no Discord button')
    await page.evaluate(() => document.fonts.ready.then(() => undefined))
    const wrapped: string[] = []
    for (let width = 961; width <= 1100; width++) {
      await page.setViewportSize({ width, height: 800 })
      const row = await page.evaluate(() => {
        const links = [...document.querySelectorAll<HTMLElement>('.sl-menu a')].map(link => link.getBoundingClientRect().height)
        const nav = document.querySelector<HTMLElement>('.sl-nav')!
        const menu = document.querySelector<HTMLElement>('.sl-menu')!.getBoundingClientRect()
        const right = document.querySelector<HTMLElement>('.sl-nav__right')!.getBoundingClientRect()
        return { links, overflow: nav.scrollWidth - nav.clientWidth, overlap: menu.right > right.left, page: document.documentElement.scrollWidth - innerWidth }
      })
      const oneLine = row.links.length === 4 && row.links.every(height => height === row.links[0] && height < 40)
      if (!oneLine || row.overflow > 0 || row.overlap || row.page > 0) wrapped.push(`${width}: ${JSON.stringify(row)}`)
    }
    expect(wrapped).toEqual([])
  })

  test.describe('keyboard and screen-reader paths', () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.addInitScript(() => { (window as { __turnstilePasses?: boolean }).__turnstilePasses = true })
    })

    const sendButton = (page: Page) => page.getByTestId('support-form').locator('button[type="submit"]')

    test('focus stays on Send while sending and after a failed send', async ({ page, baseURL }) => {
      await mockNetwork(page, baseURL, [{ status: 500, body: { error: 'boom' }, delayMs: 800 }])
      await openConfiguredSupport(page)
      await page.getByLabel('Your message').fill('Pulse tab is blank')
      await page.getByLabel('I consent to submitting this text to StreamPulse support.').check()
      await sendButton(page).focus()
      await page.keyboard.press('Enter')
      await expect(page.getByTestId('support-form-loading')).toBeVisible()
      await expect(sendButton(page)).toBeFocused()
      await expect(page.getByTestId('support-form-error')).toHaveText("Couldn't send. Your message is still here.")
      await expect(page.getByRole('button', { name: 'Try again' })).toBeFocused()
      await expect(page.getByLabel('Your message')).toHaveValue('Pulse tab is blank')
    })

    test('an empty Send moves focus to the message box with its hint', async ({ page, baseURL }) => {
      await mockNetwork(page, baseURL)
      await openConfiguredSupport(page)
      await sendButton(page).click()
      const box = page.getByLabel('Your message')
      await expect(box).toBeFocused()
      await expect(box).toHaveAttribute('aria-invalid', 'true')
      await expect(box).toHaveAccessibleDescription('Add a few words first.')
    })

    test('"Send something else" puts focus in the message box', async ({ page, baseURL }) => {
      await mockNetwork(page, baseURL, [{ status: 200, body: { case_id: 'case-e2e-1' } }])
      await openConfiguredSupport(page)
      await page.getByLabel('Your message').fill('An idea')
      await page.getByLabel('I consent to submitting this text to StreamPulse support.').check()
      await sendButton(page).click()
      await expect(page.getByTestId('support-form-success')).toContainText('case-e2e-1')
      await page.getByRole('button', { name: 'Send something else' }).click()
      await expect(page.getByLabel('Your message')).toBeFocused()
    })

    test('the rate-limit alert keeps its words while the countdown ticks', async ({ page, baseURL }) => {
      await mockNetwork(page, baseURL, [{ status: 429, body: { error: 'rate_limited' } }])
      await openConfiguredSupport(page)
      await page.getByLabel('Your message').fill('Again')
      await page.getByLabel('I consent to submitting this text to StreamPulse support.').check()
      await sendButton(page).click()
      const alert = page.getByTestId('support-form-rate-limit')
      await expect(alert).toHaveText('Too many attempts. Wait a minute, then try again. Your message is still here.')
      const countdown = page.getByTestId('support-rate-countdown')
      const first = await countdown.textContent()
      await expect.poll(() => countdown.textContent(), { timeout: 4_000 }).not.toBe(first)
      await expect(alert).toHaveText('Too many attempts. Wait a minute, then try again. Your message is still here.')
      await expect(sendButton(page)).toHaveAttribute('aria-disabled', 'true')
      await expect(sendButton(page)).toBeFocused()
    })
  })
})
