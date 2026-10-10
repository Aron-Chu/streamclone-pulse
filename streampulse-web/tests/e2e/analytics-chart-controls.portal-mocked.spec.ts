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
// activity chart". The stream chart's only zoom UI is the hub's navigator.
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

const readout = (page: Page) => page.locator('[data-session-chart-navigator] [data-hub-chart-navigator] strong')

// The harness installs a fake clock; let queued animation frames run.
async function settle(page: Page) {
  const clock = page.clock as { runFor?: (ms: number) => Promise<void> }
  if (typeof clock.runFor === 'function') await clock.runFor(600)
}

for (const viewport of VIEWPORTS) {
  test.describe(`session chart controls at ${viewport.width}px`, () => {
    test.use({ viewport, contextOptions: { reducedMotion: 'reduce' } })

    test('zoom controls sit below the plot and never cover it', async ({ page }) => {
      const harness = await openLongSession(page)
      await expect(page.locator('[data-chart-viewport-controls]')).toHaveCount(0)
      await expect(page.locator('[data-chart-range-row]')).toHaveCount(0)
      const toolbar = page.locator('[data-session-chart-navigator] .hx-chart-navigator__toolbar')
      await expect(toolbar).toBeVisible()
      const plot = await page.locator(CHART).boundingBox()
      const toolbarBox = await toolbar.boundingBox()
      if (!plot || !toolbarBox) throw new Error('chart or navigator toolbar has no layout box')
      expect(toolbarBox.y, 'zoom toolbar starts below the plot').toBeGreaterThanOrEqual(plot.y + plot.height - 0.5)

      const buttons = toolbar.locator('button:visible')
      const labels = (await buttons.allTextContents()).map(text => text.trim())
      // Scroll zoom is on by default (owner ask, 2026-10-09) and remembered in this browser.
      expect(labels).toEqual(['Zoom in', 'Zoom out', 'Reset zoom', 'Scroll zoomOn'])
      for (const box of await buttons.evaluateAll(nodes => nodes.map(node => {
        const rect = node.getBoundingClientRect()
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      }))) {
        expect(intersects(box, plot), 'zoom button overlaps the plot').toBe(false)
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
      await expect(navigator.getByRole('button', { name: /Scroll zoom/ })).toHaveAttribute('aria-pressed', 'true')
      await expect(navigator.locator('.hx-chart-navigator__hint')).toHaveText('Scroll over the chart to zoom · Shift + scroll to pan · Drag the purple bar to pick a span')
      await expect(navigator.locator('strong')).toHaveText('Full stream')

      // The navigator track lines up with the plot and sits below it.
      const plot = await page.locator(CHART).boundingBox()
      const track = await navigator.locator('.hx-chart-navigator__track').boundingBox()
      if (!plot || !track) throw new Error('missing layout box')
      expect(track.y).toBeGreaterThan(plot.y + plot.height / 2)
      expect(track.x).toBeGreaterThanOrEqual(plot.x - 1)
      expect(track.x + track.width).toBeLessThanOrEqual(plot.x + plot.width + 1)

      // Owner report (2026-10-09, "the width of the graph and the bottom"):
      // the plot, its time axis and the zoom bar share their left and right
      // edges with the focus bar above and the overlay bar below, at every
      // width. Scale values read above the plot or inside its edge instead of
      // in a gutter beside it.
      const edges = await page.evaluate(() => {
        const of = (selector: string) => {
          const rect = document.querySelector(selector)?.getBoundingClientRect()
          return rect ? { left: rect.left, right: rect.right } : null
        }
        return {
          focusBar: of('[data-chart-focus-bar]'),
          overlays: of('[data-chart-overlay-selector]'),
          plot: of('svg[aria-label="Analytics timeline chart"] rect[data-chart-touch-action]'),
          axis: of('svg[aria-label="Analytics timeline chart"] [data-chart-x-axis-line]'),
          zoomBar: of('[data-session-chart-navigator] .hx-chart-navigator__track'),
          controls: of('[data-session-chart-navigator] .hx-chart-navigator__actions'),
        }
      })
      if (!edges.focusBar) throw new Error('focus bar has no layout box')
      for (const part of ['overlays', 'plot', 'axis', 'zoomBar', 'controls'] as const) {
        const box = edges[part]
        if (!box) throw new Error(`${part} has no layout box`)
        expect(Math.abs(box.left - edges.focusBar.left), `${part} left edge matches the focus bar`).toBeLessThanOrEqual(2)
        expect(Math.abs(box.right - edges.focusBar.right), `${part} right edge matches the focus bar`).toBeLessThanOrEqual(2)
      }
      await expect(page.locator(`${CHART} text`, { hasText: /^PEAK$/ })).toHaveCount(0)
      await expect(page.locator('[data-chart-scale-row] [data-chart-scale-value="peak"]')).toBeVisible()
      // PEAK stays clear of the 2px focus ring drawn just inside the plot edge.
      const peak = await page.locator('[data-chart-scale-row] [data-chart-scale-value="peak"]').boundingBox()
      if (!peak || !edges.plot) throw new Error('peak or plot has no layout box')
      expect(peak.x - edges.plot.left, 'PEAK clears the focus ring inside the plot edge').toBeGreaterThanOrEqual(4)

      // As on the hub, the whole navigator spans exactly the plot area at
      // every width: track, readout and hint start at the plot's left edge,
      // and nothing passes either edge. The toolbar sits at the right end of
      // the readout's row, or wraps under the readout at the left edge where
      // both do not fit on one line.
      const area = await page.locator(`${CHART} rect[data-chart-touch-action]`).boundingBox()
      if (!area) throw new Error('plot area has no layout box')
      const partBox = async (part: string) => {
        const box = await navigator.locator(`.hx-chart-navigator__${part}`).boundingBox()
        if (!box) throw new Error(`navigator ${part} has no layout box`)
        return box
      }
      for (const part of ['track', 'readout', 'toolbar', 'hint']) {
        const box = await partBox(part)
        expect(box.x, `navigator ${part} stays inside the plot's left edge`).toBeGreaterThanOrEqual(area.x - 1)
        expect(box.x + box.width, `navigator ${part} stays inside the plot's right edge`).toBeLessThanOrEqual(area.x + area.width + 1)
        if (part !== 'toolbar') expect(Math.abs(box.x - area.x), `navigator ${part} starts at the plot's left edge`).toBeLessThanOrEqual(1)
      }
      const readoutBox = await partBox('readout')
      const toolbarBox = await partBox('toolbar')
      if (toolbarBox.y >= readoutBox.y + readoutBox.height - 1) {
        expect(Math.abs(toolbarBox.x - area.x), "a wrapped toolbar starts at the plot's left edge").toBeLessThanOrEqual(1)
      } else {
        expect(Math.abs(toolbarBox.x + toolbarBox.width - (area.x + area.width)), "the toolbar ends at the plot's right edge").toBeLessThanOrEqual(1)
      }

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

  test('track click, navigator reset, a plain wheel, and Alt + wheel with Scroll zoom off all drive the same view', async ({ page }) => {
    const harness = await openLongSession(page)
    const navigator = page.locator('[data-session-chart-navigator] [data-hub-chart-navigator]')
    const window = () => navigator.getAttribute('data-hub-chart-navigator-window')
    const fullWindow = await window()

    // One click on the purple bar zooms to a 1h window around the click, as on the hub:
    // 60 minutes from its first to its last plotted minute.
    const track = await navigator.locator('.hx-chart-navigator__track').boundingBox()
    if (!track) throw new Error('navigator track has no layout box')
    await page.mouse.click(track.x + track.width / 2, track.y + track.height / 2)
    await settle(page)
    await expect(readout(page)).toHaveText('Zoomed view')
    await expect.poll(async () => {
      const [start, end] = String(await window()).split(':').map(Number)
      return end! - start!
    }).toBe(60)

    await navigator.getByRole('button', { name: 'Reset zoom' }).click()
    await settle(page)
    await expect(readout(page)).toHaveText('Full stream')
    await expect.poll(window).toBe(fullWindow)

    // Scroll zoom is on by default: a plain wheel over the plot zooms.
    const plot = await page.locator(CHART).boundingBox()
    if (!plot) throw new Error('chart has no layout box')
    await page.mouse.move(plot.x + plot.width / 2, plot.y + plot.height / 2)
    await page.mouse.wheel(0, -200)
    await settle(page)
    await expect(readout(page)).toHaveText('Zoomed view')
    await navigator.getByRole('button', { name: 'Reset zoom' }).click()
    await settle(page)
    await expect.poll(window).toBe(fullWindow)

    // Turned off, a plain wheel over the plot scrolls the page.
    await navigator.getByRole('button', { name: /Scroll zoom/ }).click()
    await expect(navigator.getByRole('button', { name: /Scroll zoom/ })).toHaveAttribute('aria-pressed', 'false')
    await expect(navigator.locator('.hx-chart-navigator__hint')).toHaveText('Scroll zoom is off: the wheel scrolls the page · Hold Alt and scroll to zoom · Shift + scroll to pan')
    await page.locator(CHART).evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }))
    const centered = await page.locator(CHART).boundingBox()
    if (!centered) throw new Error('chart has no layout box')
    await page.mouse.move(centered.x + centered.width / 2, centered.y + centered.height / 2)
    const scrolledFrom = await page.evaluate(() => document.documentElement.scrollTop)
    await page.mouse.wheel(0, -200)
    await settle(page)
    await expect(readout(page)).toHaveText('Full stream')
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollTop)).toBeLessThan(scrolledFrom)

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

test.describe('session chart bars follow the zoom (desktop)', () => {
  test.use({ viewport: { width: 1440, height: 900 }, contextOptions: { reducedMotion: 'reduce' } })

  test('a wheel zoom re-buckets the bars and the note follows, down to 1-minute bars', async ({ page }) => {
    const harness = await openLongSession(page)
    const chart = page.locator(CHART)
    const note = page.locator('[data-session-chart-navigator] [data-chart-bar-bucket-minutes]')
    const area = await page.locator(`${CHART} rect[data-chart-touch-action]`).boundingBox()
    if (!area) throw new Error('plot area has no layout box')
    const levels: number[] = [Number(await chart.getAttribute('data-activity-bucket-minutes'))]
    await expect(note).toHaveText(`bars ${levels[0]}-min avg`)
    await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2)
    for (let notch = 0; notch < 12; notch += 1) {
      await page.mouse.wheel(0, -100)
      await settle(page)
      const level = Number(await chart.getAttribute('data-activity-bucket-minutes'))
      if (level !== levels[levels.length - 1]) levels.push(level)
      await expect(note).toHaveAttribute('data-chart-bar-bucket-minutes', String(level))
      await expect(note).toHaveText(level > 1 ? `bars ${level}-min avg` : 'bars per minute')
    }
    // Coarse to fine, never back, ending at one bar per minute.
    expect(levels[0]).toBeGreaterThan(1)
    expect(levels[levels.length - 1]).toBe(1)
    for (let index = 1; index < levels.length; index += 1) expect(levels[index]!).toBeLessThan(levels[index - 1]!)
    // At one bar per minute no bar averages anything: no caps.
    await expect(page.locator(`${CHART} [data-activity-bar-peak]`)).toHaveCount(0)
    await page.locator('[data-session-chart-navigator]').getByRole('button', { name: 'Reset zoom' }).click()
    await settle(page)
    await expect(chart).toHaveAttribute('data-activity-bucket-minutes', String(levels[0]))
    await assertNoUnexpected(harness)
  })

  test('above 1-minute bars a short spike gets a cap and a slot with unmeasured minutes is faded and marked', async ({ page }) => {
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
    await expect(chart).toHaveAttribute('data-activity-bucket-minutes', '5')
    // The 100-104 slot holds 3 measured minutes of 5.
    const partial = page.locator(`${CHART} rect[data-activity-bar="chat"][data-bar-partial="true"]`)
    await expect(partial).toHaveCount(1)
    await expect(partial).toHaveAttribute('data-observed-ratio', '0.600')
    const caps = page.locator(`${CHART} rect[data-activity-bar-peak="chat"]`)
    await expect(caps).toHaveCount(1)
    // The cap sits above its bar, at the spike's height, as wide as the bar.
    const [cap, capBar] = await caps.evaluate(node => {
      const box = (element: Element | null) => {
        const rect = element!.getBoundingClientRect()
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      }
      return [box(node), box(node.previousElementSibling)]
    })
    expect(cap.y).toBeLessThan(capBar.y)
    expect(Math.abs(cap.x - capBar.x)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(cap.width - capBar.width)).toBeLessThanOrEqual(0.5)
    await assertNoUnexpected(harness)
  })
})

test.describe('session chart zoom matches the Global activity chart (owner window)', () => {
  // Aron's window: CSS 2048x1018 at Windows 125%.
  test.use({ viewport: { width: 2048, height: 1018 }, deviceScaleFactor: 1.25, contextOptions: { reducedMotion: 'reduce' } })

  const navigator = (page: Page) => page.locator('[data-session-chart-navigator] [data-hub-chart-navigator]')
  const span = async (page: Page) => {
    const [start, end] = String(await navigator(page).getAttribute('data-hub-chart-navigator-window')).split(':').map(Number)
    return end! - start! + 1
  }

  test('Zoom in halves the view down to five minutes, then disables', async ({ page }) => {
    const harness = await openLongSession(page)
    const zoomIn = navigator(page).getByRole('button', { name: 'Zoom in' })
    const spans = [await span(page)]
    for (let click = 0; click < 14 && await zoomIn.isEnabled(); click += 1) {
      await zoomIn.click()
      await settle(page)
      spans.push(await span(page))
    }
    await expect(zoomIn).toBeDisabled()
    // Five minutes hold six minute steps (both edge minutes are plotted).
    expect(spans[spans.length - 1]).toBe(6)
    const plot = page.locator(`${CHART} rect[data-chart-touch-action]`)
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
      await navigator(page).getByRole('button', { name: 'Reset zoom' }).click()
      await settle(page)
      await expect.poll(() => span(page)).toBe(full)
      deltas.length = 0
    }
    const overPlot = async () => {
      const box = await page.locator(`${CHART} rect[data-chart-touch-action]`).boundingBox()
      if (!box) throw new Error('plot area has no layout box')
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
    const track = await navigator(page).locator('.hx-chart-navigator__track').boundingBox()
    if (!track) throw new Error('navigator track has no layout box')
    await page.mouse.move(track.x + track.width / 2, track.y + track.height / 2)
    await page.mouse.wheel(0, -100)
    await settle(page)
    await expect.poll(() => span(page), { message: 'Scroll zoom on, one notch over the navigator' }).toBe(await expectedSpan())
    await assertNoUnexpected(harness)
  })

  test('a click pins the minute the readout shows, in every lane, and the readout stays on it', async ({ page }) => {
    const harness = await openLongSession(page)
    const area = await page.locator(`${CHART} rect[data-chart-touch-action]`).boundingBox()
    if (!area) throw new Error('plot area has no layout box')
    const laneY = async (name: 'chat' | 'emotes') => {
      const bars = await page.locator(`${CHART} rect[data-activity-bar="${name}"]`).evaluateAll(nodes =>
        nodes.map(node => { const rect = node.getBoundingClientRect(); return { y: rect.y, height: rect.height } }))
      const tallest = bars.reduce((best, bar) => (bar.height > best.height ? bar : best))
      return tallest.y + tallest.height - 2
    }
    const minuteOf = (text: string | null) => text?.match(/\d\d:\d\d:\d\d/)?.[0] ?? null
    const header = page.locator('[data-chart-hover-readout-row] p').first()
    const lanes = [area.y + area.height * 0.08, await laneY('chat'), await laneY('emotes')]
    let checked = 0
    for (const y of lanes) {
      for (const fraction of [0.13, 0.4471, 0.555, 0.61, 0.88]) {
        const x = area.x + area.width * fraction
        await page.mouse.move(x, y)
        await settle(page)
        const hovered = minuteOf(await header.textContent())
        expect(hovered).not.toBeNull()
        await page.mouse.click(x, y)
        await settle(page)
        // The pointer has not moved: readout, card and announcement agree.
        expect(minuteOf(await header.textContent()), `readout after click at ${fraction}`).toBe(hovered)
        expect(minuteOf(await page.locator('[data-selected-moment-time]').textContent()), `card at ${fraction}`).toBe(hovered)
        expect(minuteOf(await page.locator('[data-chart-selection-announcement]').textContent()), `announcement at ${fraction}`).toBe(hovered)
        // Over a bar wider than a minute, the second row names that bar, which
        // holds the pinned minute; off the plot it reads the pin.
        const bar = page.locator('[data-chart-bar-readout]')
        if (await bar.count()) {
          const range = (await bar.textContent())?.match(/(\d\d:\d\d:\d\d)–(\d\d:\d\d:\d\d)/)
          expect(range, `bar readout at ${fraction}`).not.toBeNull()
          expect(hovered! >= range![1]! && hovered! < range![2]!, `bar ${range![0]} holds ${hovered}`).toBe(true)
        }
        await page.mouse.move(area.x - 40, area.y - 60)
        await settle(page)
        expect(minuteOf(await page.locator('[data-chart-selection-hint]').textContent()), `pin hint at ${fraction}`).toBe(hovered)
        checked += 1
        await page.keyboard.press('Escape')
        await settle(page)
      }
    }
    expect(checked).toBe(15)
    await assertNoUnexpected(harness)
  })

  test('the focused plot shows its focus ring', async ({ page }) => {
    const harness = await openLongSession(page)
    const plot = page.locator('[data-session-chart-stack] svg[role="group"]').first()
    await page.locator('[data-chart-focus-bar] button').last().focus()
    await page.keyboard.press('Tab')
    await expect(plot).toBeFocused()
    const box = await plot.boundingBox()
    if (!box) throw new Error('plot has no layout box')
    // A strip just inside the plot's top edge, where the ring is painted.
    const strip = { x: box.x + 24, y: box.y, width: 80, height: 3 }
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

  test('puts the page label on its own row, with Earlier and Later at either end below it', async ({ page }) => {
    const harness = await openLongSession(page)
    await page.locator('[data-chart-data-alternative] summary').click()
    const pager = page.locator('[data-chart-data-pager]')
    await expect(pager).toBeVisible()
    const label = await pager.locator('[data-chart-data-page-label]').boundingBox()
    const earlier = await pager.getByRole('button', { name: 'Earlier minutes' }).boundingBox()
    const later = await pager.getByRole('button', { name: 'Later minutes' }).boundingBox()
    if (!label || !earlier || !later) throw new Error('pager has no layout box')
    expect(label.y + label.height).toBeLessThanOrEqual(Math.min(earlier.y, later.y) + 1)
    expect(Math.abs(earlier.y - later.y)).toBeLessThanOrEqual(1)
    expect(earlier.x + earlier.width).toBeLessThan(later.x)
    await assertNoUnexpected(harness)
  })
})
