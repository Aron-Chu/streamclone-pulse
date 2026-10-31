import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { installHubUxMock, type HubUxMockOptions } from './helpers/hubUxMock'
import { scrollSceneToProgress } from './helpers/scrollTour'

const proofDirectory = process.env.PORTAL_UX_PROOF_DIR

async function saveProof(target: Locator, name: string) {
  if (!proofDirectory) return
  await mkdir(proofDirectory, { recursive: true })
  await target.screenshot({ path: join(proofDirectory, `${name}.png`), animations: 'disabled' })
}

async function assertNoPageOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
}

async function assertStaticSampleChart(panel: Locator) {
  const chart = panel.locator('.pulse-sparkline-wrap svg')
  await expect(chart).toBeVisible()
  // A populated SVG can still paint nothing when its scroll-driven wipe
  // clips the entire plot. Prove both the actual sample signal and its paint.
  await expect(chart.locator('path[data-chart-series="chat"][data-chart-path-state="overview"]')).toHaveAttribute('d', /^M\s.*[LCQ]/)
  expect(await chart.evaluate(element => getComputedStyle(element).clipPath)).toBe('inset(0px)')
  expect(await panel.locator('.pulse-sparkline-wrap').evaluate(element => getComputedStyle(element, '::after').content)).toBe('none')
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

test('Scroll zoom leaves Ctrl and Meta wheel events to browser zoom on both surfaces', async ({ page }) => {
  await installHubUxMock(page)
  await page.goto('/analytics')
  const navigator = page.getByRole('group', { name: 'Chart navigator', exact: true })
  await expect(navigator.getByRole('status')).toContainText('240 of 240 6-min buckets')
  await expect(navigator.getByRole('button', { name: /^Scroll zoom/ })).toHaveAttribute('aria-pressed', 'true')
  const initial = (await navigator.getAttribute('data-hub-chart-navigator-window'))!
  for (const selector of [HUB_PLOT, '.hx-chart-navigator__track']) {
    for (const modifier of ['ctrlKey', 'metaKey'] as const) {
      // Dispatch a cancellable DOM event to observe app ownership without
      // changing the browser's own zoom or the next test's viewport.
      const consumed = await page.locator(selector).evaluate((element, key) => {
        const rect = element.getBoundingClientRect()
        const event = new WheelEvent('wheel', {
          bubbles: true, cancelable: true, deltaY: -100, [key]: true,
          clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
        })
        element.dispatchEvent(event)
        return event.defaultPrevented
      }, modifier)
      expect(consumed).toBe(false)
      await expect(navigator).toHaveAttribute('data-hub-chart-navigator-window', initial)
    }
  }
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
  test(`Top moments rows and the Channels table fit at ${size}`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await installHubUxMock(page, TOP_MOMENT)
    await page.goto('/analytics')
    await page.evaluate(value => { document.documentElement.style.zoom = String(value) }, zoom)
    const latest = page.locator('#latest')
    const rows = latest.locator('.hv5-tm-list > .hv5-tm-it')
    await expect(rows.first()).toBeVisible()
    expect(await rows.evaluateAll(rows => rows.flatMap(row => {
      const bounds = row.getBoundingClientRect()
      const value = row.querySelector('.hv5-tm-t')!.getBoundingClientRect()
      return value.right <= bounds.right + 1 && value.left >= bounds.left - 1 && bounds.height >= 44 * Number(document.documentElement.style.zoom || 1) - 0.5 ? [] : [row.textContent?.trim()]
    }))).toEqual([])
    const channels = page.locator('#channels')
    const table = channels.locator('table')
    await expect(table.locator('tbody tr').first()).toBeVisible()
    expect(await table.evaluate(el => el.getBoundingClientRect().right <= el.parentElement!.getBoundingClientRect().right + 1)).toBe(true)
    await assertNoPageOverflow(page)
    await saveProof(latest, `hub-v5-top-moments-${size}`)
    await saveProof(channels, `hub-v5-channels-${size}`)
  })

  test(`Homepage static demo uses normal flow and fits at ${size}`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await installHubUxMock(page)
    await page.goto('/#demo')
    await page.evaluate(value => { document.documentElement.style.zoom = String(value) }, zoom)
    const tour = page.locator('.sl-xtour')
    await expect(tour).toHaveAttribute('data-static', '')
    const grid = tour.locator('.sl-xtour__grid')
    const panel = tour.locator('.pulse-landing-panel')
    await expect(panel).toBeVisible()
    await expect(panel.getByRole('tab', { name: 'Pulse' })).toBeVisible()
    await expect(panel.locator('[data-tour-step="4"]')).toBeVisible()
    await assertStaticSampleChart(panel)
    expect(await grid.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      const panel = element.querySelector('.sl-xtour__panel')!.getBoundingClientRect()
      const overview = element.querySelector('.sl-xtour__steps')!
      const overviewBounds = overview.getBoundingClientRect()
      const overviewVisible = overview.getClientRects().length > 0
      return panel.left >= bounds.left - 1 && panel.right <= bounds.right + 1
        && Math.abs((panel.left + panel.right) / 2 - (bounds.left + bounds.right) / 2) < 2
        && (!overviewVisible || panel.top >= overviewBounds.bottom - 1)
    })).toBe(true)
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await assertNoPageOverflow(page)
    await saveProof(panel.locator('[data-tour-step="1"]'), `homepage-sample-chart-${size}`)
    if (proofDirectory) {
      await mkdir(proofDirectory, { recursive: true })
      await page.getByRole('heading', { name: /Pulse tab, feature by feature/i }).scrollIntoViewIfNeeded()
      await page.screenshot({ path: join(proofDirectory, `homepage-demo-viewport-${size}.png`), animations: 'disabled' })
    }
  })
}

test('Homepage animated wipe advances and resizing to short static mode reveals the complete sample', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installHubUxMock(page)
  await page.goto('/#demo')
  const tour = page.locator('.sl-xtour')
  const panel = tour.locator('.pulse-landing-panel')
  const chart = panel.locator('.pulse-sparkline-wrap svg')
  await expect(tour).not.toHaveAttribute('data-static')
  await expect(panel).toHaveAttribute('data-tour-active', '')
  await scrollSceneToProgress(page, .005)
  const earlierClip = await chart.evaluate(element => getComputedStyle(element).clipPath)
  await scrollSceneToProgress(page, .18)
  await expect.poll(() => chart.evaluate(element => getComputedStyle(element).clipPath)).not.toBe(earlierClip)
  await page.setViewportSize({ width: 986, height: 676 })
  await expect(tour).toHaveAttribute('data-static', '')
  await expect(panel).not.toHaveAttribute('data-tour-active')
  await assertStaticSampleChart(panel)
  await assertNoPageOverflow(page)
  await saveProof(panel.locator('[data-tour-step="1"]'), 'homepage-chart-after-animated-resize-986')
})

for (const width of [360, 390, 768, 1024, 1440]) {
  test(`the hub header keeps 44px tap targets and no sideways scroll at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await installHubUxMock(page)
    await page.goto('/analytics')
    await expect(page.locator('.analytics-topnav')).toBeVisible()
    // Add to Chrome is hidden at 720px and below, so only a shown one is measured.
    const targets = await page.locator('.analytics-topnav__links a, .analytics-topnav__install:visible').all()
    expect(targets.length).toBeGreaterThan(0)
    for (const target of targets) {
      const box = await target.boundingBox()
      expect(box?.height).toBeGreaterThanOrEqual(44)
      expect(box?.width).toBeGreaterThanOrEqual(44)
    }
    await assertNoPageOverflow(page)
  })
}

test('Top moments and Channels render while a legacy successful history reply awaits minute repair', async ({ page }) => {
  let releaseRepair!: () => void
  const gate = new Promise<void>(resolve => { releaseRepair = resolve })
  await installHubUxMock(page, { ...TOP_MOMENT, legacySuccessfulCoarseFallback: true, recentHubGate: gate })
  const repairRequested = page.waitForRequest(request => /\/v1\/public\/hub\?/.test(request.url()) && new URL(request.url()).searchParams.get('activityWindow') === '30m')
  await page.goto('/analytics')
  await repairRequested
  try {
    const chart = page.locator('.figma-global-activity__hub-chart')
    await expect(chart.getByText('Loading measured activity…', { exact: true })).toBeVisible()
    await expect(chart.locator('.spc-bar')).toHaveCount(0)
    const rows = page.locator('#latest .hv5-tm-list > .hv5-tm-it')
    await expect(rows.first()).toBeVisible()
    const momentsBefore = await rows.allTextContents()
    const count = page.locator('#channels [data-hv5-channel-count]')
    await expect(count).toHaveText('14 of 96 live')
    await expect(page.locator('#channels tbody tr')).toHaveCount(10)
    releaseRepair()
    await expect(chart.getByText('Loading measured activity…', { exact: true })).toHaveCount(0)
    await expect(chart.locator('.spc-bar')).toHaveCount(30)
    expect(await rows.allTextContents()).toEqual(momentsBefore)
    await expect(count).toHaveText('14 of 96 live')
  } finally {
    releaseRepair()
  }
})
