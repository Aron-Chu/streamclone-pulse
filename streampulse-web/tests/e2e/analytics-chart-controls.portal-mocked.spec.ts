import { expect, test, type Page } from '@playwright/test'
import {
  assertNoUnexpected,
  buildMinutes,
  installPortalAcceptanceHarness,
  openAnalyticsSession,
} from './helpers/portalAcceptanceHarness'

// Owner report (2026-10-08): the range buttons covered the top of the graph,
// the zoom bar did not match the hub's, and Full view on a 12h+ stream drew a
// barcode of ~2px bars. These checks keep all three fixed.
const LONG_STREAM_MINUTES = 748
const CHART = 'svg[aria-label="Analytics timeline chart"]'
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1024, height: 900 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
] as const

type Box = { x: number; y: number; width: number; height: number }
const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

async function openLongSession(page: Page) {
  const harness = await installPortalAcceptanceHarness(page)
  harness.setMinutesPayload(buildMinutes({ count: LONG_STREAM_MINUTES, withEmotes: true }))
  await openAnalyticsSession(page)
  const chart = page.locator(CHART)
  await expect(chart).toHaveCount(1, { timeout: 25_000 })
  await chart.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }))
  return harness
}

const readout = (page: Page) => page.locator('[data-chart-viewport-readout]')

// The harness installs a fake clock; let queued animation frames run.
async function settle(page: Page) {
  const clock = page.clock as { runFor?: (ms: number) => Promise<void> }
  if (typeof clock.runFor === 'function') await clock.runFor(600)
}

for (const viewport of VIEWPORTS) {
  test.describe(`session chart controls at ${viewport.width}px`, () => {
    test.use({ viewport, contextOptions: { reducedMotion: 'reduce' } })

    test('range controls sit above the plot and never cover it', async ({ page }) => {
      const harness = await openLongSession(page)
      const controls = page.locator('[data-chart-viewport-controls]')
      await expect(controls).toBeVisible()
      const plot = await page.locator(CHART).boundingBox()
      const row = await page.locator('[data-chart-range-row]').boundingBox()
      if (!plot || !row) throw new Error('chart or range row has no layout box')
      expect(row.y + row.height, 'range row ends above the plot').toBeLessThanOrEqual(plot.y + 0.5)

      const buttons = controls.locator('button:visible')
      const labels = (await buttons.allTextContents()).map(text => text.trim())
      expect(labels).toEqual(
        viewport.width < 640 ? ['−', '+', '1h', '4h', 'Full'] : ['−', '+', '15m', '1h', '2h', '4h', 'Full'],
      )
      for (const box of await buttons.evaluateAll(nodes => nodes.map(node => {
        const rect = node.getBoundingClientRect()
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      }))) {
        expect(intersects(box, plot), 'range button overlaps the plot').toBe(false)
        expect(box.width).toBeGreaterThanOrEqual(44)
        expect(box.height).toBeGreaterThanOrEqual(44)
        // Nothing is clipped off the side of the card.
        expect(box.x).toBeGreaterThanOrEqual(0)
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
      }
      await assertNoUnexpected(harness)
    })

    test('uses the hub navigator and buckets long-stream bars', async ({ page }) => {
      const harness = await openLongSession(page)
      const host = page.locator('[data-session-chart-navigator]')
      const navigator = host.locator('[data-hub-chart-navigator]')
      await expect(navigator).toBeVisible()
      await expect(navigator.getByRole('slider', { name: 'Chart view start' })).toBeVisible()
      await expect(navigator.getByRole('slider', { name: 'Chart view end' })).toBeVisible()
      await expect(navigator.getByRole('button', { name: 'Reset zoom' })).toBeVisible()
      await expect(navigator.getByRole('button', { name: /Scroll zoom/ })).toHaveAttribute('aria-pressed', 'false')
      await expect(navigator.locator('strong')).toHaveText('Full stream')

      // The navigator track lines up with the plot and sits below it.
      const plot = await page.locator(CHART).boundingBox()
      const track = await navigator.locator('.hx-chart-navigator__track').boundingBox()
      if (!plot || !track) throw new Error('missing layout box')
      expect(track.y).toBeGreaterThan(plot.y + plot.height / 2)
      expect(track.x).toBeGreaterThan(plot.x)
      expect(track.x + track.width).toBeLessThan(plot.x + plot.width)

      const bucketMinutes = Number(await page.locator(CHART).getAttribute('data-activity-bucket-minutes'))
      expect(bucketMinutes).toBeGreaterThan(1)
      await expect(page.locator('[data-chart-bar-bucket-minutes]')).toContainText(`bars ${bucketMinutes}-min avg`)
      const widths = await page.locator(`${CHART} rect[data-activity-bar="chat"]`).evaluateAll(nodes =>
        nodes.map(node => node.getBoundingClientRect().width))
      expect(widths.length).toBeGreaterThan(20)
      // Only the partial bucket at the stream end may be narrower than 3px.
      expect(widths.filter(width => width < 3).length).toBeLessThanOrEqual(2)
      await assertNoUnexpected(harness)
    })
  })
}

test.describe('session chart zoom gestures (desktop)', () => {
  test.use({ viewport: { width: 1440, height: 900 }, contextOptions: { reducedMotion: 'reduce' } })

  test('presets, navigator reset, and Alt + wheel all drive the same view', async ({ page }) => {
    const harness = await openLongSession(page)
    const navigator = page.locator('[data-session-chart-navigator] [data-hub-chart-navigator]')
    const window = () => navigator.getAttribute('data-hub-chart-navigator-window')
    const fullWindow = await window()

    await page.locator('[data-chart-viewport-controls]').getByRole('button', { name: '1h' }).click()
    await settle(page)
    await expect(readout(page)).toHaveText('1h')
    await expect(navigator.locator('strong')).toHaveText('Zoomed view')
    await expect.poll(window).not.toBe(fullWindow)

    await navigator.getByRole('button', { name: 'Reset zoom' }).click()
    await settle(page)
    await expect(readout(page)).toHaveText('Full stream')
    await expect.poll(window).toBe(fullWindow)

    // A plain wheel over the plot scrolls the page while Scroll zoom is off.
    const plot = await page.locator(CHART).boundingBox()
    if (!plot) throw new Error('chart has no layout box')
    await page.mouse.move(plot.x + plot.width / 2, plot.y + plot.height / 2)
    await page.mouse.wheel(0, -200)
    await settle(page)
    await expect(readout(page)).toHaveText('Full stream')

    const box = await page.locator(CHART).boundingBox()
    if (!box) throw new Error('chart has no layout box')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.keyboard.down('Alt')
    await page.mouse.wheel(0, -600)
    await page.keyboard.up('Alt')
    await settle(page)
    await expect(readout(page)).not.toHaveText('Full stream')
    await expect(navigator.locator('strong')).toHaveText('Zoomed view')
    await assertNoUnexpected(harness)
  })
})
