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
// Owner ask (2026-10-09): "the -+ zoom stuff can be the same as the global
// activity chart": -, +, Reset and Scroll zoom live only in the navigator.
// D1 (2026-10-13, plan §1.2): the d3 toolbar adds exactly one range seg
// (15m/1h/2h/4h/Full), end-anchored; there is no second -/+ group.
const LONG_STREAM_MINUTES = 748
// F21 (session-original): a 748-minute stream fits one bar per minute at 1440 px (1.05 px a
// minute). The bucketing checks run where it opens on coarser bars (2-minute bars at 768 px);
// the live fixture can't hold a longer stream (minutes stop at the harness clock).
const COARSE_VIEWPORT = { width: 768, height: 1024 } as const
const CHART = 'svg[aria-label="Analytics timeline chart"]'
const AREA = `${CHART} rect[data-chart-touch-action]`
const NAV = '[data-session-chart-navigator] [data-hub-chart-navigator]'
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

const readout = (page: Page) => page.locator(`${NAV} strong`)
const navigatorWindow = (page: Page) => page.locator(NAV).getAttribute('data-hub-chart-navigator-window')

// The harness installs a fake clock; let queued animation frames run.
async function settle(page: Page) {
  await page.waitForTimeout(50)
  const clock = page.clock as { runFor?: (ms: number) => Promise<void> }
  if (typeof clock.runFor === 'function') await clock.runFor(600)
}

/** "4:00:00" or "04:00:00" -> seconds. */
const secondsOf = (text: string | null | undefined) => {
  const m = text?.match(/(\d+):(\d\d):(\d\d)/)
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null
}

async function boxOf(page: Page, selector: string): Promise<Box> {
  const box = await page.locator(selector).first().boundingBox()
  if (!box) throw new Error(`${selector} has no layout box`)
  return box
}

for (const viewport of VIEWPORTS) {
  test.describe(`session chart controls at ${viewport.width}px`, () => {
    test.use({ viewport, contextOptions: { reducedMotion: 'reduce' } })

    test('zoom controls sit below the plot and never cover it; one range seg is the only preset UI', async ({ page }) => {
      const harness = await openLongSession(page)
      await expect(page.locator('[data-chart-viewport-controls]')).toHaveCount(0)
      await expect(page.locator('[data-chart-range-row]')).toHaveCount(0)
      await expect(page.locator('[data-session-range-seg]')).toHaveCount(1)
      // No second - / + group anywhere on the page.
      await expect(page.getByRole('button', { name: 'Zoom in' })).toHaveCount(1)
      await expect(page.getByRole('button', { name: 'Zoom out' })).toHaveCount(1)
      const toolbar = page.locator(`${NAV} .hx-chart-navigator__toolbar`)
      await expect(toolbar).toBeVisible()
      const plot = await boxOf(page, CHART)
      const toolbarBox = await boxOf(page, `${NAV} .hx-chart-navigator__toolbar`)
      expect(toolbarBox.y, 'zoom toolbar starts below the plot').toBeGreaterThanOrEqual(plot.y + plot.height - 0.5)

      const buttons = toolbar.locator('button:visible')
      const names = await buttons.evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label') ?? node.textContent?.trim() ?? ''))
      // d3-v2 session-original: the hint and Scroll zoom sit in the (i); Reset hides at the full range.
      expect(names).toEqual(['Zoom out', 'Zoom in', 'How to zoom and pan the chart'])
      for (const { box, hit } of await buttons.evaluateAll(nodes => nodes.map(node => {
        const rect = node.getBoundingClientRect()
        // The (i) is a 24 px box whose ::after reaches the 44 px hit row.
        const after = getComputedStyle(node, '::after')
        const grow = after.position === 'absolute' ? Math.max(0, -parseFloat(after.top) || 0) : 0
        return {
          box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          hit: { width: rect.width + 2 * grow, height: rect.height + 2 * grow },
        }
      }))) {
        expect(intersects(box, plot), 'zoom button overlaps the plot').toBe(false)
        // The d3 control row: 32 px buttons (hit rows reach 44 px through the row).
        expect(hit.width).toBeGreaterThanOrEqual(32)
        expect(hit.height).toBeGreaterThanOrEqual(32)
        // Nothing is clipped off the side of the card.
        expect(box.x).toBeGreaterThanOrEqual(0)
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
      }
      // Scroll zoom is on by default (owner ask, 2026-10-09) and remembered in this browser.
      const info = toolbar.getByRole('button', { name: 'How to zoom and pan the chart' })
      await info.click()
      await expect(toolbar.getByRole('button', { name: /Scroll zoom/ })).toHaveText('Scroll zoomOn')
      await page.keyboard.press('Escape')
      await expect(info).toHaveAttribute('aria-expanded', 'false')
      await expect(info).toBeFocused()
      await assertNoUnexpected(harness)
    })

    test('uses the hub navigator and buckets long-stream bars', async ({ page }) => {
      const harness = await openLongSession(page)
      const navigator = page.locator(NAV)
      await expect(navigator).toBeVisible()
      await expect(navigator.getByRole('slider', { name: 'Chart view start' })).toBeVisible()
      await expect(navigator.getByRole('slider', { name: 'Chart view end' })).toBeVisible()
      // Reset hides while the whole stream shows (d3-v2 session-original); the hint and Scroll zoom wait in the (i).
      await expect(navigator.getByRole('button', { name: 'Reset zoom' })).toBeHidden()
      await expect(navigator.locator('.hx-chart-navigator__hint')).toBeHidden()
      await navigator.getByRole('button', { name: 'How to zoom and pan the chart' }).click()
      await expect(navigator.getByRole('button', { name: /Scroll zoom/ })).toHaveAttribute('aria-pressed', 'true')
      await expect(navigator.locator('.hx-chart-navigator__hint')).toHaveText('Scroll over the chart to zoom · Shift + scroll to pan · Drag the purple bar to pick a span')
      await page.keyboard.press('Escape')
      await expect(navigator.locator('.hx-chart-navigator__hint')).toBeHidden()
      await expect(readout(page)).toHaveText('Full stream')

      // The plot area, its time axis and the navigator track share their left
      // and right edges; the toolbar row and the plot svg (with its value-axis
      // column) share the part's edges.
      const edges = await page.evaluate(() => {
        const of = (selector: string) => {
          const rect = document.querySelector(selector)?.getBoundingClientRect()
          return rect ? { left: rect.left, right: rect.right } : null
        }
        return {
          part: of('[data-session-chart-part]'),
          focusBar: of('[data-session-chart-part] [data-chart-focus-bar]'),
          svg: of('svg[aria-label="Analytics timeline chart"]'),
          area: of('svg[aria-label="Analytics timeline chart"] rect[data-chart-touch-action]'),
          axis: of('[data-session-chart-part] [data-bench-axis]'),
          zoomBar: of('[data-session-chart-navigator] .hx-chart-navigator__track'),
          controls: of('[data-session-chart-navigator] .hx-chart-navigator__actions'),
        }
      })
      for (const [name, box] of Object.entries(edges)) if (!box) throw new Error(`${name} has no layout box`)
      const e = edges as Record<keyof typeof edges, { left: number; right: number }>
      for (const part of ['focusBar', 'svg'] as const) {
        expect(Math.abs(e[part].left - e.part.left), `${part} left edge matches the part`).toBeLessThanOrEqual(2)
        expect(Math.abs(e[part].right - e.part.right), `${part} right edge matches the part`).toBeLessThanOrEqual(2)
      }
      for (const part of ['axis', 'zoomBar', 'controls'] as const) {
        expect(Math.abs(e[part].left - e.area.left), `${part} left edge matches the plot area`).toBeLessThanOrEqual(2)
        expect(Math.abs(e[part].right - e.area.right), `${part} right edge matches the plot area`).toBeLessThanOrEqual(2)
      }

      // The track sits below the plot.
      const plot = await boxOf(page, CHART)
      const track = await boxOf(page, `${NAV} .hx-chart-navigator__track`)
      expect(track.y).toBeGreaterThan(plot.y + plot.height / 2)

      // Scale values read in the caption chip inside the plot, never as SVG text.
      await expect(page.locator(`${CHART} text`, { hasText: /^PEAK$/ })).toHaveCount(0)
      // Lanes (d3-v2 session-original): each lane's caption chip reads its peak and average.
      const peakChip = page.locator('[data-chart-lane-caption="chat"] [data-chart-scale-value="chat-peak"]')
      await expect(peakChip).toBeVisible()
      const peak = await peakChip.boundingBox()
      if (!peak) throw new Error('peak has no layout box')
      expect(peak.x - e.area.left, 'Peak clears the focus ring at the plot edge').toBeGreaterThanOrEqual(4)

      // F21 (2026-10-15, session-original): the hosted portal's bars, one per minute down to
      // 1.05 px a minute (0.85 tolerance on the first pick), then 2, 5, 10 ... minute bars.
      const bucketMinutes = Number(await page.locator(CHART).getAttribute('data-activity-bucket-minutes'))
      expect(bucketMinutes).toBeGreaterThanOrEqual(1)
      await expect(page.locator('[data-chart-bar-bucket-minutes]')).toHaveText(`${bucketMinutes}-min bars`)
      // The chat lane's bars (the emotes lane draws the same slots).
      const bars = await page.locator(`${CHART} g[data-lane="chat"] rect.spc-bar`).evaluateAll(nodes =>
        nodes.map(node => { const r = node.getBoundingClientRect(); return { x: r.x + r.width / 2, width: r.width } }))
      expect(bars.length).toBeGreaterThan(20)
      expect(bars.length).toBeLessThanOrEqual(Math.ceil(LONG_STREAM_MINUTES / bucketMinutes))
      // The prod rule never draws a bar under 1 px, and no two bars sit closer than the slot floor.
      expect(Math.min(...bars.map(bar => bar.width))).toBeGreaterThanOrEqual(0.99)
      const centres = [...new Set(bars.map(bar => bar.x))].sort((p, q) => p - q)
      const pitch = Math.min(...centres.slice(1).map((x, k) => x - centres[k]!))
      expect(pitch, 'bar pitch').toBeGreaterThanOrEqual(1.05 * 0.85 - 0.01)
      await assertNoUnexpected(harness)
    })
  })
}

test.describe('session chart zoom gestures (desktop)', () => {
  test.use({ viewport: { width: 1440, height: 900 }, contextOptions: { reducedMotion: 'reduce' } })

  test('track click, range seg, navigator reset, a plain wheel, and Alt + wheel with Scroll zoom off all drive the same view', async ({ page }) => {
    const harness = await openLongSession(page)
    const navigator = page.locator(NAV)
    const fullWindow = await navigatorWindow(page)

    // One click on the purple bar zooms to a 1h window around the click, as on the hub:
    // 60 minutes from its first to its last plotted minute.
    const track = await boxOf(page, `${NAV} .hx-chart-navigator__track`)
    await page.mouse.click(track.x + track.width / 2, track.y + track.height / 2)
    await settle(page)
    await expect(readout(page)).toHaveText('1 h')
    await expect.poll(async () => {
      const [start, end] = String(await navigatorWindow(page)).split(':').map(Number)
      return end! - start!
    }).toBe(60)

    await navigator.getByRole('button', { name: 'Reset zoom' }).click()
    await settle(page)
    await expect(readout(page)).toHaveText('Full stream')
    await expect.poll(() => navigatorWindow(page)).toBe(fullWindow)

    // The toolbar's range seg drives the same view, end-anchored.
    await page.locator('[data-session-range-seg]').getByRole('button', { name: '2h' }).click()
    await settle(page)
    await expect.poll(() => navigatorWindow(page)).toBe(`${LONG_STREAM_MINUTES - 121}:${LONG_STREAM_MINUTES - 1}`)
    await expect(readout(page)).toHaveText('2 h')
    await page.locator('[data-session-range-seg]').getByRole('button', { name: 'Full' }).click()
    await settle(page)
    await expect.poll(() => navigatorWindow(page)).toBe(fullWindow)

    // Scroll zoom is on by default: a plain wheel over the plot zooms.
    const plot = await boxOf(page, CHART)
    await page.mouse.move(plot.x + plot.width / 2, plot.y + plot.height / 2)
    await page.mouse.wheel(0, -200)
    await settle(page)
    await expect(readout(page)).not.toHaveText('Full stream')
    await navigator.getByRole('button', { name: 'Reset zoom' }).click()
    await settle(page)
    await expect.poll(() => navigatorWindow(page)).toBe(fullWindow)

    // Turned off (in the navigator's (i)), a plain wheel over the plot scrolls the page.
    await expect(navigator.getByRole('button', { name: 'Reset zoom' })).toBeHidden()
    await navigator.getByRole('button', { name: 'How to zoom and pan the chart' }).click()
    await navigator.getByRole('button', { name: /Scroll zoom/ }).click()
    await expect(navigator.getByRole('button', { name: /Scroll zoom/ })).toHaveAttribute('aria-pressed', 'false')
    await expect(navigator.locator('.hx-chart-navigator__hint')).toHaveText('Scroll zoom is off: the wheel scrolls the page · Hold Alt and scroll to zoom · Shift + scroll to pan')
    await page.keyboard.press('Escape')
    await page.locator(CHART).evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }))
    const centered = await boxOf(page, CHART)
    await page.mouse.move(centered.x + centered.width / 2, centered.y + centered.height / 2)
    const scrolledFrom = await page.evaluate(() => document.documentElement.scrollTop)
    await page.mouse.wheel(0, -200)
    await settle(page)
    await expect(readout(page)).toHaveText('Full stream')
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollTop)).toBeLessThan(scrolledFrom)

    const box = await boxOf(page, CHART)
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.keyboard.down('Alt')
    await page.mouse.wheel(0, -600)
    await page.keyboard.up('Alt')
    await settle(page)
    await expect(readout(page)).not.toHaveText('Full stream')
    await assertNoUnexpected(harness)
  })
})

// Review 2026-10-10: on a phone the pinned figures were cut off at the end of
// a one-line hint. The d3 readout names the pin on one line that fits.
for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }] as const) {
  test.describe(`pinned minute readout at ${viewport.width}px`, () => {
    test.use({ viewport, contextOptions: { reducedMotion: 'reduce' } })

    test('names the pinned minute in the readout line, fully visible', async ({ page }) => {
      const harness = await openLongSession(page)
      const level = Number(await page.locator(CHART).getAttribute('data-activity-bucket-minutes'))
      const area = await boxOf(page, AREA)
      await page.mouse.click(area.x + area.width * 0.4, area.y + area.height * 0.6)
      await settle(page)
      // Off the plot, the readout reads the pin.
      await page.mouse.move(1, 1)
      await settle(page)
      const line = page.locator('[data-session-readout]')
      await expect(line).toHaveCount(1)
      // F23: above 1-minute bars the click locks the bar, and the line reads it ("Pinned bar …").
      await expect(line).toHaveText(level > 1
        ? new RegExp(`^Pinned bar \\d+:\\d\\d:\\d\\d–\\d+:\\d\\d:\\d\\d · ${level}-min avg · viewers `)
        : /^Pinned \d+:\d\d:\d\d · viewers /)
      const pinned = secondsOf(await line.textContent())
      const card = secondsOf(await page.locator('[data-selected-moment-time]').textContent())
      expect(pinned).toBe(card)
      const fit = await line.evaluate(element => {
        const box = element.getBoundingClientRect()
        return {
          overflowX: element.scrollWidth - element.clientWidth,
          left: box.left,
          right: box.right,
          viewport: document.documentElement.clientWidth,
        }
      })
      expect(fit.overflowX, 'no text cut off sideways').toBeLessThanOrEqual(0)
      expect(fit.left).toBeGreaterThanOrEqual(0)
      expect(fit.right).toBeLessThanOrEqual(fit.viewport)
      await assertNoUnexpected(harness)
    })
  })
}

test.describe('session chart bars follow the zoom (768px)', () => {
  test.use({ viewport: COARSE_VIEWPORT, contextOptions: { reducedMotion: 'reduce' } })

  test('a wheel zoom re-buckets the bars and the note follows, down to 1-minute bars', async ({ page }) => {
    const harness = await openLongSession(page)
    const chart = page.locator(CHART)
    const note = page.locator('[data-session-chart-navigator] [data-chart-bar-bucket-minutes]')
    const area = await boxOf(page, AREA)
    const levels: number[] = [Number(await chart.getAttribute('data-activity-bucket-minutes'))]
    await expect(note).toHaveText(`${levels[0]}-min bars`)
    await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2)
    for (let notch = 0; notch < 12; notch += 1) {
      await page.mouse.wheel(0, -100)
      await settle(page)
      const level = Number(await chart.getAttribute('data-activity-bucket-minutes'))
      if (level !== levels[levels.length - 1]) levels.push(level)
      await expect(note).toHaveAttribute('data-chart-bar-bucket-minutes', String(level))
      await expect(note).toHaveText(`${level}-min bars`)
    }
    // Coarse to fine, never back, ending at one bar per minute.
    expect(levels[0]).toBeGreaterThan(1)
    expect(levels[levels.length - 1]).toBe(1)
    for (let index = 1; index < levels.length; index += 1) expect(levels[index]!).toBeLessThan(levels[index - 1]!)
    await expect(page.locator(`${CHART} [data-activity-bar-peak]`)).toHaveCount(0)
    await page.locator('[data-session-chart-navigator]').getByRole('button', { name: 'Reset zoom' }).click()
    await settle(page)
    await expect(chart).toHaveAttribute('data-activity-bucket-minutes', String(levels[0]))
    await assertNoUnexpected(harness)
  })

  test('a slot with unmeasured minutes is faded and marked; a short spike draws no cap (F3)', async ({ page }) => {
    const harness = await installPortalAcceptanceHarness(page)
    const payload = buildMinutes({ count: LONG_STREAM_MINUTES, withEmotes: true })
    // Minutes 101 and 102 were never measured; minute 402 is a short spike.
    payload.minutes = payload.minutes
      .filter(minute => ![101 * 60, 102 * 60].includes(Number(minute.offsetSeconds)))
      .map(minute => (Number(minute.offsetSeconds) === 402 * 60 ? { ...minute, chatCount: 20_000 } : minute))
    harness.setMinutesPayload(payload)
    await openAnalyticsSession(page)
    const chart = page.locator(CHART)
    await expect(chart).toHaveCount(1, { timeout: 25_000 })
    await chart.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }))
    await settle(page)
    const level = Number(await chart.getAttribute('data-activity-bucket-minutes'))
    expect(level).toBeGreaterThan(1)
    await expect(page.locator(`${CHART} [data-activity-bar-peak]`)).toHaveCount(0)
    expect(await page.locator(`${CHART} rect.spc-bar[data-lane-partial]`).count()).toBeGreaterThanOrEqual(1)

    // Hover the slot that holds minutes 101-102: the readout says how much of it was measured.
    const slotStart = Math.floor(101 / level) * level
    const missing = [101, 102].filter(minute => minute >= slotStart && minute < slotStart + level).length
    const area = page.locator(AREA)
    const box = await boxOf(page, AREA)
    const start = Number(await area.getAttribute('data-chart-viewport-start'))
    const end = Number(await area.getAttribute('data-chart-viewport-end'))
    const x = box.x + (((slotStart + level / 2) * 60 - start) / (end - start)) * box.width
    await page.mouse.move(x, box.y + box.height * 0.5)
    await settle(page)
    await expect(page.locator('[data-session-readout]')).toContainText(`${level - missing} of ${level} min measured`)
    await assertNoUnexpected(harness)
  })
})

test.describe('session chart zoom matches the Global activity chart (owner window)', () => {
  // Aron's window: CSS 2048x1018 at Windows 125%.
  test.use({ viewport: { width: 2048, height: 1018 }, deviceScaleFactor: 1.25, contextOptions: { reducedMotion: 'reduce' } })

  const span = async (page: Page) => {
    const [start, end] = String(await navigatorWindow(page)).split(':').map(Number)
    return end! - start! + 1
  }

  test('Zoom in halves the view down to five minutes, then disables', async ({ page }) => {
    const harness = await openLongSession(page)
    const zoomIn = page.locator(NAV).getByRole('button', { name: 'Zoom in' })
    const spans = [await span(page)]
    for (let click = 0; click < 14 && (await zoomIn.getAttribute('aria-disabled')) !== 'true'; click += 1) {
      await zoomIn.click()
      await settle(page)
      spans.push(await span(page))
    }
    // The d3 navigator marks unavailable actions with aria-disabled (core request u08-1).
    await expect(zoomIn).toHaveAttribute('aria-disabled', 'true')
    // Five minutes hold six minute steps (both edge minutes are plotted).
    expect(spans[spans.length - 1]).toBe(6)
    const plot = page.locator(AREA)
    const viewportSeconds = Number(await plot.getAttribute('data-chart-viewport-end')) - Number(await plot.getAttribute('data-chart-viewport-start'))
    expect(viewportSeconds).toBe(300)
    for (let index = 1; index < spans.length; index += 1) expect(spans[index]!).toBeLessThan(spans[index - 1]!)
    await assertNoUnexpected(harness)
  })

  test('one wheel notch zooms by the same step over the plot and the navigator', async ({ page }) => {
    const harness = await openLongSession(page)
    const full = await span(page)
    // Every notch below is the same wheel event, so every surface must give
    // the shared navigator's one step (exp(deltaY * 0.0025), as on the hub).
    const deltas: number[] = []
    await page.exposeFunction('recordWheelDelta', (deltaY: number) => { deltas.push(deltaY) })
    await page.evaluate(() => window.addEventListener('wheel', event => {
      (window as unknown as { recordWheelDelta: (deltaY: number) => void }).recordWheelDelta(event.deltaY)
    }, { capture: true, passive: true }))
    const expectedSpan = async () => {
      await expect.poll(() => deltas.length).toBeGreaterThan(0)
      return Math.round(full * Math.exp(deltas[deltas.length - 1]! * 0.0025))
    }
    const reset = async () => {
      await page.locator(NAV).getByRole('button', { name: 'Reset zoom' }).click()
      await settle(page)
      await expect.poll(() => span(page)).toBe(full)
      deltas.length = 0
    }
    const overPlot = async () => {
      const box = await boxOf(page, AREA)
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    }

    await overPlot()
    await page.keyboard.down('Alt')
    await page.mouse.wheel(0, -100)
    await page.keyboard.up('Alt')
    await settle(page)
    const expected = await expectedSpan()
    expect(expected).toBeLessThan(full)
    await expect.poll(() => span(page), { message: 'Alt + one notch over the plot' }).toBe(expected)

    // Scroll zoom is on by default: no modifier needed.
    await reset()
    await overPlot()
    await page.mouse.wheel(0, -100)
    await settle(page)
    await expect.poll(() => span(page), { message: 'Scroll zoom on, one notch over the plot' }).toBe(await expectedSpan())

    await reset()
    const track = await boxOf(page, `${NAV} .hx-chart-navigator__track`)
    await page.mouse.move(track.x + track.width / 2, track.y + track.height / 2)
    await page.mouse.wheel(0, -100)
    await settle(page)
    await expect.poll(() => span(page), { message: 'Scroll zoom on, one notch over the navigator' }).toBe(await expectedSpan())
    await assertNoUnexpected(harness)
  })

  test('a click pins a minute of the bar the readout shows, in every panel, and the readout then names it', async ({ page }) => {
    const harness = await openLongSession(page)
    const level = Number(await page.locator(CHART).getAttribute('data-activity-bucket-minutes'))
    const line = page.locator('[data-session-readout]')
    // Viewers, chat and emotes lanes (top to bottom).
    let checked = 0
    for (const lane of [0.1, 0.5, 0.88]) {
      for (const fraction of [0.13, 0.4471, 0.555, 0.61, 0.88]) {
        // The strip scrolls itself into view when it opens and the page shortens when it
        // closes, so the plot is measured again before every click.
        await page.locator(CHART).evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }))
        await settle(page)
        const area = await boxOf(page, AREA)
        const x = area.x + area.width * fraction
        const y = area.y + area.height * lane
        await page.mouse.move(x, y)
        await settle(page)
        const barStart = secondsOf(await line.textContent())
        expect(barStart, `hover readout at ${fraction}`).not.toBeNull()
        await page.mouse.click(x, y)
        await settle(page)
        // The card's minute lies in the hovered bar.
        await expect(page.locator('[data-selected-moment-time]'), `card opens at ${fraction}`).toHaveCount(1)
        const card = secondsOf(await page.locator('[data-selected-moment-time]').textContent())
        expect(card, `card at ${fraction}`).not.toBeNull()
        expect(card! >= barStart! && card! < barStart! + level * 60, `bar ${barStart} holds ${card}`).toBe(true)
        // Off the plot, the readout names the pin.
        await page.mouse.move(1, 1)
        await settle(page)
        expect(secondsOf(await line.textContent()), `pin readout at ${fraction}`).toBe(card)
        checked += 1
        await page.keyboard.press('Escape')
        await settle(page)
        await expect(page.locator('[data-selected-moment-time]')).toHaveCount(0)
      }
    }
    expect(checked).toBe(15)
    await assertNoUnexpected(harness)
  })

  test('the focused plot shows its focus ring', async ({ page }) => {
    const harness = await openLongSession(page)
    const plot = page.locator(CHART)
    await page.locator('[data-session-chart-part] [data-chart-focus-bar] button').first().focus()
    for (let presses = 0; presses < 40 && !(await plot.evaluate(node => node === document.activeElement)); presses += 1) {
      await page.keyboard.press('Tab')
    }
    await expect(plot).toBeFocused()
    const box = await plot.boundingBox()
    if (!box) throw new Error('plot has no layout box')
    // A strip just outside the plot's top edge, where the ring is painted.
    const strip = { x: box.x + 24, y: box.y - 8, width: 80, height: 8 }
    const focused = await page.screenshot({ clip: strip, animations: 'disabled' })
    await plot.evaluate(node => (node as SVGElement).blur())
    await expect(plot).not.toBeFocused()
    const blurred = await page.screenshot({ clip: strip, animations: 'disabled' })
    expect(focused.equals(blurred), 'the focus ring changes the pixels at the plot edge').toBe(false)
    await assertNoUnexpected(harness)
  })
})

test.describe('minute-data pager on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, contextOptions: { reducedMotion: 'reduce' } })

  // d3-v2 session-original .po-md-pg: one row, Earlier and Later at either end
  // and the page's time span between them.
  test('keeps Earlier, the page label and Later on one row, apart and on screen', async ({ page }) => {
    const harness = await openLongSession(page)
    await page.locator('[data-chart-data-alternative] summary').click()
    const pager = page.locator('[data-chart-data-pager]')
    await expect(pager).toBeVisible()
    const label = await pager.locator('[data-chart-data-page-label]').boundingBox()
    const earlier = await pager.getByRole('button', { name: 'Earlier minutes' }).boundingBox()
    const later = await pager.getByRole('button', { name: 'Later minutes' }).boundingBox()
    if (!label || !earlier || !later) throw new Error('pager has no layout box')
    const mid = (b: { y: number; height: number }) => b.y + b.height / 2
    expect(Math.abs(mid(earlier) - mid(label))).toBeLessThanOrEqual(1)
    expect(Math.abs(mid(later) - mid(label))).toBeLessThanOrEqual(1)
    expect(earlier.x + earlier.width).toBeLessThanOrEqual(label.x)
    expect(label.x + label.width).toBeLessThanOrEqual(later.x)
    expect(earlier.x).toBeGreaterThanOrEqual(0)
    expect(later.x + later.width).toBeLessThanOrEqual(390)
    await assertNoUnexpected(harness)
  })
})
