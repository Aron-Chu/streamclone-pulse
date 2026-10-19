import { expect, test, type Locator, type Page } from '@playwright/test'
import { buildMinutes, installPortalAcceptanceHarness, openAnalyticsSession } from './helpers/portalAcceptanceHarness'

// U8 (plan §1.2, §3 A2-A6): the session page's chart part is d3's (toolbar,
// pins, band, plot, axis, navigator) inside one wheel card with the Games
// played strip; everything else on the page is prod's.
const MINUTES = 748
const CARD = '[data-session-chart-wheel-card]'
const PART = '[data-session-chart-part]'
const PLOT = '[data-bench-plot]'
const NAV = '[data-session-chart-navigator] [data-hub-chart-navigator]'
const CLEAR = 'button[aria-label="Clear selected moment"]'
const SHOW = '[data-session-show-toggle]'
const READOUT_ROW = '[data-chart-hover-readout-row]'

async function open(page: Page) {
  const harness = await installPortalAcceptanceHarness(page)
  harness.setMinutesPayload(buildMinutes({ count: MINUTES, withEmotes: true }))
  await openAnalyticsSession(page)
  await expect(page.locator(NAV)).toHaveAttribute('data-hub-chart-navigator-window', `0:${MINUTES - 1}`, { timeout: 30_000 })
  await settle(page)
  return harness
}

// The harness installs a fake clock: let React commit, then run frames and timers.
async function settle(page: Page) {
  await page.waitForTimeout(50)
  const clock = page.clock as { runFor?: (ms: number) => Promise<void> }
  if (typeof clock.runFor === 'function') await clock.runFor(600)
}

const pageBox = (loc: Locator) =>
  loc.evaluate(el => {
    const r = el.getBoundingClientRect()
    return { x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height }
  })

const navWindow = (page: Page) => page.locator(NAV).getAttribute('data-hub-chart-navigator-window')

async function toFull(page: Page) {
  if ((await navWindow(page)) === `0:${MINUTES - 1}`) return
  await page.locator(NAV).getByRole('button', { name: 'Reset zoom' }).click()
  await settle(page)
  await expect(page.locator(NAV)).toHaveAttribute('data-hub-chart-navigator-window', `0:${MINUTES - 1}`)
}

/** A point in the rates panel at a fraction of the plot width, in viewport coordinates. */
async function plotPoint(page: Page, fx: number) {
  const box = await page.locator(PLOT).boundingBox()
  if (!box) throw new Error('plot has no box')
  return { x: box.x + box.width * fx, y: box.y + box.height * 0.4 }
}

/** Show on chart (d3-v2 session-original): every marker starts off; tick the named ones. */
async function showOnChart(page: Page, ...markers: Array<'moments' | 'avg' | 'live'>) {
  const toggle = page.locator(SHOW)
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  for (const key of markers) await page.locator(`[data-session-marker="${key}"]`).check()
  await page.keyboard.press('Escape')
  await settle(page)
}

const focusedIsPlot = (page: Page) => page.evaluate(sel => document.activeElement === document.querySelector(sel), PLOT)

test.describe('session chart part (d3) at 1440', () => {
  test.use({ viewport: { width: 1440, height: 900 }, contextOptions: { reducedMotion: 'reduce' } })

  test('one wheel card holds the Games strip and the part; detail sits outside it', async ({ page }) => {
    await open(page)
    const card = page.locator(CARD)
    await expect(card).toHaveCount(1)
    await expect(card.locator('[data-games-played]')).toHaveCount(1)
    await expect(card.locator(PART)).toHaveCount(1)
    await expect(card.locator('[data-chart-selected-detail-slot]')).toHaveCount(0)
    await expect(page.locator('[data-chart-selected-detail-slot]')).toHaveCount(1)
    const strip = await pageBox(card.locator('[data-games-played]'))
    const part = await pageBox(page.locator(PART))
    expect(strip.y + strip.h).toBeLessThanOrEqual(part.y + 0.5)
    // d3-v2 session-original: the readout line leads the card, the Games strip has no header row.
    const row = await pageBox(card.locator(READOUT_ROW))
    expect(row.y + row.h).toBeLessThanOrEqual(strip.y + 0.5)
    await expect(card.locator('[data-games-played-header]')).toHaveCount(0)
  })

  test('toolbar: series seg, one end-anchored range seg, Expand and Show on chart; the readout has its own line', async ({ page }) => {
    await open(page)
    await page.locator(PART).scrollIntoViewIfNeeded()
    const tool = page.locator(`${PART} [data-chart-focus-bar]`)
    await expect(tool).toHaveCount(1)
    await expect(page.locator('[data-chart-viewport-controls]')).toHaveCount(0)
    await expect(page.locator('[data-chart-range-row]')).toHaveCount(0)
    await expect(page.locator('[data-session-range-seg]')).toHaveCount(1)
    // The readout left the toolbar for its own line above Games played (d3-v2 session-original).
    await expect(tool.locator('[data-session-readout]')).toHaveCount(0)
    const readout = page.locator(`${CARD} ${READOUT_ROW} [data-session-readout][data-chart-selection-hint]`)
    await expect(readout).toHaveCount(1)
    await expect(readout).toHaveText(/^Latest\s*·/)
    await expect(page.locator(`${READOUT_ROW} [data-session-readout-clear]`)).toBeHidden()

    const series = tool.locator('[data-session-series-seg] button')
    await expect(series).toHaveText(['All', 'Viewers', 'Chat/min', 'Emotes/min'])
    await expect(tool.locator('[data-session-series-seg] button[aria-pressed="true"]')).toHaveText(['All'])
    await series.filter({ hasText: 'Chat/min' }).click()
    await expect(tool.locator('[data-session-series-seg] button[aria-pressed="true"]')).toHaveText(['Chat/min'])
    await series.filter({ hasText: 'Chat/min' }).click()
    await expect(tool.locator('[data-session-series-seg] button[aria-pressed="true"]')).toHaveText(['Chat/min'])
    await series.filter({ hasText: /^All$/ }).click()
    await expect(tool.locator('[data-session-series-seg] button[aria-pressed="true"]')).toHaveText(['All'])

    const range = page.locator('[data-session-range-seg] button')
    await expect(range).toHaveText(['15m', '1h', '2h', '4h', 'Full'])
    await expect(page.locator('[data-session-range-seg] button[aria-pressed="true"]')).toHaveText(['Full'])
    await range.filter({ hasText: '1h' }).click()
    await settle(page)
    await expect(page.locator(NAV)).toHaveAttribute('data-hub-chart-navigator-window', `${MINUTES - 61}:${MINUTES - 1}`)
    await expect(page.locator('[data-session-range-seg] button[aria-pressed="true"]')).toHaveText(['1h'])
    await range.filter({ hasText: 'Full' }).click()
    await settle(page)
    await expect(page.locator(NAV)).toHaveAttribute('data-hub-chart-navigator-window', `0:${MINUTES - 1}`)

    // d3-v2 session-original .cb-tool: series, range, Expand and Show on chart
    // share one toolbar row above the plot at every width; it wraps on narrow
    // parts and Show on chart keeps the row's end. Every Show on chart marker
    // starts off, so the pins rail takes no height and the plot sits right
    // under the toolbar; with Moments on it sits the 34 px pins top lower.
    const restTop = await page.locator(PART).evaluate(part => ({
      plot: part.querySelector('[data-bench-plot]')!.getBoundingClientRect().top,
      tool: part.querySelector('[data-chart-focus-bar]')!.getBoundingClientRect().bottom,
    }))
    expect(restTop.plot - restTop.tool).toBeCloseTo(0, 0)
    await expect(page.locator('[data-session-pins]')).toHaveCount(0)
    await showOnChart(page, 'moments')
    const rows = await page.locator(PART).evaluate(part => {
      const tool = part.querySelector('[data-chart-focus-bar]')!
      const controls = ['[data-session-series-seg]', '[data-session-range-seg]', '[data-session-expand]', '[data-session-show-toggle]']
      const t = tool.getBoundingClientRect()
      return {
        mode: part.getAttribute('data-session-controls'),
        under: part.querySelectorAll('.ssc-tool2').length,
        height: t.height,
        inTool: controls.map(sel => tool.contains(part.querySelector(sel))),
        showRight: part.querySelector('[data-session-show-toggle]')!.closest('.ssc-show')!.getBoundingClientRect().right,
        toolRight: t.right,
        toolBottom: t.bottom,
        plotTop: part.querySelector('[data-bench-plot]')!.getBoundingClientRect().top,
      }
    })
    expect(rows.mode).toBe('toolbar')
    expect(rows.under).toBe(0)
    expect(rows.inTool).toEqual([true, true, true, true])
    expect(rows.height).toBeGreaterThanOrEqual(40)
    expect(Math.abs(rows.showRight - rows.toolRight)).toBeLessThanOrEqual(1)
    expect(rows.plotTop - rows.toolBottom).toBeCloseTo(34, 0)
    // The mockup keeps 26 px seg buttons and 32 px quiet buttons (44 px hit rows via ::after).
    expect((await pageBox(range.first())).h).toBe(26)
    expect((await pageBox(page.locator('[data-session-expand]'))).h).toBe(32)
  })

  test('Expand +140 on the 440 plot (plus the column fill); Moments on: pins rail 28 px with at most 5 pins; band text only; no peak caps', async ({ page }) => {
    await open(page)
    await page.locator(PART).scrollIntoViewIfNeeded()
    // session-original: 440 px, grown by the column fill (fillH, at most 200) so the moment rows end level
    const rest = (await pageBox(page.locator(PLOT))).h
    expect(rest).toBeGreaterThanOrEqual(440)
    expect(rest).toBeLessThanOrEqual(640)
    const expand = page.locator('[data-session-expand]')
    await expect(expand).toHaveAttribute('aria-pressed', 'false')
    await expand.click()
    await settle(page)
    await expect(expand).toHaveAttribute('aria-pressed', 'true')
    // the fill holds while expanded
    expect((await pageBox(page.locator(PLOT))).h).toBe(rest + 140)
    await expand.click()
    await settle(page)
    expect((await pageBox(page.locator(PLOT))).h).toBe(rest)

    const pins = page.locator('[data-session-pins]')
    await expect(pins).toHaveCount(0)
    await showOnChart(page, 'moments')
    await expect(pins).toHaveCount(1)
    expect((await pageBox(pins)).h).toBe(28)
    const pinCount = await page.locator('[data-session-pin]').count()
    const clusterCount = await page.locator('[data-session-pin-cluster]').count()
    expect(pinCount + clusterCount).toBeGreaterThan(0)
    expect(pinCount + clusterCount).toBeLessThanOrEqual(5)

    const bands = page.locator('[data-session-band]')
    expect(await bands.count()).toBeGreaterThan(0)
    await expect(bands.locator('img')).toHaveCount(0)
    expect((await pageBox(bands.first())).h).toBe(18)

    await expect(page.locator('[data-activity-bar-peak]')).toHaveCount(0)
    const bars = await page.locator(`${PLOT} rect.spc-bar`).count()
    expect(bars).toBeGreaterThan(0)
    // two bar lanes (chat, emotes), each capped at 600 rects or one per minute up to ~1057 minutes
    expect(bars).toBeLessThanOrEqual(1500)
    await expect(page.locator('[data-chart-bar-bucket-minutes]')).toHaveCount(1)
    await expect(page.locator('[data-chart-lane-caption]')).toHaveCount(3)
    const touch = page.locator(`${PLOT} rect[data-chart-touch-action]`)
    await expect(touch).toHaveAttribute('data-chart-viewport-start', /\d/)
    await expect(touch).toHaveAttribute('data-chart-viewport-end', /\d/)
  })

  test('Show on chart starts with every marker off; Emotes on chart, under the chart, adds dashed emote lines', async ({ page }) => {
    await open(page)
    await page.locator(PART).scrollIntoViewIfNeeded()
    const toggle = page.locator(SHOW)
    await expect(toggle).toHaveAttribute('aria-label', 'Show on chart')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator(`${PLOT} .spc-avg`)).toHaveCount(0)
    await toggle.click()
    await expect(page.locator('[data-session-marker="moments"]')).not.toBeChecked()
    await expect(page.locator('[data-session-marker="avg"]')).not.toBeChecked()
    await page.locator('[data-session-marker="avg"]').check()
    await settle(page)
    expect(await page.locator(`${PLOT} .spc-avg`).count()).toBeGreaterThan(0)
    await expect(toggle).toHaveAttribute('aria-label', 'Show on chart, 1 on')
    await page.keyboard.press('Escape')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')

    const line = page.locator('[data-session-emotes-on-chart]')
    await expect(line).toBeVisible()
    expect((await pageBox(line)).y).toBeGreaterThan((await pageBox(page.locator(PLOT))).y + (await pageBox(page.locator(PLOT))).h)
    const tokens = line.locator('[data-session-emote-token]')
    const drawn = page.locator(`${PLOT} path[data-lane-line]`)
    const before = await tokens.count()
    await expect(drawn).toHaveCount(before)
    await line.locator('[data-session-emote-add]').click()
    const box = line.locator('[data-session-emote]:not(:checked):not(:disabled)').first()
    const key = await box.getAttribute('data-session-emote')
    await box.check()
    await settle(page)
    await expect(tokens).toHaveCount(before + 1)
    await expect(drawn).toHaveCount(before + 1)
    expect(await page.locator(`${PLOT} path[data-lane-line="${key}"]`).count()).toBeGreaterThan(0)
    // Emote lines draw only with the All or Emotes/min series.
    await page.keyboard.press('Escape')
    await page.locator('[data-session-series-seg] button').filter({ hasText: 'Chat/min' }).click()
    await settle(page)
    await expect(drawn).toHaveCount(0)
    await page.locator('[data-session-series-seg] button').filter({ hasText: /^All$/ }).click()
    await settle(page)
    await expect(drawn).toHaveCount(before + 1)
    await line.locator(`[data-session-emote-remove="${key}"]`).click()
    await settle(page)
    await expect(tokens).toHaveCount(before)
    await expect(line.locator('[data-session-emote-add]')).toBeFocused()
  })

  test('A2/A3: click-only detail; second click, Esc and the clear button close it; focus returns; 0 px shift', async ({ page }) => {
    await open(page)
    await page.locator(PART).evaluate(el => el.scrollIntoView({ block: 'start', behavior: 'instant' }))
    await settle(page)
    const plot = page.locator(PLOT)
    const shiftFrom = await pageBox(plot)
    const expectNoShift = async (label: string) => {
      const now = await pageBox(plot)
      expect(Math.abs(now.x - shiftFrom.x), `${label}: x`).toBeLessThan(0.5)
      expect(Math.abs(now.y - shiftFrom.y), `${label}: y`).toBeLessThan(0.5)
      expect(Math.abs(now.h - shiftFrom.h), `${label}: height`).toBeLessThan(0.5)
    }
    const clear = page.locator(CLEAR)

    // Hover never opens anything.
    const a = await plotPoint(page, 0.3)
    await page.mouse.move(a.x, a.y)
    await settle(page)
    await expect(clear).toHaveCount(0)

    // Open, swap, second click closes.
    await page.mouse.click(a.x, a.y)
    await settle(page)
    await expect(clear).toHaveCount(1)
    await expectNoShift('open')
    // The readout follows the pointer (hovered bar), then shows the pin once it leaves.
    await page.mouse.move(2, 2)
    await settle(page)
    await expect(page.locator('[data-session-readout]')).toHaveText(/^Pinned \d+:\d\d:\d\d · viewers /)
    await expect(page.locator(`${READOUT_ROW} [data-session-readout-clear]`)).toBeVisible()
    const b = await plotPoint(page, 0.6)
    await page.mouse.click(b.x, b.y)
    await settle(page)
    await expect(clear).toHaveCount(1)
    await expectNoShift('swap')
    await page.mouse.click(b.x, b.y)
    await settle(page)
    await expect(clear).toHaveCount(0)
    await expectNoShift('close (second click)')
    expect(await focusedIsPlot(page)).toBe(true)

    // Esc closes and keeps focus on the plot.
    await page.mouse.click(a.x, a.y)
    await settle(page)
    await expect(clear).toHaveCount(1)
    await page.keyboard.press('Escape')
    await settle(page)
    await expect(clear).toHaveCount(0)
    await expectNoShift('close (Esc)')
    expect(await focusedIsPlot(page)).toBe(true)

    // The clear button (x) closes and focus goes back to the plot.
    await page.mouse.click(a.x, a.y)
    await settle(page)
    await clear.click()
    await settle(page)
    await expect(clear).toHaveCount(0)
    await expectNoShift('close (x)')
    expect(await focusedIsPlot(page)).toBe(true)

    // So does the readout line's Clear (d3-v2 session-original .po-clear), which hides again.
    const lineClear = page.locator(`${READOUT_ROW} [data-session-readout-clear]`)
    await page.mouse.click(a.x, a.y)
    await settle(page)
    await expect(clear).toHaveCount(1)
    await expect(lineClear).toBeVisible()
    await expectNoShift('pin (readout Clear shows)')
    await lineClear.click()
    await settle(page)
    await expect(clear).toHaveCount(0)
    await expect(lineClear).toBeHidden()
    await expectNoShift('close (readout Clear)')
    expect(await focusedIsPlot(page)).toBe(true)
  })

  // The harness's fake clock replaces performance (no User Timing entries), so
  // the sp:* marks are checked on the perf build instead (evidence u08/perf).
  test('A4: wheel sweep 36/36 over the card zooms with scrollY unchanged', async ({ page }) => {
    await open(page)
    const card = await pageBox(page.locator(CARD))
    const rows = 12
    const cols = [card.x + 3, card.x + card.w / 2, card.x + card.w - 3]
    const misses: string[] = []
    let tested = 0
    for (let i = 0; i < rows; i += 1) {
      const pageY = card.y + 2 + ((card.h - 4) * i) / (rows - 1)
      for (const x of cols) {
        await toFull(page)
        const scrollY = await page.evaluate(py => {
          window.scrollTo({ top: Math.max(0, py - window.innerHeight / 2), behavior: 'instant' })
          return window.scrollY
        }, pageY)
        const y = pageY - scrollY
        const inCard = await page.evaluate(([px, py, sel]) => !!document.elementFromPoint(px as number, py as number)?.closest(sel as string), [x, y, CARD])
        expect(inCard, `point ${i + 1}/${Math.round(x)} is over the card`).toBe(true)
        tested += 1
        const before = await navWindow(page)
        await page.mouse.move(x, y)
        await page.mouse.wheel(0, -100)
        await settle(page)
        const after = await navWindow(page)
        const scrolled = (await page.evaluate(() => window.scrollY)) - scrollY
        if (after === before || scrolled !== 0) misses.push(`row ${i + 1} x ${Math.round(x - card.x)}: zoomed=${after !== before} scrolled=${scrolled}`)
      }
    }
    expect(tested).toBe(36)
    expect(misses).toEqual([])
  })

  test('A4: the wheel scrolls the page outside the card (selected detail)', async ({ page }) => {
    await open(page)
    const p = await plotPoint(page, 0.5)
    await page.mouse.click(p.x, p.y)
    await settle(page)
    const slot = page.locator('[data-chart-selected-detail-slot]')
    await slot.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }))
    const box = await slot.boundingBox()
    if (!box) throw new Error('detail slot has no box')
    const before = await navWindow(page)
    const y0 = await page.evaluate(() => window.scrollY)
    expect(y0).toBeGreaterThan(0)
    await page.mouse.move(box.x + box.width / 2, box.y + Math.min(20, box.height / 2))
    // Wheel up: over the card it would zoom in; here it scrolls the page, and
    // the card that scrolls under the pointer must not zoom too (core u08-3).
    await page.mouse.wheel(0, -200)
    await settle(page)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(y0)
    expect(await navWindow(page)).toBe(before)
  })

  test('A5/A6: no scrollbars inside the card; no sideways page scroll at 390-2048', async ({ page }) => {
    await open(page)
    for (const width of [390, 720, 860, 999, 1440, 1707, 2048]) {
      await page.setViewportSize({ width, height: 900 })
      await settle(page)
      const out = await page.evaluate(sel => {
        const bars = [...document.querySelectorAll<HTMLElement>(`${sel}, ${sel} *`)].flatMap(el => {
          const cs = getComputedStyle(el)
          if (!/(auto|scroll)/.test(cs.overflowX + cs.overflowY)) return []
          const bx = parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth)
          const by = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth)
          const dx = el.offsetWidth - el.clientWidth - bx
          const dy = el.offsetHeight - el.clientHeight - by
          return dx > 0.5 || dy > 0.5 ? [`${el.tagName}.${el.className} ${dx}x${dy}`] : []
        })
        return { scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, bars }
      }, CARD)
      expect(out.scrollWidth, `scrollWidth at ${width}`).toBeLessThanOrEqual(out.innerWidth)
      expect(out.bars, `scrollbars at ${width}`).toEqual([])
    }
  })
})

test.describe('session chart part (d3) on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, contextOptions: { reducedMotion: 'reduce' } })

  test('toolbar above the plot: series + range 1h/4h/Full, then Expand + Show on chart; plot 340 -> 420', async ({ page }) => {
    await open(page)
    await page.locator(PART).scrollIntoViewIfNeeded()
    const tool = page.locator(`${PART} [data-chart-focus-bar]`)
    await expect(tool.locator('[data-session-series-seg]')).toBeVisible()
    await expect(page.locator(`${READOUT_ROW} [data-session-readout]`)).toBeVisible()
    await expect(page.locator('[data-session-range-seg]')).toHaveCount(1)
    await expect(page.locator(`${PART} .ssc-tool2`)).toHaveCount(0)
    await expect(tool.locator('[data-session-range-seg] button')).toHaveText(['1h', '4h', 'Full'])
    await expect(tool.locator('[data-session-expand]')).toBeVisible()
    await expect(tool.locator(SHOW)).toBeVisible()
    // session-original at 390: series and range on the first row, Expand and
    // Show on chart on the second.
    const mid = (b: { y: number; h: number }) => b.y + b.h / 2
    const series = await pageBox(tool.locator('[data-session-series-seg]'))
    const range = await pageBox(tool.locator('[data-session-range-seg]'))
    const expand = await pageBox(tool.locator('[data-session-expand]'))
    const show = await pageBox(tool.locator(SHOW))
    expect(Math.abs(mid(series) - mid(range))).toBeLessThanOrEqual(1)
    expect(Math.abs(mid(expand) - mid(show))).toBeLessThanOrEqual(1)
    expect(expand.y).toBeGreaterThan(series.y + series.h - 0.5)
    const plot = await pageBox(page.locator(PLOT))
    expect(plot.h).toBe(340)
    const bar = await pageBox(tool)
    expect(plot.y).toBeGreaterThan(bar.y + bar.h - 0.5)
    await tool.locator('[data-session-expand]').click()
    await settle(page)
    expect((await pageBox(page.locator(PLOT))).h).toBe(420)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})
