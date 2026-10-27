import { expect, test, type Page } from '@playwright/test'
import { installHubUxMock } from './helpers/hubUxMock'

// The d3-v5 hub page (behind the build flag). Runs only against a build made with VITE_PUBLIC_HUB_V5=on;
// a default build serves the Command Center, which the spec without .hub-v5 covers.
test.skip(!/^(on|1)$/.test(process.env.VITE_PUBLIC_HUB_V5 ?? ''), 'needs a build with VITE_PUBLIC_HUB_V5=on')

// The hub activity chart on the shared SpChart core (d3 design): hover only
// drives the Now/hover readout, a bar click selects that bar on the plot (the
// shared hub bucket selection, read by the bucket card when it lands), a second
// click or Esc releases it, and nothing in the card moves.
const PLOT = '.figma-global-activity__hub-chart svg[data-bench-plot]'
const READOUT = '.figma-global-activity__hub-chart [data-hub-readout]'

async function plotArea(page: Page) {
  const plot = page.locator(PLOT)
  await plot.scrollIntoViewIfNeeded()
  // The page's section-reveal entrance (a 12 px translate on an ancestor) runs after the scroll; measure at rest.
  let last = NaN
  await expect.poll(async () => {
    const y = (await plot.boundingBox())!.y
    const still = Math.abs(y - last) < 0.01
    last = y
    if (!still) await page.waitForTimeout(250)
    return still
  }).toBe(true)
  const box = (await plot.boundingBox())!
  const width = await page.locator('.figma-global-activity__hub-chart [data-hub-plot-box]').evaluate(el => el.getBoundingClientRect().width)
  return { plot, box, width, at: (fx: number, fy = .55) => ({ x: box.x + width * fx, y: box.y + box.height * fy }) }
}

for (const width of [390, 768, 1080, 1150, 1262, 1440, 1920]) {
  test(`hover stays stable and a click selects a bar without moving the chart at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await installHubUxMock(page)
    const requests: string[] = []
    page.on('request', request => { if (request.url().includes('/hub/moments?')) requests.push(request.url()) })
    await page.goto('/analytics')
    await expect(page.locator(PLOT)).toBeVisible()
    const { plot, box, at } = await plotArea(page)
    const readout = page.locator(READOUT)
    const readoutBefore = (await readout.boundingBox())!
    await page.mouse.move(at(.5).x, at(.5).y)
    await expect(readout).toHaveAttribute('data-hub-readout-mode', 'hover')
    const after = (await plot.boundingBox())!
    expect(after.width).toBeCloseTo(box.width, 0)
    expect(after.height).toBeCloseTo(box.height, 0)
    expect(requests).toHaveLength(0)
    await expect(plot).not.toHaveAttribute('data-selection', /.*/)
    await page.mouse.click(at(.5).x, at(.5).y)
    await expect(plot).toHaveAttribute('data-selection', '')
    const selected = (await plot.boundingBox())!
    expect(selected.y).toBeCloseTo(box.y, 0)
    expect(selected.height).toBeCloseTo(box.height, 0)
    expect((await readout.boundingBox())!.height).toBeCloseTo(readoutBefore.height, 0)
    // Hovering elsewhere previews that bar in the readout and keeps the selection.
    await page.mouse.move(at(.2).x, at(.2).y)
    await expect(readout).toHaveAttribute('data-hub-readout-mode', 'hover')
    await expect(plot).toHaveAttribute('data-selection', '')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await plot.focus()
    await page.keyboard.press('Escape')
    await expect(plot).not.toHaveAttribute('data-selection', /.*/)
  })
}

for (const width of [1440, 1535, 1536, 1920]) {
  test(`Moments sits beside the chart from 1536 px and under it below, keeping the canvas width at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await installHubUxMock(page)
    await page.goto('/analytics')
    const { plot, at } = await plotArea(page)
    await page.mouse.click(at(.5).x, at(.5).y)
    await expect(plot).toHaveAttribute('data-selection', '')
    const canvas = (await plot.boundingBox())!
    expect(canvas.width).toBeGreaterThanOrEqual(720)
    const activity = (await page.locator('#activity').boundingBox())!
    const latest = page.locator('#latest')
    const rail = (await latest.boundingBox())!
    if (width < 1536) {
      await expect(latest).toHaveCSS('position', 'static')
      expect(rail.y).toBeGreaterThanOrEqual(activity.y + activity.height - 1)
    } else {
      await expect(latest).toHaveCSS('position', 'sticky')
      expect(rail.x).toBeGreaterThanOrEqual(activity.x + activity.width - 1)
      expect(rail.width).toBeCloseTo(380, 0)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

for (const zoom of [.8, 1, 1.25, 1.5, 2]) {
  test(`chart zoom stays local and keeps the selected bar at ${zoom * 100}% scaling`, async ({ page }) => {
    await page.setViewportSize({ width: 1370, height: 986 })
    await installHubUxMock(page)
    await page.goto('/analytics')
    await page.evaluate(scale => { document.documentElement.style.zoom = String(scale) }, zoom)
    const plot = page.locator(PLOT)
    await plot.scrollIntoViewIfNeeded()
    // Select from the keyboard cursor: under a root CSS zoom the core maps pointer x
    // without the zoom (ART/core-requests/u06-1.json), so a click can miss the plot.
    await plot.focus()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Enter')
    await expect(plot).toHaveAttribute('data-selection', '')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const navigator = page.getByRole('group', { name: 'Chart navigator', exact: true })
    const controls = navigator.getByRole('group', { name: 'Chart view controls' })
    const initial = await navigator.getAttribute('data-hub-chart-navigator-window')
    const chartRect = await plot.boundingBox()
    const controlsRect = await controls.boundingBox()
    expect(controlsRect!.y).toBeGreaterThanOrEqual(chartRect!.y + chartRect!.height - 1)
    await expect(page.getByRole('button', { name: 'Zoom graph', exact: true })).toHaveCount(0)
    await controls.getByRole('button', { name: 'Zoom in', exact: true }).click()
    await expect(navigator).not.toHaveAttribute('data-hub-chart-navigator-window', initial!)
    await expect(navigator.getByRole('status')).toContainText(/\b\d+ of 240 6-min buckets/)
    await expect(navigator.getByRole('status')).not.toContainText('240 of 240')
    const reset = controls.getByRole('button', { name: 'Reset zoom', exact: true })
    await reset.click()
    await expect(navigator).toHaveAttribute('data-hub-chart-navigator-window', initial!)
    await expect(navigator.getByRole('status')).toContainText('240 of 240 6-min buckets')
    await expect(reset).toHaveAttribute('aria-disabled', 'true')
    await expect(plot).toHaveAttribute('data-selection', '')
    await controls.getByRole('button', { name: 'Zoom in', exact: true }).click()
    await expect(navigator).not.toHaveAttribute('data-hub-chart-navigator-window', initial!)
    await expect(plot).toHaveAttribute('data-selection', '')
    await navigator.locator('.hx-chart-navigator__track').dblclick()
    await expect(navigator).toHaveAttribute('data-hub-chart-navigator-window', initial!)
  })
}

test('explicit zoom reset keeps the selected bar and the Full label', async ({ page }) => {
  await page.setViewportSize({ width: 1262, height: 1000 })
  await installHubUxMock(page)
  await page.goto('/analytics')
  const { plot, at } = await plotArea(page)
  await page.mouse.click(at(.5).x, at(.5).y)
  await expect(plot).toHaveAttribute('data-selection', '')
  const navigator = page.locator('[data-hub-chart-navigator]')
  const label = navigator.locator('.hx-chart-navigator__readout strong')
  await expect(label).toHaveText('Full 24 h')
  const fullWindow = await navigator.getAttribute('data-hub-chart-navigator-window')
  await navigator.getByRole('button', { name: 'Zoom in' }).click()
  await expect(navigator).not.toHaveAttribute('data-hub-chart-navigator-window', fullWindow!)
  await expect(label).not.toHaveText('Full 24 h')
  await navigator.getByRole('button', { name: 'Reset zoom' }).click()
  await expect(navigator).toHaveAttribute('data-hub-chart-navigator-window', fullWindow!)
  await expect(label).toHaveText('Full 24 h')
  await expect(plot).toHaveAttribute('data-selection', '')
})

test('horizontal trackpad motion pans a zoomed chart while vertical scrolling remains available', async ({ page }) => {
  // This checks page scrolling beside the pan, so Scroll zoom is off here (it
  // is on by default since 2026-10-09; the wheel matrix covers that mode).
  await page.addInitScript(() => {
    try { window.localStorage.setItem('sp.chart.scrollZoom.v1', 'off') } catch { /* storage blocked */ }
  })
  await installHubUxMock(page)
  await page.goto('/analytics')
  const plot = page.locator(PLOT)
  const navigator = page.locator('[data-hub-chart-navigator]')
  await expect(plot).toBeVisible()
  const span = (value: string | null) => { const [start, end] = value!.split(':').map(Number); return end! - start! }
  await navigator.getByRole('button', { name: 'Zoom in' }).click()
  await expect(navigator).not.toHaveAttribute('data-hub-chart-navigator-window', '0:239')
  const zoomedWindow = await navigator.getAttribute('data-hub-chart-navigator-window')
  await plot.hover()
  await page.mouse.wheel(400, 0)
  await expect(navigator).not.toHaveAttribute('data-hub-chart-navigator-window', zoomedWindow!)
  // The pan keeps the span; let its easing finish before the vertical wheel.
  await expect.poll(async () => span(await navigator.getAttribute('data-hub-chart-navigator-window'))).toBe(span(zoomedWindow))
  let pannedWindow = await navigator.getAttribute('data-hub-chart-navigator-window')
  await expect.poll(async () => {
    const now = await navigator.getAttribute('data-hub-chart-navigator-window')
    const same = now === pannedWindow
    pannedWindow = now
    return same
  }).toBe(true)

  const scrollBefore = await page.evaluate(() => scrollY)
  await page.mouse.wheel(0, 400)
  await expect(navigator).toHaveAttribute('data-hub-chart-navigator-window', pannedWindow!)
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(scrollBefore)
})

test('reduced motion: the hover readout and the bar selection appear without animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await installHubUxMock(page)
  await page.goto('/analytics')
  const { plot, at } = await plotArea(page)
  await page.mouse.move(at(.5).x, at(.5).y)
  await expect(page.locator(READOUT)).toHaveAttribute('data-hub-readout-mode', 'hover')
  await page.mouse.click(at(.5).x, at(.5).y)
  await expect(plot).toHaveAttribute('data-selection', '')
  const selection = plot.locator('.spc-sel')
  await expect(selection).toHaveCount(1)
  expect(await selection.evaluate(el => getComputedStyle(el).animationName)).toBe('none')
  expect(await page.locator(READOUT).evaluate(el => getComputedStyle(el).animationName)).toBe('none')
})
