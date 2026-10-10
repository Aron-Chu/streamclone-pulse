import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { installHubUxMock } from './helpers/hubUxMock'
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

for (const surface of ['plot', 'navigator track'] as const) {
  test(`Scroll zoom is on by default and remembered, and wheel zooms the ${surface} without refetching or losing selection`, async ({ page }) => {
    await page.setViewportSize({ width: 986, height: 676 })
    const dataRequests: string[] = []
    page.on('request', request => {
      if (/\/v1\/public\/hub(?:\/moments)?\?/.test(request.url())) dataRequests.push(request.url())
    })
    await installHubUxMock(page)
    await page.goto('/analytics')
    const plot = page.locator('.figma-global-activity__hub-chart .hx-chart2')
    const navigator = page.getByRole('group', { name: 'Chart navigator', exact: true })
    const scrollZoom = navigator.getByRole('button', { name: /^Scroll zoom/ })
    const reset = navigator.getByRole('button', { name: 'Reset zoom', exact: true })
    const target = surface === 'plot' ? plot : navigator.locator('.hx-chart-navigator__track')
    await expect(navigator.getByRole('status')).toContainText('240 of 240 buckets')
    // Owner ask (2026-10-09): a plain wheel over the chart zooms by default.
    await expect(scrollZoom).toHaveAttribute('aria-pressed', 'true')
    await expect(scrollZoom).toHaveAttribute('title', 'Remembered in this browser')
    await expect(navigator.getByRole('slider', { name: 'Chart view start' })).toBeVisible()
    await expect(navigator.getByRole('slider', { name: 'Chart view end' })).toBeVisible()
    const initial = (await navigator.getAttribute('data-hub-chart-navigator-window'))!

    const rect = (await plot.boundingBox())!
    await plot.click({ position: { x: rect.width * .5, y: rect.height * .55 } })
    const selected = page.getByRole('region', { name: 'Bucket breakdown' })
    await expect(selected).toBeVisible()
    await expect(page.locator('.activity-bucket-inspector')).toBeVisible()
    const selectedText = (await selected.textContent())!
    const selectedTime = page.locator('.activity-bucket-inspector__summary-header time')
    const selectedBucket = (await selectedTime.getAttribute('datetime'))!
    const barsBefore = await plot.locator('.hx-chat-bar').count()
    const requestsBefore = dataRequests.length
    await moveInto(page, target)
    const zoomScrollY = await page.evaluate(() => window.scrollY)
    await page.mouse.wheel(0, -100)
    await expect(navigator).not.toHaveAttribute('data-hub-chart-navigator-window', initial)
    await expect.poll(() => plot.locator('.hx-chat-bar').count()).toBeLessThan(barsBefore)
    expect(await page.evaluate(() => window.scrollY)).toBe(zoomScrollY)
    await expect(selected).toHaveText(selectedText)
    await expect(selectedTime).toHaveAttribute('datetime', selectedBucket)
    expect(dataRequests.length).toBe(requestsBefore)

    // Reset restores the full range and keeps the selection and the choice.
    await reset.click()
    await expect(navigator).toHaveAttribute('data-hub-chart-navigator-window', initial)
    await expect(scrollZoom).toHaveAttribute('aria-pressed', 'true')
    await expect(reset).toBeDisabled()
    await expect(selected).toHaveText(selectedText)
    await expect(selectedTime).toHaveAttribute('datetime', selectedBucket)

    await moveInto(page, target)
    await page.mouse.wheel(0, -100)
    await expect(navigator).not.toHaveAttribute('data-hub-chart-navigator-window', initial)
    if (surface === 'plot') {
      // Escape on the plot releases the selected bucket first, then restores the full range.
      await plot.focus()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('status').filter({ hasText: 'Bucket selection cleared' })).toHaveCount(1)
      await expect(selected).toBeHidden()
      await expect(navigator).not.toHaveAttribute('data-hub-chart-navigator-window', initial)
      await page.keyboard.press('Escape')
    } else {
      // Escape on a navigator slider restores the full range and keeps the selection.
      await navigator.getByRole('slider', { name: 'Chart view start' }).focus()
      await page.keyboard.press('Escape')
      await expect(selected).toHaveText(selectedText)
      await expect(selectedTime).toHaveAttribute('datetime', selectedBucket)
    }
    await expect(navigator).toHaveAttribute('data-hub-chart-navigator-window', initial)
    await expect(scrollZoom).toHaveAttribute('aria-pressed', 'true')
    expect(dataRequests.length).toBe(requestsBefore)

    // Off is remembered across a reload; then a plain wheel scrolls the page.
    await scrollZoom.click()
    await expect(scrollZoom).toHaveAttribute('aria-pressed', 'false')
    await page.reload()
    await expect(navigator.getByRole('status')).toContainText('240 of 240 buckets')
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
  await expect(navigator.getByRole('status')).toContainText('240 of 240 buckets')
  await expect(navigator.getByRole('button', { name: /^Scroll zoom/ })).toHaveAttribute('aria-pressed', 'true')
  const initial = (await navigator.getAttribute('data-hub-chart-navigator-window'))!
  for (const selector of ['.figma-global-activity__hub-chart .hx-chart2', '.hx-chart-navigator__track']) {
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
  await expect(navigator.getByRole('status')).toContainText('240 of 240 buckets')
  const series = page.locator('.figma-global-activity__hub-chart [data-component="HubActivityBarSeries"]')
  await expect(series).toHaveAttribute('data-hub-bar-span', /^(2|5|10)$/)
  const span = Number(await series.getAttribute('data-hub-bar-span'))
  const bars = series.locator('[data-bar-span]')
  expect(await bars.count()).toBeLessThanOrEqual(Math.ceil(240 / span) + 1)
  expect(await bars.count()).toBeGreaterThan(20)
  const widths = await series.locator('[data-bar-span] .hx-chat-bar').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().width))
  expect(widths.filter(width => width < 3).length, 'merged bars stay readable').toBeLessThanOrEqual(2)
  await expect(navigator.locator('[data-chart-bar-bucket-minutes]')).toContainText(/^bars \d+(\.\d)?-(min|h) avg$/)
  await assertNoPageOverflow(page)
})

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
  test(`Moment Inspector actions and minute emote values fit at ${size}`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await installHubUxMock(page)
    const firstResponse = page.waitForResponse(response => /\/v1\/public\/hub\?/.test(response.url()))
    await page.goto('/analytics')
    const payload = await (await firstResponse).json()
    for (const emote of payload.livePulseMoments[0].topEmotes) delete emote.sharePct
    await page.route(/\/v1\/public\/hub(\?.*)?$/, route => route.fulfill({ json: payload }))
    await page.reload()
    await page.evaluate(value => { document.documentElement.style.zoom = String(value) }, zoom)
    await page.locator('.pulse-moments__peak-row, .pulse-moments__leaderboard-row').first().click()
    const inspector = page.locator('.pulse-moments-live__side .pulse-moments__inspector')
    const actions = inspector.getByRole('group', { name: 'Moment actions' })
    await expect(actions.getByRole('link', { name: 'Review moment' })).toBeVisible()
    await expect(actions.getByRole('link', { name: 'Open analytics' })).toBeVisible()
    await expect(actions.getByRole('button', { name: 'Copy moment link' })).toBeVisible()
    const actionFailures = await actions.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      const buttons = Array.from(element.querySelectorAll('a, button')).map(button => ({ name: button.textContent?.trim(), rect: button.getBoundingClientRect() }))
      return buttons.flatMap((button, index) => {
        const failure = button.rect.left < bounds.left - 1 || button.rect.right > bounds.right + 1 || button.rect.height < 44 || button.rect.width < 44
        const overlaps = buttons.slice(index + 1).some(other => button.rect.left < other.rect.right - 1 && button.rect.right > other.rect.left + 1 && button.rect.top < other.rect.bottom - 1 && button.rect.bottom > other.rect.top + 1)
        return failure || overlaps ? [button.name] : []
      })
    })
    expect(actionFailures).toEqual([])
    const emotes = page.getByRole('region', { name: 'Selected minute emotes' })
    await expect(emotes.locator('.emote-rank-row__count').first()).toBeVisible()
    await expect(emotes.getByText('Estimated shares use available counts')).toBeVisible()
    await expect(emotes.getByText('est.', { exact: true })).toHaveCount(2)
    expect(await emotes.locator('li.emote-rank-row').evaluateAll(rows => rows.flatMap(row => {
      const bounds = row.getBoundingClientRect()
      const count = row.querySelector('.emote-rank-row__count')!.getBoundingClientRect()
      const share = row.querySelector('.emote-rank-row__share-cell')!.getBoundingClientRect()
      return count.right <= share.left + 1 && share.right <= bounds.right + 1 && count.left >= bounds.left - 1 ? [] : [row.textContent?.trim()]
    }))).toEqual([])
    await assertNoPageOverflow(page)
    await saveProof(actions, `moment-actions-${size}`)
    await saveProof(emotes, `minute-emotes-${size}`)
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

test('Live moments and roster render while a legacy successful history reply awaits minute repair', async ({ page }) => {
  let releaseRepair!: () => void
  const gate = new Promise<void>(resolve => { releaseRepair = resolve })
  await installHubUxMock(page, { legacySuccessfulCoarseFallback: true, recentHubGate: gate })
  const repairRequested = page.waitForRequest(request => /\/v1\/public\/hub\?/.test(request.url()) && new URL(request.url()).searchParams.get('activityWindow') === '30m')
  await page.goto('/analytics')
  await repairRequested
  try {
    const chart = page.locator('.figma-global-activity__hub-chart')
    await expect(chart.getByText('Loading measured activity…', { exact: true })).toBeVisible()
    await expect(chart.locator('.hx-chat-bar')).toHaveCount(0)
    const moments = page.locator('.pulse-moments-live')
    const rows = moments.locator('.pulse-moments__peak-row, .pulse-moments__leaderboard-row')
    await expect(rows.first()).toBeVisible()
    const momentsBefore = await rows.allTextContents()
    const roster = page.locator('.live-channels-matrix')
    await expect(roster.locator('.live-channels-matrix__result-count')).toHaveText('14 channels tracked')
    await expect(roster.getByText(/14 roster live/)).toBeVisible()
    releaseRepair()
    await expect(chart.getByText('Loading measured activity…', { exact: true })).toHaveCount(0)
    await expect(chart.locator('.hx-chat-bar')).toHaveCount(30)
    expect(await rows.allTextContents()).toEqual(momentsBefore)
    await expect(roster.locator('.live-channels-matrix__result-count')).toHaveText('14 channels tracked')
  } finally {
    releaseRepair()
  }
})
