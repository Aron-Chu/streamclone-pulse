import { expect, test, type Page } from '@playwright/test'
import {
  CHART_SURFACES,
  resetZoom,
  scrollYOf,
  scrollZoomToggleOf,
  setScrollZoom,
  windowOf,
  type ChartSurface,
} from './helpers/chartWheelSurfaces'

// Owner report (2026-10-12): "we lost the chart scroll feature ... how does
// that keep regressing". The wheel zoomed only over the plot box: on the
// stream chart the label band above it (PEAK, AVG, LAST DATA) and the time
// axis below it scrolled the page, and on the hub the axis-label row above the
// plot and the time axis did too. An earlier spec even asserted that rule.
//
// The whole chart is the wheel zone, on both website charts: from the top of
// the label band, through the plot, every lane and the time-axis row, down to
// and including the navigator bar, edge to edge. Scroll zoom stays On by
// default, Off still gives the page the wheel, Shift+wheel still pans, and at
// the full range a zoom-out still scrolls the page.
//
// Owner rule (2026-10-13): the wheel zooms anywhere over a chart card, so the
// card's header rows (readout, games strip, focus rows) and the navigator's
// buttons and hint zoom too. Only outside the card does the page keep the
// wheel. The stream chart follows it; on the hub only the shared navigator
// does until the hub's d3 port brings its header rows along.

interface Zone {
  top: number
  bottom: number
  left: number
  right: number
  /** Named rows (page y) that must be inside the sweep. */
  rows: Record<string, number>
}

/**
 * The chart's visible area in page coordinates, from what the viewer sees:
 * the label band at the top, the plot's left and right edges, the navigator
 * bar at the bottom. It does not read the implementation's wheel surface.
 */
async function zoneOf(page: Page, surface: ChartSurface): Promise<Zone> {
  return page.evaluate((name): Zone => {
    const box = (selector: string) => {
      const element = document.querySelector(selector)
      const rect = element?.getBoundingClientRect()
      if (!rect || rect.width <= 0 || rect.height <= 0) return null
      return { top: rect.top + window.scrollY, bottom: rect.bottom + window.scrollY, left: rect.left, right: rect.right }
    }
    const must = (selector: string) => {
      const found = box(selector)
      if (!found) throw new Error(`${selector} has no layout box`)
      return found
    }
    const middle = (rect: { top: number; bottom: number }) => (rect.top + rect.bottom) / 2
    if (name === 'stream') {
      const svg = must('svg[aria-label="Analytics timeline chart"]')
      const plot = must('svg[aria-label="Analytics timeline chart"] rect[data-chart-touch-action]')
      const labels = must('[data-chart-scale-row]')
      const bar = must('[data-session-chart-navigator] .hx-chart-navigator__bar')
      return {
        top: Math.min(svg.top, labels.top),
        bottom: bar.bottom,
        left: svg.left,
        right: svg.right,
        rows: {
          'label band (PEAK / AVG / LAST DATA)': middle(labels),
          'plot centre': middle(plot),
          'time-axis row': (plot.bottom + svg.bottom) / 2,
          'strip above the navigator bar': (svg.bottom + bar.top) / 2,
          'navigator bar': middle(bar),
        },
      }
    }
    const plot = must('[data-hub-chart-wheel-surface]')
    const labels = box('.hx-chart-axis-labels') ?? must('.hx-chart-series-labels')
    const axis = must('.hx-axis')
    const bar = must('.figma-global-activity__hub-chart .hx-chart-navigator__bar')
    return {
      top: labels.top,
      bottom: bar.bottom,
      left: plot.left,
      right: plot.right,
      rows: {
        'label band (series labels)': middle(labels),
        'plot centre': middle(plot),
        'time-axis row': middle(axis),
        'navigator bar': middle(bar),
      },
    }
  }, surface.name)
}

/** Scrolls the page so the whole zone sits in the middle of the viewport; returns scrollY. */
async function centerZone(page: Page, zone: Zone): Promise<number> {
  return page.evaluate(({ top, bottom }) => {
    const height = bottom - top
    window.scrollTo({ top: Math.max(0, top - (window.innerHeight - height) / 2), behavior: 'instant' })
    return window.scrollY
  }, zone)
}

/** The grid: 10 evenly spaced rows plus the named rows, at the left edge, the middle and the right edge. */
function gridOf(zone: Zone): Array<{ label: string; x: number; pageY: number }> {
  const rows: Array<[string, number]> = []
  const ROWS = 10
  for (let index = 0; index < ROWS; index += 1) {
    const pageY = zone.top + 1 + ((zone.bottom - zone.top - 2) * index) / (ROWS - 1)
    rows.push([`row ${index + 1}/${ROWS}`, pageY])
  }
  for (const [name, pageY] of Object.entries(zone.rows)) rows.push([name, pageY])
  const columns: Array<[string, number]> = [
    ['left edge', zone.left + 2],
    ['middle', (zone.left + zone.right) / 2],
    ['right edge', zone.right - 2],
  ]
  return rows.flatMap(([row, pageY]) => columns.map(([column, x]) => ({ label: `${row} · ${column}`, x, pageY })))
}

const readoutOf = (surface: ChartSurface) => surface.navigator.locator('.hx-chart-navigator__bucket-count')

/** What the pointer is over, and whether it is part of the chart's card (no sticky header on top). */
async function hitAt(page: Page, x: number, y: number) {
  return page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y)
    const chart = element?.closest('[data-session-chart-stack], .figma-global-activity__hub-chart')
    return {
      inChart: Boolean(chart),
      element: element ? `${element.tagName.toLowerCase()}${element.getAttribute('class') ? `.${String(element.getAttribute('class')).split(/\s+/).slice(0, 2).join('.')}` : ''}` : 'nothing',
    }
  }, { x, y })
}

for (const [name, open] of Object.entries(CHART_SURFACES)) {
  test.describe(`${name} chart: the whole chart is a wheel-zoom zone`, () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('a wheel notch anywhere from the label band to the navigator bar, edge to edge, zooms and leaves the page still', async ({ page }) => {
      const surface = await open(page)
      await expect(scrollZoomToggleOf(surface), 'Scroll zoom is on by default').toHaveAttribute('aria-pressed', 'true')
      await resetZoom(surface)
      const fullReadout = await readoutOf(surface).textContent()
      expect(fullReadout).toContain(`${surface.full} of ${surface.full}`)
      const zone = await zoneOf(page, surface)
      expect(zone.bottom - zone.top, 'the chart fits in the viewport').toBeLessThan(860)
      const grid = gridOf(zone)
      expect(grid.length).toBeGreaterThanOrEqual(24)

      const misses: string[] = []
      for (const point of grid) {
        await resetZoom(surface)
        const scrollY = await centerZone(page, zone)
        const y = point.pageY - scrollY
        const hit = await hitAt(page, point.x, y)
        expect(hit.inChart, `${point.label}: the pointer is over the chart (${hit.element})`).toBe(true)
        await page.mouse.move(point.x, y)
        await page.mouse.wheel(0, -100)
        await surface.settle()
        const readout = await readoutOf(surface).textContent()
        const { count } = await windowOf(surface)
        const scrolled = (await scrollYOf(page)) - scrollY
        if (readout === fullReadout || count >= surface.full || scrolled !== 0) {
          misses.push(`${point.label} (y ${Math.round(point.pageY - zone.top)} of ${Math.round(zone.bottom - zone.top)}, over ${hit.element}): readout "${readout}", page scrolled ${scrolled}px`)
          // A wheel the page took starts the scroll-through window; wait it out
          // so one miss does not hide whether the next point works.
          if (scrolled !== 0) await page.waitForTimeout(450)
        }
      }
      expect(misses, 'every point in the chart zooms and none scrolls the page').toEqual([])
    })

    test('at the full range a zoom-out over the label band, the time axis or the bar scrolls the page', async ({ page }) => {
      const surface = await open(page)
      await resetZoom(surface)
      const zone = await zoneOf(page, surface)
      for (const row of ['label band', 'time-axis row', 'navigator bar']) {
        const [label, pageY] = Object.entries(zone.rows).find(([key]) => key.startsWith(row))!
        // Let the scroll-through guard forget the previous page scroll.
        await page.waitForTimeout(450)
        const scrollY = await centerZone(page, zone)
        await page.mouse.move((zone.left + zone.right) / 2, pageY - scrollY)
        await page.mouse.wheel(0, 100)
        await expect.poll(() => scrollYOf(page), { message: `${label}: a wheel-down at the full range scrolls the page` }).toBeGreaterThan(scrollY)
        await surface.settle()
        await expect(surface.navigator).toHaveAttribute('data-hub-chart-navigator-window', `0:${surface.full - 1}`)
      }
    })

    test('Scroll zoom off gives the page the wheel over the label band and the time axis; Shift+wheel there pans', async ({ page }) => {
      const surface = await open(page)
      await resetZoom(surface)
      const zone = await zoneOf(page, surface)
      const spots = Object.entries(zone.rows).filter(([key]) => key.startsWith('label band') || key.startsWith('time-axis'))
      expect(spots).toHaveLength(2)

      await setScrollZoom(surface, false)
      for (const [label, pageY] of spots) {
        await page.waitForTimeout(450)
        const scrollY = await centerZone(page, zone)
        await page.mouse.move((zone.left + zone.right) / 2, pageY - scrollY)
        await page.mouse.wheel(0, -100)
        await expect.poll(() => scrollYOf(page), { message: `${label}: Scroll zoom off scrolls the page` }).toBeLessThan(scrollY)
        await surface.settle()
        await expect(surface.navigator).toHaveAttribute('data-hub-chart-navigator-window', `0:${surface.full - 1}`)
      }

      // Shift+wheel pans a zoomed view from the same rows, in either mode.
      await setScrollZoom(surface, true)
      await surface.navigator.getByRole('button', { name: 'Zoom in' }).click()
      await surface.settle()
      for (const [label, pageY] of spots) {
        const before = await windowOf(surface)
        expect(before.count).toBeLessThan(surface.full)
        await page.waitForTimeout(450)
        const scrollY = await centerZone(page, zone)
        await page.mouse.move((zone.left + zone.right) / 2, pageY - scrollY)
        // Pan towards whichever side has room (Zoom in may keep the live end in view).
        const later = before.end < surface.full - 1
        await page.keyboard.down('Shift')
        await page.mouse.wheel(0, later ? 100 : -100)
        await page.keyboard.up('Shift')
        await surface.settle()
        const after = await windowOf(surface)
        expect(after.count, `${label}: Shift+wheel keeps the span`).toBe(before.count)
        if (later) expect(after.start, `${label}: Shift+wheel pans later`).toBeGreaterThan(before.start)
        else expect(after.start, `${label}: Shift+wheel pans earlier`).toBeLessThan(before.start)
        expect(await scrollYOf(page), `${label}: the page did not scroll`).toBe(scrollY)
      }
    })

    if (name === 'stream') {
      test('the rest of the card zooms too: its header rows, the navigator buttons and the hint', async ({ page }) => {
        const surface = await open(page)
        // The focus rows, games strip and hover hint, and the navigator's (i) and Zoom in button below the bar.
        const selectors = ['[data-chart-focus-bar]', '[data-games-played]', '[data-chart-selection-hint]',
          // The stream chart's hint lives in the navigator's (i) (d3-v2 session-original).
          '[data-session-chart-navigator] [data-chart-navigator-info]', '[data-session-chart-navigator] .hx-chart-navigator__zoom-buttons button']
        for (const selector of selectors) {
          await resetZoom(surface)
          const target = page.locator(selector).first()
          await target.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
          const box = (await target.boundingBox())!
          const y = box.y + box.height / 2
          await page.waitForTimeout(450)
          await page.mouse.move(box.x + Math.min(12, box.width / 2), y)
          const before = await scrollYOf(page)
          await page.mouse.wheel(0, -120)
          await surface.settle()
          const { count } = await windowOf(surface)
          expect(count, `${selector} zooms`).toBeLessThan(surface.full)
          expect(await scrollYOf(page), `${selector} leaves the page still`).toBe(before)
        }
      })

      test('outside the card the page keeps the wheel', async ({ page }) => {
        const surface = await open(page)
        await resetZoom(surface)
        const card = '[data-session-chart-wheel-card]'
        // Put the card's top edge 200px down the viewport, then wheel just above it.
        const spot = await page.evaluate((selector) => {
          const element = document.querySelector(selector)!
          const top = element.getBoundingClientRect().top + window.scrollY
          window.scrollTo({ top: Math.max(0, top - 200), behavior: 'instant' })
          const rect = element.getBoundingClientRect()
          const x = rect.left + 24
          const y = rect.top - 16
          const hit = document.elementFromPoint(x, y)
          return { x, y, scrollY: window.scrollY, outside: Boolean(hit) && !element.contains(hit) }
        }, card)
        expect(spot.scrollY, 'there is page to scroll back up').toBeGreaterThan(0)
        expect(spot.outside, 'the point is outside the card').toBe(true)
        await page.waitForTimeout(450)
        await page.mouse.move(spot.x, spot.y)
        await page.mouse.wheel(0, -120)
        await expect.poll(() => scrollYOf(page), { message: 'above the card the page scrolls' }).toBeLessThan(spot.scrollY)
        await surface.settle()
        await expect(surface.navigator).toHaveAttribute('data-hub-chart-navigator-window', `0:${surface.full - 1}`)
      })
    } else {
      // The hub's readout and summary keep the release-1 rule (they give the page the wheel)
      // until the hub's d3 port lands; that port brings the hub under the card rule above.
      test('above the chart the page keeps the wheel', async ({ page }) => {
        const surface = await open(page)
        await resetZoom(surface)
        // The hub's hover readout and summary line.
        const selectors = ['.figma-global-activity__hub-chart .hx-chart-header__readout', '.figma-global-activity__hub-chart .hx-chart-summary']
        const zone = await zoneOf(page, surface)
        for (const selector of selectors) {
          const target = page.locator(selector).first()
          await target.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
          const box = (await target.boundingBox())!
          const y = box.y + box.height / 2
          const pageY = y + await scrollYOf(page)
          expect(pageY < zone.top || pageY > zone.bottom, `${selector} is outside the chart`).toBe(true)
          await page.waitForTimeout(450)
          await page.mouse.move(box.x + Math.min(12, box.width / 2), y)
          const before = await scrollYOf(page)
          await page.mouse.wheel(0, -120)
          await expect.poll(() => scrollYOf(page), { message: `${selector} scrolls the page` }).toBeLessThan(before)
          await surface.settle()
          await expect(surface.navigator).toHaveAttribute('data-hub-chart-navigator-window', `0:${surface.full - 1}`)
        }
      })
    }
  })
}
