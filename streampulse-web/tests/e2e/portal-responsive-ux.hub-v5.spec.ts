import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { installHubUxMock, type HubUxMockOptions } from './helpers/hubUxMock'

const proofDirectory = process.env.PORTAL_UX_PROOF_DIR

async function saveProof(target: Locator, name: string) {
  if (!proofDirectory) return
  await mkdir(proofDirectory, { recursive: true })
  await target.screenshot({ path: join(proofDirectory, `${name}.png`), animations: 'disabled' })
}

async function assertNoPageOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
}

async function moveInto(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded()
  const rect = (await target.boundingBox())!
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2)
}

const HUB_PLOT = '.figma-global-activity__hub-chart svg[data-bench-plot]'

for (const surface of ['plot', 'navigator track'] as const) {
  test(`Scroll zoom is on by default and remembered, and wheel zooms the ${surface} without refetching or losing selection`, async ({ page }) => {
    await page.setViewportSize({ width: 986, height: 676 })
    const dataRequests: string[] = []
    page.on('request', request => {
      if (/\/v1\/public\/hub(?:\/moments)?\?/.test(request.url())) dataRequests.push(request.url())
    })
    await installHubUxMock(page)
    await page.goto('/analytics')
    const plot = page.locator(HUB_PLOT)
    const navigator = page.getByRole('group', { name: 'Chart navigator', exact: true })
    const scrollZoom = navigator.getByRole('button', { name: /^Scroll zoom/ })
    const reset = navigator.getByRole('button', { name: 'Reset zoom', exact: true })
    const target = surface === 'plot' ? plot : navigator.locator('.hx-chart-navigator__track')
    await expect(navigator.getByRole('status')).toContainText('240 of 240 6-min buckets')
    // Owner ask (2026-10-09): a plain wheel over the chart zooms by default.
    await expect(scrollZoom).toHaveAttribute('aria-pressed', 'true')
    await expect(scrollZoom).toHaveAttribute('title', 'Remembered in this browser')
    await expect(navigator.getByRole('slider', { name: 'Chart view start' })).toBeVisible()
    await expect(navigator.getByRole('slider', { name: 'Chart view end' })).toBeVisible()
    const initial = (await navigator.getAttribute('data-hub-chart-navigator-window'))!

    // A bar click selects that bar on the plot (the shared hub bucket selection).
    await plot.scrollIntoViewIfNeeded()
    const rect = (await plot.boundingBox())!
    await plot.click({ position: { x: rect.width * .5, y: rect.height * .55 } })
    await expect(plot).toHaveAttribute('data-selection', '')
    const requestsBefore = dataRequests.length
    await moveInto(page, target)
    const zoomScrollY = await page.evaluate(() => window.scrollY)
    await page.mouse.wheel(0, -100)
    await expect(navigator).not.toHaveAttribute('data-hub-chart-navigator-window', initial)
    expect(await page.evaluate(() => window.scrollY)).toBe(zoomScrollY)
    await expect(plot).toHaveAttribute('data-selection', '')
    expect(dataRequests.length).toBe(requestsBefore)

    // Reset restores the full range and keeps the selection and the choice.
    await reset.click()
    await expect(navigator).toHaveAttribute('data-hub-chart-navigator-window', initial)
    await expect(scrollZoom).toHaveAttribute('aria-pressed', 'true')
    await expect(reset).toHaveAttribute('aria-disabled', 'true')
    await expect(plot).toHaveAttribute('data-selection', '')

    await moveInto(page, target)
    await page.mouse.wheel(0, -100)
    await expect(navigator).not.toHaveAttribute('data-hub-chart-navigator-window', initial)
    if (surface === 'plot') {
      // Escape on the plot releases the selected bar and leaves the zoom alone (the d3 design: the page owns Esc).
      await plot.focus()
      await page.keyboard.press('Escape')
      await expect(plot).not.toHaveAttribute('data-selection', /.*/)
      await expect(navigator).not.toHaveAttribute('data-hub-chart-navigator-window', initial)
      await reset.click()
    } else {
      // Escape on a navigator slider restores the full range and keeps the selection.
      await navigator.getByRole('slider', { name: 'Chart view start' }).focus()
      await page.keyboard.press('Escape')
      await expect(plot).toHaveAttribute('data-selection', '')
    }
    await expect(navigator).toHaveAttribute('data-hub-chart-navigator-window', initial)
    await expect(scrollZoom).toHaveAttribute('aria-pressed', 'true')
    expect(dataRequests.length).toBe(requestsBefore)

    // Off is remembered across a reload; then a plain wheel scrolls the page.
    await scrollZoom.click()
    await expect(scrollZoom).toHaveAttribute('aria-pressed', 'false')
    await page.reload()
    await expect(navigator.getByRole('status')).toContainText('240 of 240 6-min buckets')
    await expect(scrollZoom).toHaveAttribute('aria-pressed', 'false')
    await moveInto(page, target)
    const beforePageScroll = await page.evaluate(() => window.scrollY)
    await page.mouse.wheel(0, 150)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(beforePageScroll)
    await expect(navigator).toHaveAttribute('data-hub-chart-navigator-window', initial)
    await assertNoPageOverflow(page)
    await saveProof(navigator, `chart-controls-${surface.replace(' ', '-')}-986`)
  })
}

// S1 (11-19): over the hub chart Ctrl+wheel zooms the chart, as a map does (a trackpad pinch arrives as one, so it
// zooms the chart too). Meta+wheel, and Ctrl+wheel anywhere off the chart, stay the browser's own zoom.
test('Ctrl+wheel over the hub chart zooms the chart; Meta+wheel and Ctrl+wheel off it stay the browser zoom (S1, 11-19)', async ({ page }) => {
  await installHubUxMock(page)
  await page.goto('/analytics')
  const navigator = page.getByRole('group', { name: 'Chart navigator', exact: true })
  await expect(navigator.getByRole('status')).toContainText('240 of 240 6-min buckets')
  await expect(navigator.getByRole('button', { name: /^Scroll zoom/ })).toHaveAttribute('aria-pressed', 'true')
  const initial = (await navigator.getAttribute('data-hub-chart-navigator-window'))!
  // A cancellable DOM event shows who owns it without changing the browser's own zoom or the next test's viewport.
  const consumed = (selector: string, key: 'ctrlKey' | 'metaKey') => page.locator(selector).first().evaluate((element, modifier) => {
    const rect = element.getBoundingClientRect()
    const event = new WheelEvent('wheel', {
      bubbles: true, cancelable: true, deltaY: -100, [modifier]: true,
      clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
    })
    element.dispatchEvent(event)
    return event.defaultPrevented
  }, key)
  for (const selector of [HUB_PLOT, '.hx-chart-navigator__track']) {
    expect(await consumed(selector, 'metaKey')).toBe(false)
    await expect(navigator).toHaveAttribute('data-hub-chart-navigator-window', initial)
  }
  expect(await consumed('#busiest', 'ctrlKey')).toBe(false)
  await expect(navigator).toHaveAttribute('data-hub-chart-navigator-window', initial)
  expect(await consumed(HUB_PLOT, 'ctrlKey')).toBe(true)
  await expect(navigator).not.toHaveAttribute('data-hub-chart-navigator-window', initial)
})

test('on a phone the hub merges its chat bars so each stays readable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await installHubUxMock(page)
  await page.goto('/analytics')
  const navigator = page.getByRole('group', { name: 'Chart navigator', exact: true })
  await expect(navigator.getByRole('status')).toContainText('240 of 240 6-min buckets')
  // Bars merge in whole multiples of the served 6-minute bucket (never a hard-coded size).
  const plot = page.locator(HUB_PLOT)
  const minutes = Number(await plot.getAttribute('data-activity-bucket-minutes'))
  expect(minutes % 6).toBe(0)
  const span = minutes / 6
  expect(span).toBeGreaterThan(1)
  const bars = plot.locator('.spc-bar')
  expect(await bars.count()).toBeLessThanOrEqual(Math.ceil(240 / span) + 1)
  expect(await bars.count()).toBeGreaterThan(20)
  const widths = await bars.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().width))
  expect(widths.filter(width => width < 3).length, 'merged bars stay readable').toBeLessThanOrEqual(2)
  await expect(navigator.getByRole('status')).toContainText(`bars ${minutes}-min`)
  await assertNoPageOverflow(page)
})

// Top moments today lists, from the hub, a moment from 20 minutes into its stream that rose
// 1.5x or more over that stream's own average. The mock's moments are 2 and 4 minutes in with
// no comparison, so the Top moments checks serve the first one an hour in, compared.
const TOP_MOMENT: HubUxMockOptions = { withComparisons: true, momentOffsets: [3600, 3600] }

const responsiveCases = [
  { width: 390, height: 800, zoom: 1 },
  { width: 768, height: 676, zoom: 1 },
  { width: 986, height: 676, zoom: 1 },
  { width: 986, height: 676, zoom: 1.25 },
  { width: 1440, height: 676, zoom: 1 },
  { width: 1440, height: 676, zoom: 1.5 },
]

for (const { width, height, zoom } of responsiveCases) {
  const size = `${width}x${height}-zoom${zoom}`
  test(`Top moments today, Picking up now and the Channels table fit at ${size}`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await installHubUxMock(page, TOP_MOMENT)
    await page.goto('/analytics')
    await page.evaluate(value => { document.documentElement.style.zoom = String(value) }, zoom)
    const big = page.locator('#top-moments')
    const card = big.locator('.hv5-tm-list > .hv5-tm-it').first()
    await expect(card).toBeVisible()
    expect(await card.evaluate(el => {
      const bounds = el.getBoundingClientRect()
      const stage = el.closest('#top-moments')!.getBoundingClientRect()
      const time = el.querySelector('.hv5-tm-t')!.getBoundingClientRect()
      return bounds.right <= stage.right + 1 && time.right <= bounds.right + 1 && time.left >= bounds.left - 1
    })).toBe(true)
    const latest = page.locator('#latest')
    await expect(latest.getByRole('heading', { name: 'Picking up now' })).toBeVisible()
    expect(await latest.locator('.hv5-fd').evaluateAll(rows => rows.flatMap(row => {
      const bounds = row.getBoundingClientRect()
      const value = row.querySelector('.hv5-fd-tx')!.getBoundingClientRect()
      return value.right <= bounds.right + 1 && value.left >= bounds.left - 1 ? [] : [row.textContent?.trim()]
    }))).toEqual([])
    const channels = page.locator('#channels')
    const table = channels.locator('table')
    await expect(table.locator('tbody tr').first()).toBeVisible()
    expect(await table.evaluate(el => el.getBoundingClientRect().right <= el.parentElement!.getBoundingClientRect().right + 1)).toBe(true)
    await assertNoPageOverflow(page)
    await saveProof(big, `hub-v5-top-moments-${size}`)
    await saveProof(latest, `hub-v5-picking-up-${size}`)
    await saveProof(channels, `hub-v5-channels-${size}`)
  })

  test(`Homepage demo beside Twitch chat fits its column at ${size}`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await installHubUxMock(page)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/#demo')
    await page.evaluate(value => { document.documentElement.style.zoom = String(value) }, zoom)
    const demo = page.locator('.es-demo')
    const stage = demo.locator('.es')
    await page.locator('#demo .sl-container > div:nth-child(2)').scrollIntoViewIfNeeded()
    await expect(stage).toBeVisible()
    // Under reduced motion it holds one still step: the camera in on the extension's column.
    await expect(stage).toHaveAttribute('data-beat', '3')
    await expect(page.getByRole('group', { name: 'Demo steps' })).toBeVisible()
    expect(await stage.evaluate(element => {
      const column = element.closest('.sl-container')!
      const style = getComputedStyle(column)
      const outer = column.getBoundingClientRect()
      const left = outer.left + parseFloat(style.paddingLeft)
      const right = outer.right - parseFloat(style.paddingRight)
      const box = element.getBoundingClientRect()
      return box.left >= left - 1 && box.right <= right + 1 && Math.abs((box.left + box.right) / 2 - (left + right) / 2) < 2
    })).toBe(true)
    expect(await stage.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await assertNoPageOverflow(page)
    await saveProof(stage, `homepage-demo-${size}`)
    if (proofDirectory) {
      await mkdir(proofDirectory, { recursive: true })
      await page.getByRole('heading', { name: /See it beside Twitch chat/i }).scrollIntoViewIfNeeded()
      await page.screenshot({ path: join(proofDirectory, `homepage-demo-viewport-${size}.png`), animations: 'disabled' })
    }
  })
}

test('Homepage demo plays on its own and keeps its shape through a resize', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installHubUxMock(page)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/')
  await page.locator('#demo .sl-container > div:nth-child(2)').scrollIntoViewIfNeeded()
  const demo = page.locator('.es-demo')
  const stage = demo.locator('.es')
  await expect(stage).toBeVisible()
  await expect(stage).toHaveAttribute('data-beat', '1', { timeout: 10_000 })
  await expect(demo).toHaveAttribute('data-cap', 'beside')
  await page.setViewportSize({ width: 860, height: 676 })
  await expect.poll(() => stage.evaluate(element => {
    const box = element.getBoundingClientRect()
    return box.width < 860 && Math.abs(box.height - Math.round(box.width * 700 / 1120)) <= 1
  })).toBe(true)
  // At this width the caption no longer fits beside the column: it goes under the stage.
  await expect(demo).toHaveAttribute('data-cap', 'below')
  await expect(page.locator('.es-steps-cap')).toBeVisible()
  await assertNoPageOverflow(page)
  await saveProof(stage, 'homepage-demo-after-resize-860')
})

for (const width of [360, 390, 768, 1024, 1440]) {
  test(`the hub header keeps 44px tap targets and no sideways scroll at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await installHubUxMock(page)
    await page.goto('/analytics')
    const bar = page.locator('.analytics-topnav')
    await expect(bar).toBeVisible()
    // Below 720px the page links move into the menu and Add to Chrome hides,
    // so only what is shown is measured: links, install, Discord, the menu button.
    const trigger = bar.getByRole('button', { name: 'Navigation menu' })
    await expect(trigger).toBeVisible()
    const shown = await bar.locator('.analytics-topnav__links a:visible, .analytics-topnav__install:visible, .analytics-topnav__discord:visible').all()
    // From 720px the three page links sit on the bar; below it they are hidden, not squeezed.
    if (width < 720) await expect(bar.locator('.analytics-topnav__links')).toBeHidden()
    else await expect(bar.locator('.analytics-topnav__links a:visible')).toHaveCount(3)
    const expectTapTarget = async (target: Locator, name: string) => {
      const box = await target.boundingBox()
      expect(box, name).not.toBeNull()
      expect(box!.height, name).toBeGreaterThanOrEqual(44)
      expect(box!.width, name).toBeGreaterThanOrEqual(44)
      expect(box!.x, name).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width, name).toBeLessThanOrEqual(width + 1)
    }
    for (const target of [...shown, trigger]) await expectTapTarget(target, (await target.textContent())?.trim() || 'header control')
    await assertNoPageOverflow(page)
    // The menu: at every width it holds the site information; on phones the page links too.
    await trigger.click()
    const menu = bar.locator('.analytics-topnav__more-links')
    await expect(menu).toHaveAttribute('data-state', 'open')
    await expect(menu).toHaveCSS('opacity', '1')
    const menuLinks = await menu.locator('a:visible').all()
    expect(menuLinks.length).toBeGreaterThanOrEqual(width < 720 ? 7 : 4)
    for (const link of menuLinks) await expectTapTarget(link, `menu: ${(await link.textContent())?.trim()}`)
    await expect(menu.getByRole('link', { name: 'Help', exact: true })).toHaveCount(width < 720 ? 1 : 0)
    await assertNoPageOverflow(page)
  })
}

test('Top moments and Channels render while a legacy successful history reply awaits minute repair', async ({ page }) => {
  let releaseRepair!: () => void
  const gate = new Promise<void>(resolve => { releaseRepair = resolve })
  await installHubUxMock(page, { ...TOP_MOMENT, legacySuccessfulCoarseFallback: true, recentHubGate: gate })
  // a live card loads Twitch's live picture and then says "picture: stream now" (11-22); keep Twitch out of this test
  // so the cards' words change only if the repair changes them
  await page.route(/^https:\/\/static-cdn\.jtvnw\.net\/previews-ttv\//, (route) => route.abort())
  const repairRequested = page.waitForRequest(request => /\/v1\/public\/hub\?/.test(request.url()) && new URL(request.url()).searchParams.get('activityWindow') === '30m')
  await page.goto('/analytics')
  await repairRequested
  try {
    const chart = page.locator('.figma-global-activity__hub-chart')
    await expect(chart.getByText('Loading measured activity…', { exact: true })).toBeVisible()
    await expect(chart.locator('.spc-bar')).toHaveCount(0)
    const rows = page.locator('#top-moments .hv5-tm-list > .hv5-tm-it')
    await expect(rows.first()).toBeVisible()
    const momentsBefore = await rows.allTextContents()
    const count = page.locator('#channels [data-hv5-channel-count]')
    await expect(count).toHaveText('Showing 14 of 96 live')
    await expect(page.locator('#channels tbody tr')).toHaveCount(10)
    releaseRepair()
    await expect(chart.getByText('Loading measured activity…', { exact: true })).toHaveCount(0)
    await expect(chart.locator('.spc-bar')).toHaveCount(30)
    expect(await rows.allTextContents()).toEqual(momentsBefore)
    await expect(count).toHaveText('Showing 14 of 96 live')
  } finally {
    releaseRepair()
  }
})
