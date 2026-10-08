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
 * floor) and, as the worst case, always asks the reader to interact, so the
 * widget is visible. Every render and reset issues a fresh token.
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
      el.appendChild(box)
      if (opts['before-interactive-callback']) opts['before-interactive-callback']()
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

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth }))

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
})
