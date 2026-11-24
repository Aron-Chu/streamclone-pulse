import { test, expect, type Page } from './helpers/portalMockedTest'
import { installHubUxMock } from './helpers/hubUxMock'

// The homepage reads the public hub; answer it here so no test reaches the live API.
test.beforeEach(async ({ page }) => {
  await page.route('**/v1/**', route => route.fulfill({ status: 503, body: '{}' }))
})

for (const width of [390, 1440]) {
  test(`restored homepage at ${width}px retains visible demos and static access`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    // The still background (chat ridge, and the chat columns on wide screens) mounts after load;
    // the emote rain is never mounted under reduced motion.
    await expect(page.locator('.sl-herobg')).toHaveCount(1)
    // landing.css hides the chat backdrop at 960px and below, so it is not mounted there.
    await expect(page.locator('.sl-chatbg')).toHaveCount(width >= 961 ? 1 : 0)
    await expect(page.locator('.sl-fx')).toHaveCount(0)
    await expect(page.locator('.sl-optional-demo')).toHaveCount(0)
    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('#landing-main')).toBeFocused()
    await page.locator('#demo').scrollIntoViewIfNeeded()
    // The demo beside Twitch chat holds one still step, with the stream's picture, under reduced motion.
    await expect(page.locator('.es-demo .es')).toBeVisible()
    await expect(page.locator('.es-demo .es')).toHaveAttribute('data-beat', '3')
    await expect(page.locator('.es-poster').first()).toBeVisible()
    await expect(page.getByRole('region', { name: 'BrainChat' })).toBeVisible()
    await expect(page.locator('.lsg')).toHaveCount(0)
    await expect(page.locator('.sl-fx')).toHaveCount(0)
    expect(await page.locator('.sl-header').evaluate(element => Math.abs(element.getBoundingClientRect().top))).toBeLessThanOrEqual(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    await page.evaluate(() => scrollTo(0, 0))
    await page.screenshot({ path: testInfo.outputPath(`home-${width}.png`) })
    if (width === 390) {
      await page.getByRole('button', { name: 'Menu', exact: true }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeFocused()
    }
  })
}

test('the animated homepage shows the rain, the chat backdrop and the demo beside Twitch chat', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/')
  await expect(page.locator('.sl-fx')).toBeVisible()
  await expect(page.locator('.sl-chatbg')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('home-animated.png') })
  await page.locator('#demo').scrollIntoViewIfNeeded()
  const stage = page.locator('.es-demo .es')
  await expect(stage).toBeVisible()
  // It starts on its own once most of it shows: from the chat flood to Pulse marking the spike.
  await expect(stage).toHaveAttribute('data-beat', '1', { timeout: 10_000 })
})

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('the prerendered homepage stays readable with JavaScript disabled', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#demo')).toContainText('JavaScript is available')
    // The whole background mounts after load; none of it is in the prerendered HTML.
    await expect(page.locator('.sl-herobg, .sl-chatbg, .sl-fx')).toHaveCount(0)
    await expect(page.locator('#roadmap, #analysis, .lsg')).toHaveCount(0)
    // the chat band needs the hub answer: no loading shapes in the prerendered page
    await expect(page.locator('.sl-cn')).toHaveCount(0)
  })
})

// P1 (11-02): a phone leads with Open the Hub, filled, with no install button and a line saying the extension is for
// desktop; a desktop keeps the install button first and no such line.
test('the homepage hero leads with Open the Hub on a phone and keeps the install button on a desktop', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const actions = page.locator('.sl-hero__actions')
  const hub = actions.getByRole('link', { name: 'Open the Hub' })
  const install = actions.locator('[data-cta="chrome-install-hero"]')
  const desk = page.locator('p.sl-hero__desk')
  await expect(hub).toBeVisible()
  await expect(install).toBeHidden()
  await expect(desk).toBeVisible()
  await expect(desk).toHaveText('Desktop extension for Chrome, Edge and Firefox')
  const filled = (el: Element) => getComputedStyle(el).backgroundColor
  expect(await hub.evaluate(filled)).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/)
  expect((await hub.boundingBox())!.height).toBeGreaterThanOrEqual(40)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)

  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(install).toBeVisible()
  await expect(desk).toBeHidden()
  await expect(hub).toBeVisible()
})

// Fastest chats (board 11-22, picks 1A 2A 3A): the five busiest live chats between the hero and the demo, from the hub
// answer the page already reads, each opening its channel; on a wide screen with a mouse, Twitch's chat for a row
// pointed at; nothing when the hub is down.
test.describe('Fastest chats', () => {
  // The mock's live rows with full 5-minute chat counts that ended a minute ago (the Hub spec's screener shape).
  async function serveChatCounts(page: Page) {
    await installHubUxMock(page)
    await page.addInitScript(() => {
      const original = window.fetch.bind(window)
      window.fetch = async (input, init) => {
        const response = await original(input, init)
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (!/\/v1\/public\/hub(\?|$)/.test(url) || !response.ok) return response
        const body = await response.clone().json()
        const end = Math.floor(Date.now() / 60_000) * 60_000 - 60_000
        const rates = [1800, 1240, 900, 610, 480, 300, 120]
        body.liveChannels = (body.liveChannels ?? []).map((c: Record<string, unknown>, i: number) => i >= rates.length ? c : {
          ...c,
          screener: {
            version: 1, baselineKind: 'current_stream_measured_average', state: 'ready', measuredAt: end,
            currentWindow: { start: end - 5 * 60_000, end, expectedMinutes: 5, measuredMinutes: 5, coveragePct: 100 },
            baselineWindow: { start: end - 65 * 60_000, end: end - 5 * 60_000, expectedMinutes: 60, measuredMinutes: 60, coveragePct: 100 },
            chat: { state: 'ready', currentPerMin: rates[i], baselinePerMin: rates[i] / 2, multiplier: 2, baselineMeasuredMinutes: 60 },
            emotes: null,
          },
        })
        return new Response(JSON.stringify(body), { status: response.status, headers: { 'Content-Type': 'application/json' } })
      }
    })
  }

  test('stays off when the hub answer fails', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    await expect(page.locator('#demo')).toBeAttached()
    await expect(page.locator('.sl-cn')).toHaveCount(0)
  })

  test('lists the five busiest under the hero on a desktop, each opening its channel', async ({ page }, testInfo) => {
    await serveChatCounts(page)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    const section = page.getByRole('region', { name: 'Fastest chats right now' })
    const rows = section.getByRole('list').getByRole('link')
    await expect(rows).toHaveCount(5)
    await expect(rows.first()).toContainText('xQc')
    await expect(rows.first()).toContainText('1,800/min')
    for (const row of await rows.all()) await expect(row).toHaveAttribute('href', /^\/analytics\//)
    await expect(section.getByRole('link', { name: /Open the Hub/ })).toHaveAttribute('href', '/analytics')
    // the panel beside the list plays the first chat as board option D's column until a row is pointed at
    const peek = page.locator('.sl-cn-peek')
    await expect(peek).toBeVisible()
    await expect(peek.locator('.sl-cn-col > .sl-cn-ln')).toHaveCount(30)
    // 1,800 a minute is 30 a second, past the 12 lines a second the column draws
    await expect(peek).toContainText('Each bar is 3 messages we counted')
    await expect(peek).toContainText('Point at a chat to open Twitch’s live chat here.')
    await expect(page.locator('iframe.sl-cn-if')).toHaveCount(0)
    const order = await page.evaluate(() => {
      const hero = document.querySelector('.sl-hero')!
      const band = document.querySelector('.sl-cn')!
      const demo = document.querySelector('#demo')!
      return Boolean(hero.compareDocumentPosition(band) & Node.DOCUMENT_POSITION_FOLLOWING)
        && Boolean(band.compareDocumentPosition(demo) & Node.DOCUMENT_POSITION_FOLLOWING)
    })
    expect(order).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    await section.scrollIntoViewIfNeeded()
    await section.screenshot({ path: testInfo.outputPath('chat-band-1440.png') })
  })

  test("opens Twitch's chat beside the list for a row pointed at, out of the Tab order", async ({ page }, testInfo) => {
    await serveChatCounts(page)
    // Twitch's chat page, stubbed: the frame rule in the index.html meta must still let it in
    await page.route('https://www.twitch.tv/embed/**', route => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>chat</title><body style="margin:0;background:#18181b;color:#efeff1;font:14px sans-serif;padding:16px">Twitch chat (test page)</body>',
    }))
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    const rows = page.locator('ol.sl-cn-list a.sl-cn-row')
    await expect(rows).toHaveCount(5)
    await rows.nth(1).hover()
    const frame = page.locator('iframe.sl-cn-if')
    await expect(frame).toHaveAttribute('src', /^https:\/\/www\.twitch\.tv\/embed\/sodapoppin\/chat\?parent=[^&]+&darkpopout$/)
    await expect(frame).toHaveAttribute('data-on', '')
    await expect(frame).toHaveAttribute('tabindex', '-1')
    await expect(page.locator('.sl-cn-peek-h')).toContainText('sodapoppin')
    await expect(page.locator('.sl-cn-peek-st')).toHaveText('Live on Twitch')
    await expect(page.frameLocator('iframe.sl-cn-if').locator('body')).toContainText('Twitch chat (test page)')
    await page.locator('.sl-cn').screenshot({ path: testInfo.outputPath('chat-band-twitch.png') })
  })

  test('drops the panel on a phone and keeps the page inside the screen', async ({ page }, testInfo) => {
    await serveChatCounts(page)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    const rows = page.locator('ol.sl-cn-list a.sl-cn-row')
    await expect(rows).toHaveCount(5)
    await expect(page.locator('.sl-cn-peek')).toHaveCount(0)
    for (const row of await rows.all()) expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    await page.locator('.sl-cn').scrollIntoViewIfNeeded()
    await page.locator('.sl-cn').screenshot({ path: testInfo.outputPath('chat-band-390.png') })
  })
})
