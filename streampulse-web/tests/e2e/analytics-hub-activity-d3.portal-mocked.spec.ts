import { expect, test, type Page } from './helpers/portalMockedTest'
import { installHubUxMock } from './helpers/hubUxMock'

// The hub activity card on the shared SpChart core (plan §2.1-§2.3, unit U6):
// header row (heading, window seg, series chips, bars note, (i)), the Now/hover
// readout, the plot, the time axis, the d3 navigator and the provider lanes.
// A-common (plan §3) at the three review viewports: the wheel zooms over the
// graph with the page still, and over the header, readout and lanes the page
// keeps it (A4, owner 2026-10-15), nothing moves when a bar is picked,
// swapped or released (A2), Esc and a second click release it (A3), no in-page
// scrollbars (A5) and no sideways page scroll (A6).

const CARD = '.hub-act[data-bench-chart-card]'
const PLOT = `${CARD} svg[data-bench-plot]`
const NAVIGATOR = `${CARD} [data-hub-chart-navigator]`

const VIEWPORTS = [
  { label: '2048x1018@1.25', viewport: { width: 2048, height: 1018 }, deviceScaleFactor: 1.25 },
  { label: '1707x848@1.5', viewport: { width: 1707, height: 848 }, deviceScaleFactor: 1.5 },
  { label: '390x844@3', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 },
] as const

const MUST_NOT_SHIP = [
  "This window isn't in the mockup's data",
  'Back to 24 h',
  "aren't in this mockup's data",
  'Mockup -',
  'Proposal mockup',
  'Proposal notes',
  'Round 2 proposal',
]

async function openHub(page: Page, path = '/analytics') {
  await page.goto(path)
  await expect(page.locator(PLOT)).toBeVisible()
  await expect(page.locator(`${CARD} [data-hub-readout]`)).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}

/**
 * Scrolls the card just under the page's sticky bars, so the whole card is on
 * screen, then waits for the page's own section-reveal entrance (a 12 px
 * translate on an ancestor, not part of the card) to finish.
 */
async function bringCardIntoView(page: Page) {
  await page.evaluate((selector) => {
    const card = document.querySelector(selector)!
    const stickyBottom = Math.max(0, ...Array.from(document.querySelectorAll<HTMLElement>('body *')).filter((element) => {
      const style = getComputedStyle(element)
      if (style.position !== 'sticky' && style.position !== 'fixed') return false
      const rect = element.getBoundingClientRect()
      return rect.height > 0 && rect.top <= 1 && rect.width > window.innerWidth / 2 && !card.contains(element)
    }).map((element) => element.getBoundingClientRect().bottom))
    window.scrollTo({ top: Math.max(0, card.getBoundingClientRect().top + window.scrollY - stickyBottom - 8), behavior: 'instant' })
  }, CARD)
  await settle(page)
}

/**
 * Waits until the card's page position holds still: no entrance transform on
 * any ancestor and the same page y over 400 ms (the reveal can start a frame
 * after the scroll).
 */
async function settle(page: Page) {
  const read = () => page.evaluate((selector) => {
    let node: Element | null = document.querySelector(selector)
    while (node) {
      const transform = getComputedStyle(node).transform
      if (transform !== 'none' && transform !== 'matrix(1, 0, 0, 1, 0, 0)') return null
      node = node.parentElement
    }
    return document.querySelector(selector)!.getBoundingClientRect().top + window.scrollY
  }, CARD)
  await expect.poll(async () => {
    const first = await read()
    await page.waitForTimeout(400)
    const second = await read()
    return first != null && first === second
  }).toBe(true)
}

async function cardBoxes(page: Page) {
  return page.evaluate((selector) => {
    const card = document.querySelector(selector)!
    const parts = {
      card,
      header: card.querySelector('[data-hub-activity-header]'),
      readout: card.querySelector('[data-hub-readout]'),
      plot: card.querySelector('svg[data-bench-plot]'),
      axis: card.querySelector('[data-bench-axis]'),
      navigator: card.querySelector('[data-hub-chart-navigator]'),
      lanes: card.querySelector('[data-hub-provider-lanes]'),
    }
    return Object.fromEntries(Object.entries(parts).map(([name, element]) => {
      const rect = element!.getBoundingClientRect()
      return [name, { x: rect.x, y: rect.y + window.scrollY, w: rect.width, h: rect.height }]
    }))
  }, CARD)
}

function expectSameBoxes(before: Record<string, unknown>, after: Record<string, unknown>) {
  for (const [name, box] of Object.entries(before)) {
    const a = box as { x: number; y: number; w: number; h: number }
    const b = after[name] as typeof a
    for (const key of ['x', 'y', 'w', 'h'] as const) expect(Math.abs(a[key] - b[key]), `${name}.${key}`).toBeLessThanOrEqual(0.5)
  }
}

async function clickBar(page: Page, fraction: number) {
  const box = (await page.locator(PLOT).boundingBox())!
  const plotWidth = await page.locator(`${CARD} [data-hub-plot-box]`).evaluate((el) => el.getBoundingClientRect().width)
  // Bars live in the upper (rates) panel; the lower quarter is the viewer panel.
  await page.mouse.click(box.x + plotWidth * fraction, box.y + box.height * 0.55)
}

async function navigatorWindow(page: Page) {
  return page.locator(NAVIGATOR).getAttribute('data-hub-chart-navigator-window')
}

/** The sweep rows inside the graph (plot, time axis, navigator); the others are the page's (owner, 2026-10-15). */
const GRAPH_ROWS = new Set(['plot', 'axis', 'track', 'controls'])

/** The 36 sweep points (page coordinates in the viewport) over the card's rows, edge to edge. */
async function sweepPoints(page: Page) {
  return page.evaluate((selector) => {
    const card = document.querySelector(selector)!
    const cardRect = card.getBoundingClientRect()
    const rows: Array<[string, string, number]> = [
      ['header', '[data-hub-activity-header]', 5],
      ['readout', '[data-hub-readout]', 5],
      ['plot', 'svg[data-bench-plot]', 6],
      ['axis', '[data-bench-axis]', 5],
      ['track', '.hx-chart-navigator__track', 5],
      ['controls', '.hx-chart-navigator__actions', 5],
      ['lanes', '[data-hub-provider-lanes]', 5],
    ]
    const points: Array<{ row: string; x: number; y: number; inside: boolean }> = []
    for (const [row, rowSelector, count] of rows) {
      const rect = card.querySelector(rowSelector)!.getBoundingClientRect()
      const y = rect.top + rect.height / 2
      for (let index = 0; index < count; index += 1) {
        const x = cardRect.left + 4 + ((cardRect.width - 8) * index) / (count - 1)
        const hit = document.elementFromPoint(x, y)
        points.push({ row, x, y, inside: !!hit && card.contains(hit) && !hit.closest('[data-chart-wheel-exempt]') })
      }
    }
    return points
  }, CARD)
}

for (const { label, viewport, deviceScaleFactor } of VIEWPORTS) {
  test.describe(`hub activity card at ${label}`, () => {
    test.use({ viewport, deviceScaleFactor })

    test('A4: a wheel notch over the graph zooms with the page still; over the header, readout and lanes the page keeps it', async ({ page }) => {
      await installHubUxMock(page)
      await openHub(page)
      await bringCardIntoView(page)
      const full = await navigatorWindow(page)
      expect(full).toBe('0:239')
      const points = await sweepPoints(page)
      expect(points).toHaveLength(36)
      expect(points.filter((point) => !point.inside).map((point) => point.row)).toEqual([])
      let zoomed = 0
      for (const point of points.filter((point) => GRAPH_ROWS.has(point.row))) {
        await page.mouse.move(point.x, point.y)
        const scrollY = await page.evaluate(() => window.scrollY)
        await page.mouse.wheel(0, -100)
        await expect.poll(() => navigatorWindow(page), { message: `${point.row} at ${Math.round(point.x)}` }).not.toBe(full)
        expect(await page.evaluate(() => window.scrollY), `${point.row} scrollY`).toBe(scrollY)
        zoomed += 1
        await page.locator(`${NAVIGATOR} button[aria-label="Reset zoom"]`).evaluate((button: HTMLButtonElement) => button.click())
        await expect.poll(() => navigatorWindow(page)).toBe(full)
      }
      expect(zoomed).toBe(21)
      // Over the rest of the card no listener takes the wheel: it reaches the page as is.
      await page.evaluate(() => {
        const store = window as unknown as { wheelPrevented?: boolean[] }
        store.wheelPrevented = []
        window.addEventListener('wheel', (event) => void store.wheelPrevented!.push(event.defaultPrevented))
      })
      const scrollY = await page.evaluate(() => window.scrollY)
      for (const point of points.filter((point) => !GRAPH_ROWS.has(point.row))) {
        // Back to where the sweep was measured, so the point is still over its row, and let the
        // scroll-through guard forget the last page scroll: a notch here must not reach the graph
        // that the page scroll moves under the pointer.
        await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), scrollY)
        await page.waitForTimeout(450)
        await page.mouse.move(point.x, point.y)
        await page.mouse.wheel(0, -100)
        if (scrollY > 0) await expect.poll(() => page.evaluate(() => window.scrollY), { message: `${point.row} at ${Math.round(point.x)} scrolls the page` }).toBeLessThan(scrollY)
        expect(await navigatorWindow(page), `${point.row} at ${Math.round(point.x)}`).toBe(full)
      }
      expect(await page.evaluate(() => (window as unknown as { wheelPrevented: boolean[] }).wheelPrevented)).toEqual(Array(15).fill(false))
    })

    test('A2/A3: picking, swapping and releasing a bar moves nothing; Esc and a second click release it', async ({ page }) => {
      await installHubUxMock(page)
      await openHub(page)
      await bringCardIntoView(page)
      const plot = page.locator(PLOT)
      const rest = await cardBoxes(page)
      // Hover and focus never select anything.
      const box = (await plot.boundingBox())!
      await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5)
      await expect(page.locator(`${CARD} [data-hub-readout]`)).toHaveAttribute('data-hub-readout-mode', 'hover')
      await plot.focus()
      await expect(plot).not.toHaveAttribute('data-selection', /.*/)
      expectSameBoxes(rest, await cardBoxes(page))
      // Open, swap, close with a second click.
      await clickBar(page, 0.3)
      await expect(plot).toHaveAttribute('data-selection', '')
      expectSameBoxes(rest, await cardBoxes(page))
      await clickBar(page, 0.7)
      await expect(plot).toHaveAttribute('data-selection', '')
      expectSameBoxes(rest, await cardBoxes(page))
      await clickBar(page, 0.7)
      await expect(plot).not.toHaveAttribute('data-selection', /.*/)
      expectSameBoxes(rest, await cardBoxes(page))
      // Esc releases it and focus stays on the plot.
      await clickBar(page, 0.5)
      await expect(plot).toHaveAttribute('data-selection', '')
      await plot.focus()
      await page.keyboard.press('Escape')
      await expect(plot).not.toHaveAttribute('data-selection', /.*/)
      await expect(plot).toBeFocused()
      expectSameBoxes(rest, await cardBoxes(page))
    })

    test('A5/A9: no in-page scrollbars in the card, no mockup copy, Inter everywhere', async ({ page }) => {
      await installHubUxMock(page)
      await openHub(page)
      const scrollbars = await page.locator(CARD).evaluate((card) => Array.from(card.querySelectorAll<HTMLElement>('*')).flatMap((element) => {
        const style = getComputedStyle(element)
        if (!/(auto|scroll)/.test(`${style.overflowX} ${style.overflowY}`)) return []
        const borderX = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth)
        const borderY = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)
        const x = element.offsetWidth - element.clientWidth - borderX
        const y = element.offsetHeight - element.clientHeight - borderY
        return x > 0.5 || y > 0.5 ? [`${element.className} ${x}x${y}`] : []
      }))
      expect(scrollbars).toEqual([])
      const text = await page.locator(CARD).innerText()
      for (const phrase of MUST_NOT_SHIP) expect(text).not.toContain(phrase)
      const families = await page.locator(CARD).evaluate((card) => Array.from(new Set(Array.from(card.querySelectorAll<HTMLElement>('h2, button, span, text')).filter((node) => node.getClientRects().length > 0).map((node) => getComputedStyle(node).fontFamily.split(',')[0]!.replace(/["']/g, '').trim()))))
      expect(families).toEqual(['Inter'])
    })
  })
}

test('A6: no sideways page scroll at 390-2048 px', async ({ page }) => {
  await installHubUxMock(page)
  for (const width of [390, 720, 860, 999, 1440, 1707, 2048]) {
    await page.setViewportSize({ width, height: 900 })
    await openHub(page)
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${width}px`).toBeLessThanOrEqual(width)
  }
})

test('header row: heading follows the window, the seg has 30m / 24h / 7d, and a URL-only window is a fourth pressed button', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installHubUxMock(page, { matchActivityWindow: true })
  await openHub(page)
  const seg = page.locator(`${CARD} [data-hub-window-seg]`)
  const heading = page.locator(`${CARD} [data-hub-activity-header] h2`)
  await expect(heading).toHaveText('Activity · last 24 h')
  await expect(seg.getByRole('button')).toHaveText(['30m', '24h', '7d'])
  await expect(seg.getByRole('button', { name: '24h' })).toHaveAttribute('aria-pressed', 'true')

  const weekResponse = page.waitForResponse((response) => new URL(response.url()).searchParams.get('activityWindow') === '7d' && response.ok())
  await seg.getByRole('button', { name: '7d' }).click()
  const week = await (await weekResponse).json()
  await expect(heading).toHaveText('Activity · last 7 days')
  await expect(seg.getByRole('button', { name: '7d' })).toHaveAttribute('aria-pressed', 'true')
  // Bars sit on the served bucket floor (never a hard-coded 6).
  await expect(page.locator(PLOT)).toHaveAttribute('data-activity-bucket-minutes', String(week.activity.bucketMinutes))
  await expect(page.locator(`${CARD} [data-hub-bars-note]`)).toHaveText(`bars ${week.activity.bucketMinutes}-min avg`)

  await openHub(page, '/analytics?window=3m')
  await expect(heading).toHaveText('Activity · last 90 days')
  await expect(seg.getByRole('button')).toHaveText(['30m', '24h', '7d', '3mo'])
  const urlOnly = seg.getByRole('button', { name: '3mo' })
  await expect(urlOnly).toHaveAttribute('aria-pressed', 'true')
  await expect(urlOnly).toHaveAttribute('data-hub-window-url-only', '')
})

test('series chips switch series on and off and keep at least one on', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installHubUxMock(page)
  await openHub(page)
  const chips = page.locator(`${CARD} [data-hub-series-chip]`)
  await expect(chips).toHaveText(['Chat/min', 'Emotes/min', 'Viewers (sample)'])
  await expect(page.locator(`${CARD} .spc-bar`)).not.toHaveCount(0)
  await chips.nth(0).click()
  await expect(chips.nth(0)).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator(`${CARD} .spc-bar`)).toHaveCount(0)
  await expect(page.locator(`${CARD} [data-hub-readout] [data-k="chat"]`)).toHaveClass(/\boff\b/)
  await chips.nth(1).click()
  await chips.nth(2).click()
  // The last series on stays on.
  await expect(chips.nth(2)).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator(`${CARD} .spc-line-viewers`)).not.toHaveCount(0)
  await chips.nth(0).click()
  await expect(page.locator(`${CARD} .spc-bar`)).not.toHaveCount(0)
})

test('the readout shows Now at rest, the hovered bar, and a locked bar until Esc, and never moves', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installHubUxMock(page)
  await openHub(page)
  await bringCardIntoView(page)
  const readout = page.locator(`${CARD} [data-hub-readout]`)
  await expect(readout).toHaveAttribute('data-hub-readout-mode', 'now')
  await expect(readout.locator('.tm .l1')).toHaveText('Now')
  const rest = await readout.boundingBox()
  const box = (await page.locator(PLOT).boundingBox())!
  for (const fraction of [0.1, 0.5, 0.9]) {
    await page.mouse.move(box.x + box.width * fraction, box.y + box.height * 0.5)
    await expect(readout).toHaveAttribute('data-hub-readout-mode', 'hover')
    await expect(readout.locator('.tm .l1')).not.toHaveText('Now')
    expect(await readout.boundingBox()).toEqual(rest)
  }
  // A locked bar holds the readout at rest, in the same place (R1, bar-lock board 11-01); Esc goes back to Now.
  await clickBar(page, 0.5)
  await page.mouse.move(2, 2)
  await expect(readout).toHaveAttribute('data-hub-readout-mode', 'lock')
  await expect(readout.locator('.tm .l2')).toHaveText(/ · locked$/)
  expect(await readout.boundingBox()).toEqual(rest)
  await page.keyboard.press('Escape')
  await expect(readout).toHaveAttribute('data-hub-readout-mode', 'now')
  await expect(readout.locator('.tm .l1')).toHaveText('Now')
})

test('plot, axis, lanes and navigator: viewers in the lower quarter, no peak caps, rows on the plot edges', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installHubUxMock(page)
  await openHub(page)
  const geometry = await page.locator(CARD).evaluate((card) => {
    const plot = card.querySelector('svg[data-bench-plot]')!.getBoundingClientRect()
    const surface = card.querySelector('[data-hub-plot-box]')!.getBoundingClientRect()
    const bars = Array.from(card.querySelectorAll('.spc-bar')).map((bar) => bar.getBoundingClientRect())
    const viewers = card.querySelector('.spc-line-viewers')!.getBoundingClientRect()
    const rows = Object.fromEntries(['[data-bench-axis]', '.hx-chart-navigator__track', '.hx-chart-navigator__actions'].map((selector) => {
      const rect = card.querySelector(selector)!.getBoundingClientRect()
      return [selector, { left: rect.left, right: rect.right }]
    }))
    const lanes = card.querySelector('[data-hub-provider-lanes] svg')!.getBoundingClientRect()
    return {
      plot: { top: plot.top, height: plot.height, left: plot.left },
      surface: { left: surface.left, right: surface.right },
      barsBottom: Math.max(...bars.map((bar) => bar.bottom)),
      barCount: bars.length,
      viewers: { top: viewers.top, bottom: viewers.bottom },
      rows,
      lanes: { left: lanes.left, right: lanes.right },
      peakMarks: card.querySelectorAll('svg[data-bench-plot] [class*="peak"], svg[data-bench-plot] [class*="cap"]').length,
    }
  })
  expect(Math.round(geometry.plot.height)).toBe(420)
  expect(geometry.barCount).toBeGreaterThan(0)
  expect(geometry.peakMarks).toBe(0)
  // Viewers draw in the lower panel (the bottom quarter), under every bar.
  expect(geometry.viewers.top).toBeGreaterThanOrEqual(geometry.barsBottom - 0.5)
  expect(geometry.viewers.top - geometry.plot.top).toBeGreaterThanOrEqual(geometry.plot.height * 0.7)
  for (const [selector, row] of Object.entries(geometry.rows)) {
    expect(Math.abs(row.left - geometry.surface.left), selector).toBeLessThanOrEqual(1)
    expect(Math.abs(row.right - geometry.surface.right), selector).toBeLessThanOrEqual(1)
  }
  expect(Math.abs(geometry.lanes.left - geometry.surface.left)).toBeLessThanOrEqual(1)
  await expect(page.locator(`${NAVIGATOR}`)).toHaveAttribute('data-chart-navigator-variant', 'd3')
  await expect(page.locator(`${NAVIGATOR} .hx-chart-navigator__bucket-count`)).toHaveText('240 of 240 6-min buckets · bars 6-min')
  await expect(page.locator(`${NAVIGATOR} .hx-chart-navigator__readout strong`)).toHaveText('Full 24 h')
  await expect(page.locator(`${CARD} [data-hub-provider-lanes] .nm`)).toHaveText(['7TV', 'other'])
})

test('at phone width the plot is 300 px and bars merge on the served floor', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await installHubUxMock(page)
  await openHub(page)
  const plot = page.locator(PLOT)
  expect(Math.round((await plot.boundingBox())!.height)).toBe(300)
  const minutes = Number(await plot.getAttribute('data-activity-bucket-minutes'))
  expect(minutes % 6).toBe(0)
  expect(minutes).toBeGreaterThan(6)
  await expect(page.locator(`${NAVIGATOR} .hx-chart-navigator__bucket-count`)).toHaveText(`240 of 240 6-min buckets · bars ${minutes}-min`)
})
