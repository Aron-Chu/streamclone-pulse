import { expect, test, type Page, type Route } from '@playwright/test'

/**
 * The private feedback form on /feedback (and the /support card that links to
 * it) in a real browser. The form, the Turnstile widget and
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
 * reset issues a fresh token, unless `window.__turnstileErrors` still holds a
 * Cloudflare client error code: then that render or reset reports the next
 * code through error-callback instead.
 */
const TURNSTILE_STUB = `
(() => {
  let issued = 0
  const widgets = {}
  const settle = (opts) => setTimeout(() => {
    const code = (window.__turnstileErrors || []).shift()
    if (code) opts['error-callback'] && opts['error-callback'](code)
    else { window.__turnstileIssued = ++issued; opts.callback('stub-token-' + issued) }
  }, 0)
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
      settle(opts)
      return id
    },
    reset(id) { const opts = widgets[id]; if (opts) settle(opts) },
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

/** Opens /feedback; skips the test when the build has no Turnstile site key (no form). */
async function openConfiguredFeedback(page: Page) {
  await page.goto('/feedback')
  const form = page.getByTestId('support-form')
  const off = page.getByTestId('support-form-unavailable')
  await expect(form.or(off)).toBeVisible()
  test.skip(await off.isVisible(), 'build has no VITE_TURNSTILE_SITE_KEY, so /feedback shows no form')
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
  for (const [path, title] of [['/support', 'Support & Troubleshooting'], ['/feedback', 'Send feedback']] as const) {
    test(`the page h1 comes before every other heading on ${path}`, async ({ page, baseURL }) => {
      await mockNetwork(page, baseURL)
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
      const tags = await page.locator('main h1, main h2, main h3, main h4, main h5, main h6').evaluateAll(hs => hs.map(h => h.tagName))
      expect(tags[0]).toBe('H1')
      expect(tags.filter(tag => tag === 'H1')).toHaveLength(1)
    })
  }

  test('an old /support#send-feedback link lands on the card that opens /feedback', async ({ page, baseURL }) => {
    await mockNetwork(page, baseURL)
    await page.goto('/support#send-feedback')
    const card = page.locator('#send-feedback')
    await expect(card).toHaveAttribute('data-testid', 'support-feedback-link')
    await expect(card).toBeInViewport()
    // A build without the Turnstile site key (CI) cannot take private
    // messages, so the card says so instead of promising them.
    await expect(card).toContainText(/Only the StreamPulse team reads it\.|The private feedback form isn't taking messages right now\./)
    await expect(page.getByTestId('support-form')).toHaveCount(0)
    await card.getByRole('link', { name: 'Send feedback' }).click()
    await expect(page).toHaveURL(/\/feedback$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Send feedback' })).toBeVisible()
    const form = page.getByTestId('support-form')
    await expect(form.or(page.getByTestId('support-form-unavailable'))).toBeVisible()
    if (await form.isVisible()) {
      await expect(page.getByTestId('feedback-private-note')).toHaveText('Private. Only the StreamPulse team reads it; nothing here is posted publicly.')
    } else {
      await expect(page.getByTestId('feedback-private-note')).toHaveCount(0)
    }
  })

  test('without a working form, /feedback offers only alternatives labelled public', async ({ page, baseURL }) => {
    // Every case POST answers 503 disabled, so a configured build ends up here too.
    await page.addInitScript(() => { (window as { __turnstilePasses?: boolean }).__turnstilePasses = true })
    await mockNetwork(page, baseURL, [{ status: 503, body: { error: 'disabled' } }])
    await page.goto('/feedback')
    const form = page.getByTestId('support-form')
    const off = page.getByTestId('support-form-unavailable')
    await expect(form.or(off)).toBeVisible()
    if (await form.isVisible()) {
      await page.getByLabel('Your message').fill('Is this on?')
      await page.getByLabel('I consent to submitting this text to StreamPulse support.').check()
      await form.locator('button[type="submit"]').click()
      await expect(off).toBeVisible()
      await expect(off.getByRole('textbox')).toHaveValue('Is this on?')
    }
    const alternatives = off.getByTestId('feedback-public-alternatives')
    await expect(alternatives).toContainText('Public alternatives. Anyone can read these')
    expect(await alternatives.textContent()).not.toMatch(/private/i)
    // No private-delivery promise over the unavailable panel, and Discord once.
    await expect(page.getByTestId('feedback-private-note')).toHaveCount(0)
    await expect(page.getByTestId('support-discord-line')).toHaveCount(0)
    await expect(page.getByTestId('support-form-success')).toHaveCount(0)
  })
})

test.describe('configured build', () => {
  for (const width of [320, 360, 390, 768, 1440]) {
    test(`the challenge fits a ${width}px viewport without horizontal scroll`, async ({ page, baseURL }) => {
      await page.setViewportSize({ width, height: 800 })
      await mockNetwork(page, baseURL)
      await openConfiguredFeedback(page)
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
      // The page as prerendered, before the app runs: scripting stays on, but
      // no script loads, so the prerendered markup is what lays out.
      const noScripts = (route: Route) => (route.request().resourceType() === 'script' ? route.abort() : route.fallback())
      await page.route('**/*', noScripts)
      await page.goto('/feedback')
      // Without a site key the card prerenders the unavailable panel instead.
      test.skip(await page.getByTestId('support-form-unavailable').isVisible(), 'build has no VITE_TURNSTILE_SITE_KEY, so /feedback prerenders no form')
      const prerendered = await cardLayout(page)
      await expect(page.locator('.feedback-form--shell')).toBeVisible()

      await page.unroute('**/*', noScripts)
      await page.goto('/feedback')
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
      await page.goto('/feedback')
      test.skip(await page.locator('.feedback-form--shell').count() === 0, 'build has no VITE_TURNSTILE_SITE_KEY, so /feedback prerenders no form')
      await expect(page.locator('.feedback-form--shell')).toBeHidden()
      const off = page.getByTestId('support-form-unavailable')
      await expect(off).toBeVisible()
      await expect(off.getByRole('link', { name: 'Open a public issue on GitHub (opens in a new tab)' })).toBeVisible()
      await expect(off.getByTestId('feedback-public-alternatives')).toContainText('Public alternatives. Anyone can read these')
    })
  })

  test('the chosen feedback type stays visible in forced colours', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 390, height: 900 })
    await page.emulateMedia({ forcedColors: 'active' })
    await mockNetwork(page, baseURL)
    await openConfiguredFeedback(page)
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
      await openConfiguredFeedback(page)
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
      await openConfiguredFeedback(page)
      await sendButton(page).click()
      const box = page.getByLabel('Your message')
      await expect(box).toBeFocused()
      await expect(box).toHaveAttribute('aria-invalid', 'true')
      await expect(box).toHaveAccessibleDescription('Add a few words first.')
    })

    test('"Send something else" puts focus in the message box', async ({ page, baseURL }) => {
      await mockNetwork(page, baseURL, [{ status: 200, body: { case_id: 'case-e2e-1' } }])
      await openConfiguredFeedback(page)
      await page.getByLabel('Your message').fill('An idea')
      await page.getByLabel('I consent to submitting this text to StreamPulse support.').check()
      await sendButton(page).click()
      await expect(page.getByTestId('support-form-success')).toContainText('case-e2e-1')
      await page.getByRole('button', { name: 'Send something else' }).click()
      await expect(page.getByLabel('Your message')).toBeFocused()
    })

    test('a bot-check error keeps the message, and Try again gets a fresh challenge', async ({ page, baseURL }) => {
      // The first challenge times out while the reader types; the fresh one Send
      // starts fails; the one after that passes.
      await page.addInitScript(() => { (window as { __turnstileErrors?: string[] }).__turnstileErrors = ['110600', '600010'] })
      await mockNetwork(page, baseURL, [{ status: 200, body: { case_id: 'case-e2e-check' } }])
      await openConfiguredFeedback(page)
      await page.getByLabel('Your message').fill('Human, honest')
      await page.getByLabel('I consent to submitting this text to StreamPulse support.').check()
      await expect(page.getByTestId('support-form').getByRole('alert')).toHaveCount(0)
      await sendButton(page).click()
      await expect(page.getByTestId('support-form-error')).toHaveText("The bot check didn't go through. Your message is still here; try again.")
      await expect(page.getByTestId('support-form-unavailable')).toHaveCount(0)
      await expect(page.getByLabel('Your message')).toHaveValue('Human, honest')
      await page.getByRole('button', { name: 'Try again' }).click()
      await expect(page.getByTestId('support-form-error')).toHaveCount(0)
      // The fresh challenge from that press is the first to pass.
      await expect.poll(() => page.evaluate(() => (window as { __turnstileIssued?: number }).__turnstileIssued ?? 0)).toBe(1)
      await sendButton(page).click()
      await expect(page.getByTestId('support-form-success')).toContainText('case-e2e-check')
    })

    test('the rate-limit alert keeps its words while the countdown ticks', async ({ page, baseURL }) => {
      await mockNetwork(page, baseURL, [{ status: 429, body: { error: 'rate_limited' } }])
      await openConfiguredFeedback(page)
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
