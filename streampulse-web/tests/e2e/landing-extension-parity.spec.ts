import { test, expect, type Page } from '@playwright/test'
import { installMockApi } from './helpers/mockApi'

// The front page's demo beside Twitch chat (board extension-brainchat 11-22, ★ A1 cue, ★ E1 push-in): a Twitch-style
// page with the extension's column, a three.js stream of a cat on a store shelf (with motion and WebGL) and five steps.

const CUE = 'See the extension beside Twitch chat'

/** Nothing leaves the machine: the mock API answers what it knows, any other API call gets a 503, other sites are blocked. */
async function offline(page: Page, baseURL: string | undefined) {
  const app = new URL(baseURL ?? 'http://127.0.0.1:5173').origin
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith('/v1/')) return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
    if (url.origin !== app) return route.abort('blockedbyclient')
    return route.continue()
  })
  // Registered last, so its routes answer first.
  await installMockApi(page)
}

async function openHome(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 })
}

async function scrollToDemo(page: Page) {
  await page.locator('#demo .sl-container > div:nth-child(2)').scrollIntoViewIfNeeded()
  await expect(page.locator('.es-demo .es')).toBeVisible({ timeout: 15_000 })
}

/** The stage's box, and the content column it sits in. */
async function stageBox(page: Page) {
  return page.locator('.es-demo .es').evaluate((stage) => {
    const box = stage.getBoundingClientRect()
    const column = stage.closest('.sl-container')!
    const style = getComputedStyle(column)
    const outer = column.getBoundingClientRect()
    const left = outer.left + parseFloat(style.paddingLeft)
    const right = outer.right - parseFloat(style.paddingRight)
    return { width: box.width, height: box.height, left: box.left, right: box.right, columnLeft: left, columnRight: right }
  })
}

async function assertNoPageOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
}

test.describe('landing demo beside Twitch chat', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await offline(page, baseURL)
  })

  test('the hero cue scrolls to the demo, focuses it and plays it from the top to the jump', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await openHome(page)
    const cue = page.getByRole('link', { name: CUE })
    await expect(cue).toBeVisible()
    await expect(cue).toHaveAttribute('href', '#demo')
    await cue.click()
    await expect(page.locator('#demo')).toBeFocused()
    // The cue fades once the page has scrolled.
    await expect(cue).toHaveAttribute('data-gone', '')
    const stage = page.locator('.es-demo .es')
    await expect(stage).toBeVisible({ timeout: 15_000 })
    // Before the run the stage holds step 4; the cue starts it at step 1, then Pulse marks the spike.
    await expect(stage).toHaveAttribute('data-beat', '1', { timeout: 10_000 })
    await expect(stage).toHaveAttribute('data-beat', '4', { timeout: 15_000 })
    await expect(page.locator('.es-step[aria-current="step"]')).toHaveText(/5\s*Lands just before it/)
    await expect(stage).toHaveAttribute('data-cam', 'out', { timeout: 5_000 })
    // The clock scrubs in 16 short steps; software WebGL under parallel workers can hold each one back.
    await expect(page.locator('.es-time span').first()).toHaveText(/^1:3[67]:\d\d$/, { timeout: 10_000 })
    // Chat lines are text: a made-up name and the line.
    expect(await page.locator('.es-lines img').count()).toBe(0)
  })

  test('the stage keeps the 1120 x 700 shape, fits its column, and draws the stream when WebGL is there', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await openHome(page)
    await scrollToDemo(page)
    const box = await stageBox(page)
    expect(box.width).toBeLessThanOrEqual(1120)
    expect(Math.abs(box.height - Math.round((box.width * 700) / 1120))).toBeLessThanOrEqual(1)
    expect(box.left).toBeGreaterThanOrEqual(box.columnLeft - 1)
    expect(box.right).toBeLessThanOrEqual(box.columnRight + 1)
    await expect(page.locator('.es-demo')).toHaveAttribute('data-cap', 'beside')
    for (const picture of ['.es-p-base', '.es-tab-pulse', '.es-settings']) {
      expect(await page.locator(picture).evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
    }
    // three.js needs WebGL 2; without it the pictures stay.
    const webgl = await page.evaluate(() => Boolean(document.createElement('canvas').getContext('webgl2')))
    if (webgl) await expect(page.locator('.es-demo .es')).toHaveAttribute('data-scene', '', { timeout: 15_000 })
    else await expect(page.locator('.es-poster').first()).toBeVisible()
    await assertNoPageOverflow(page)
  })

  test('each step holds still when picked, and Play again runs it from the top', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await openHome(page)
    await scrollToDemo(page)
    const stage = page.locator('.es-demo .es')
    const steps = page.getByRole('group', { name: 'Demo steps' }).getByRole('button')
    await expect(steps).toHaveCount(5)
    await steps.nth(2).click()
    await expect(stage).toHaveAttribute('data-beat', '2')
    await expect(stage).toHaveAttribute('data-cam', 'in')
    await expect(steps.nth(2)).toHaveAttribute('aria-current', 'step')
    await steps.nth(0).click()
    await expect(stage).toHaveAttribute('data-beat', '0')
    expect(await page.locator('.es-lines .es-cl').count()).toBeGreaterThan(0)
    // A step holds: it does not play on by itself.
    await page.waitForTimeout(2_500)
    await expect(stage).toHaveAttribute('data-beat', '0')
    await page.getByRole('button', { name: 'Play again' }).click()
    await expect(stage).toHaveAttribute('data-beat', '1', { timeout: 10_000 })
  })

  test('a phone gets the tall stage, step numbers and the words under it, with no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await openHome(page)
    await expect(page.getByRole('link', { name: CUE })).toBeVisible()
    await scrollToDemo(page)
    const demo = page.locator('.es-demo')
    await expect(demo).toHaveAttribute('data-phone', '')
    await expect(demo).toHaveAttribute('data-cap', 'below')
    const box = await stageBox(page)
    expect(box.height).toBeGreaterThan(box.width)
    expect(box.height).toBeLessThanOrEqual(640)
    await expect(page.locator('.es-steps-cap')).toBeVisible()
    await assertNoPageOverflow(page)
  })

  test('reduced motion holds one still step with the stream picture and loads no three.js', async ({ page }) => {
    // The built chunk, or the dev server's module and its pre-bundled three.
    const scene = /catStreamScene|\/deps\/three\.js|\/three[-.][\w-]*\.js/i
    const scripts: string[] = []
    page.on('request', (request) => { if (scene.test(new URL(request.url()).pathname)) scripts.push(request.url()) })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openHome(page)
    await page.getByRole('link', { name: CUE }).click()
    await expect(page.locator('#demo')).toBeFocused()
    const stage = page.locator('.es-demo .es')
    await expect(stage).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(1_500)
    await expect(stage).toHaveAttribute('data-beat', '3')
    await expect(stage).not.toHaveAttribute('data-scene', '')
    await expect(page.locator('.es-poster').first()).toBeVisible()
    expect(scripts).toEqual([])
  })
})

test.describe('BrainChat, coming later, under the demo (★ B1)', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await offline(page, baseURL)
  })

  test('draws the chart, swaps the read-out from its pins and links to the demo page', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openHome(page)
    const card = page.getByRole('region', { name: 'BrainChat' })
    await card.scrollIntoViewIfNeeded()
    await expect(card.getByText('Coming later')).toBeVisible()
    const pins = card.getByRole('button', { name: /^Moment \d/ })
    await expect(pins).toHaveCount(3)
    await expect(pins.first()).toHaveAttribute('aria-pressed', 'true')
    const title = card.locator('.sl-bc__read h3')
    const before = await title.textContent()
    await pins.nth(1).click()
    await expect(pins.nth(1)).toHaveAttribute('aria-pressed', 'true')
    await expect(title).not.toHaveText(before ?? '')
    await expect(card.locator('.sl-bc__chart')).not.toHaveAttribute('data-draw', 'ready')
    await expect(card.getByRole('link', { name: 'See the demo' })).toHaveAttribute('href', '/brainchat')
    await assertNoPageOverflow(page)
  })
})
