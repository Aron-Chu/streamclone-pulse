import { expect, test, type Locator, type Page } from '@playwright/test'
import { installHubUxMock } from './helpers/hubUxMock'
import {
  buildMinutes,
  installPortalAcceptanceHarness,
  openAnalyticsSession,
} from './helpers/portalAcceptanceHarness'

// Owner report (2026-10-09): "zoom still doesn't work on any of the graph with
// the scroll wheel" (+ and − worked). Both charts share one navigator, and a
// plain wheel over the plot now zooms by default: Scroll zoom starts On and is
// remembered in this browser (sp.chart.scrollZoom.v1). This intentionally
// replaces the earlier rule "plain wheel scrolls the page".
//
// Every wheel profile must do the same thing on both charts: with Scroll zoom
// on (the default) or Alt held, it zooms by the total delta (one 100px notch =
// e^0.25, however the delta is split into events) and the page stays still;
// with Scroll zoom off the page scrolls and the chart stays put; Shift+wheel
// and horizontal swipes pan; Ctrl/Meta+wheel stay the browser's zoom. The page
// is never trapped: a zoom-out at the full range, a wheel outside the plot,
// and a page scroll that sweeps the plot under the pointer all scroll the page.

type Mode = 'default' | 'off' | 'alt'

interface Surface {
  name: 'hub' | 'stream'
  navigator: Locator
  plot: Locator
  full: number
  /** Lets queued frames and timers run so the plot reaches its target. */
  settle: () => Promise<void>
  /** The plot's own visible range, as navigator steps, once settled. */
  plotSteps: () => Promise<number>
}

const HUB_BUCKETS = 240
const STREAM_MINUTES = 748
const STORAGE_KEY = 'sp.chart.scrollZoom.v1'

async function openHub(page: Page): Promise<Surface> {
  await installHubUxMock(page)
  await page.goto('/analytics')
  return hubSurface(page)
}

async function hubSurface(page: Page): Promise<Surface> {
  const navigator = page.locator('.figma-global-activity__hub-chart [data-hub-chart-navigator], [data-hub-chart-navigator]').first()
  await expect(navigator).toHaveAttribute('data-hub-chart-navigator-window', `0:${HUB_BUCKETS - 1}`, { timeout: 30_000 })
  const plot = page.locator('[data-hub-chart-wheel-surface]')
  const stack = page.locator('.hx-plot-stack').first()
  return {
    name: 'hub',
    navigator,
    plot,
    full: HUB_BUCKETS,
    // No fake clock on the hub: frames run; the safety timer lands it regardless.
    settle: async () => {
      // Let React commit the last wheel event before comparing.
      await page.waitForTimeout(50)
      await expect.poll(async () => {
        const window = await navigator.getAttribute('data-hub-chart-navigator-window')
        const plotted = `${await stack.getAttribute('data-hub-chart-viewport-start')}:${await stack.getAttribute('data-hub-chart-viewport-end')}`
        return plotted === window
      }, { timeout: 5_000 }).toBe(true)
    },
    plotSteps: async () => {
      const start = Number(await stack.getAttribute('data-hub-chart-viewport-start'))
      const end = Number(await stack.getAttribute('data-hub-chart-viewport-end'))
      return end - start + 1
    },
  }
}

async function openStream(page: Page): Promise<Surface> {
  const harness = await installPortalAcceptanceHarness(page)
  harness.setMinutesPayload(buildMinutes({ count: STREAM_MINUTES, withEmotes: true }))
  await openAnalyticsSession(page)
  return streamSurface(page)
}

async function streamSurface(page: Page): Promise<Surface> {
  const navigator = page.locator('[data-session-chart-navigator] [data-hub-chart-navigator]')
  await expect(navigator).toHaveAttribute('data-hub-chart-navigator-window', `0:${STREAM_MINUTES - 1}`, { timeout: 30_000 })
  const plot = page.locator('svg[aria-label="Analytics timeline chart"] rect[data-chart-touch-action]')
  return {
    name: 'stream',
    navigator,
    plot,
    full: STREAM_MINUTES,
    // The harness installs a fake clock: run the queued frames and timers.
    settle: async () => {
      // Let React commit the last wheel event, then run its frames and timers.
      await page.waitForTimeout(50)
      const clock = page.clock as { runFor?: (ms: number) => Promise<void> }
      if (typeof clock.runFor === 'function') await clock.runFor(600)
    },
    plotSteps: async () => {
      const start = Number(await plot.getAttribute('data-chart-viewport-start'))
      const end = Number(await plot.getAttribute('data-chart-viewport-end'))
      return Math.round((end - start) / 60) + 1
    },
  }
}

const SURFACES = { hub: openHub, stream: openStream } as const

/** Wheel profiles: deltas in pixels (CDP, deltaMode 0) or one Firefox-style line event. */
const ZOOM_PROFILES: Array<{ name: string; deltas?: number[]; lines?: number }> = [
  { name: 'Chrome notch -100', deltas: [-100] },
  { name: 'Windows notch -120', deltas: [-120] },
  { name: 'high-resolution 12 x -8', deltas: Array.from({ length: 12 }, () => -8) },
  { name: 'smooth scrolling 25 x -4', deltas: Array.from({ length: 25 }, () => -4) },
  { name: 'trackpad 40 x -2.5', deltas: Array.from({ length: 40 }, () => -2.5) },
  { name: 'trackpad 50 x -2 then 50 x +1', deltas: [...Array.from({ length: 50 }, () => -2), ...Array.from({ length: 50 }, () => 1)] },
  { name: 'Firefox lines -3 (deltaMode 1)', lines: -3 },
]

const totalPixels = (profile: (typeof ZOOM_PROFILES)[number]) =>
  profile.lines != null ? profile.lines * (100 / 3) : profile.deltas!.reduce((sum, delta) => sum + delta, 0)

function stepsOf(window: string | null): { start: number; end: number; count: number } {
  const [start, end] = String(window).split(':').map(Number)
  return { start: start!, end: end!, count: end! - start! + 1 }
}

const windowOf = async (surface: Surface) => stepsOf(await surface.navigator.getAttribute('data-hub-chart-navigator-window'))
const scrollYOf = (page: Page) => page.evaluate(() => window.scrollY)

async function center(page: Page, surface: Surface): Promise<{ x: number; y: number }> {
  await surface.plot.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
  const box = await surface.plot.boundingBox()
  if (!box) throw new Error('plot has no layout box')
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(point.x, point.y)
  return point
}

async function reset(surface: Surface) {
  const button = surface.navigator.getByRole('button', { name: 'Reset zoom' })
  if (await button.isEnabled()) await button.click()
  await surface.settle()
  await expect(surface.navigator).toHaveAttribute('data-hub-chart-navigator-window', `0:${surface.full - 1}`)
}

const toggleOf = (surface: Surface) => surface.navigator.getByRole('button', { name: /Scroll zoom/ })

async function setScrollZoom(surface: Surface, on: boolean) {
  const toggle = toggleOf(surface)
  if ((await toggle.getAttribute('aria-pressed')) !== String(on)) await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', String(on))
}

/** Sends one profile at the pointer. Returns how many line events the page kept (not prevented). */
async function sendProfile(page: Page, point: { x: number; y: number }, profile: (typeof ZOOM_PROFILES)[number], modifiers: { altKey?: boolean; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {}) {
  if (profile.lines != null) {
    // CDP can only send pixel deltas; a line-mode event is dispatched in the page.
    return page.evaluate(({ x, y, lines, modifiers }) => {
      const target = document.elementFromPoint(x, y)!
      const event = new WheelEvent('wheel', {
        bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y,
        deltaMode: 1, deltaY: lines, ...modifiers,
      })
      target.dispatchEvent(event)
      return event.defaultPrevented ? 0 : 1
    }, { ...point, lines: profile.lines, modifiers })
  }
  for (const delta of profile.deltas!) await page.mouse.wheel(0, delta)
  return null
}

/**
 * Records, for every wheel event the page receives, whether the pointer was
 * over the plot box and whether anything took the event from the page.
 */
async function recordWheels(page: Page, plotSelector: string) {
  await page.evaluate((selector) => {
    const store = window as unknown as { wheelLog?: Array<{ overPlot: boolean; prevented: boolean }> }
    store.wheelLog = []
    const pending = new WeakMap<Event, boolean>()
    window.addEventListener('wheel', (event) => {
      const plot = document.querySelector(selector)
      const rect = plot?.getBoundingClientRect()
      const inside = Boolean(rect && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom)
      // Over the plot box, and the chart (not a sticky header) is what the pointer hits.
      const surface = plot?.closest('[data-hub-chart-wheel-surface], [data-session-chart-stack]')
      pending.set(event, inside && Boolean(surface && event.target instanceof Node && surface.contains(event.target)))
    }, { capture: true, passive: true })
    window.addEventListener('wheel', (event) => {
      store.wheelLog!.push({ overPlot: pending.get(event) ?? false, prevented: event.defaultPrevented })
    }, { passive: true })
  }, plotSelector)
  return () => page.evaluate(() => (window as unknown as { wheelLog: Array<{ overPlot: boolean; prevented: boolean }> }).wheelLog.slice())
}

const PLOT_SELECTOR = {
  hub: '[data-hub-chart-wheel-surface]',
  stream: 'svg[aria-label="Analytics timeline chart"] rect[data-chart-touch-action]',
} as const

for (const [surfaceName, open] of Object.entries(SURFACES)) {
  test.describe(`${surfaceName} chart wheel matrix`, () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    for (const mode of ['default', 'alt'] as Mode[]) {
      test(`${mode === 'default' ? 'Scroll zoom on by default' : 'Scroll zoom off, Alt held'}: every profile zooms by its total delta and keeps the page still`, async ({ page }) => {
        const surface = await open(page)
        // A fresh profile starts with Scroll zoom on.
        await expect(toggleOf(surface)).toHaveAttribute('aria-pressed', 'true')
        if (mode === 'alt') await setScrollZoom(surface, false)
        for (const profile of ZOOM_PROFILES) {
          await reset(surface)
          const point = await center(page, surface)
          const scrollBefore = await scrollYOf(page)
          if (mode === 'alt') await page.keyboard.down('Alt')
          const kept = await sendProfile(page, point, profile, mode === 'alt' ? { altKey: true } : {})
          if (mode === 'alt') await page.keyboard.up('Alt')
          if (kept != null) expect(kept, `${profile.name}: taken from the page`).toBe(0)
          await surface.settle()
          const expected = surface.full * Math.exp(totalPixels(profile) * 0.0025)
          const { count } = await windowOf(surface)
          expect(Math.abs(count - expected), `${profile.name}: ${count} of ${surface.full}, expected about ${expected.toFixed(1)}`).toBeLessThanOrEqual(1.5)
          // The plot shows the zoomed view too, not only the readout.
          expect(Math.abs((await surface.plotSteps()) - count), `${profile.name}: plot follows the navigator`).toBeLessThanOrEqual(1)
          expect(await scrollYOf(page), `${profile.name}: the page did not scroll`).toBe(scrollBefore)
        }
      })
    }

    test('Scroll zoom off: every profile scrolls the page and leaves the chart alone', async ({ page }) => {
      const surface = await open(page)
      await reset(surface)
      await setScrollZoom(surface, false)
      await expect(surface.navigator.locator('.hx-chart-navigator__hint')).toHaveText('Scroll zoom is off: the wheel scrolls the page · Hold Alt and scroll to zoom · Shift + scroll to pan')
      for (const profile of ZOOM_PROFILES) {
        const point = await center(page, surface)
        const scrollBefore = await scrollYOf(page)
        expect(scrollBefore, 'the page can scroll up from here').toBeGreaterThan(50)
        const kept = await sendProfile(page, point, profile)
        if (kept != null) expect(kept, `${profile.name}: the page keeps the event`).toBe(1)
        else await expect.poll(() => scrollYOf(page), { message: `${profile.name}: the page scrolls` }).toBeLessThan(scrollBefore)
        await surface.settle()
        await expect(surface.navigator).toHaveAttribute('data-hub-chart-navigator-window', `0:${surface.full - 1}`)
      }
    })

    test('Shift+wheel and horizontal swipes pan a zoomed view; Ctrl/Meta+wheel stay browser zoom', async ({ page }) => {
      const surface = await open(page)
      await reset(surface)
      let point = await center(page, surface)
      for (let notch = 0; notch < 4; notch += 1) await page.mouse.wheel(0, -100)
      await surface.settle()
      const zoomed = await windowOf(surface)
      expect(zoomed.count).toBeLessThan(surface.full / 2)

      // Shift + one notch pans an eighth of the view (800px = one view).
      point = await center(page, surface)
      const scrollBefore = await scrollYOf(page)
      await page.keyboard.down('Shift')
      await page.mouse.wheel(0, 100)
      await page.keyboard.up('Shift')
      await surface.settle()
      const shifted = await windowOf(surface)
      expect(shifted.count).toBe(zoomed.count)
      expect(Math.abs(shifted.start - zoomed.start - zoomed.count / 8)).toBeLessThanOrEqual(1.5)

      // A horizontal trackpad swipe of small deltas pans by its total too.
      for (let event = 0; event < 20; event += 1) await page.mouse.wheel(5, 0)
      await surface.settle()
      const swiped = await windowOf(surface)
      expect(swiped.count).toBe(zoomed.count)
      expect(Math.abs(swiped.start - shifted.start - zoomed.count / 8)).toBeLessThanOrEqual(1.5)
      expect(await scrollYOf(page)).toBe(scrollBefore)

      // Ctrl/Meta+wheel (and a touchpad pinch, which arrives as Ctrl+wheel)
      // are never taken from the browser, in any mode.
      for (const scrollZoom of [true, false]) {
        await setScrollZoom(surface, scrollZoom)
        for (const modifiers of [{ ctrlKey: true }, { metaKey: true }, { ctrlKey: true, altKey: true }]) {
          const kept = await sendProfile(page, point, { name: 'modified', lines: -3 }, modifiers)
          expect(kept, JSON.stringify(modifiers)).toBe(1)
        }
      }
      await surface.settle()
      expect((await windowOf(surface)).count).toBe(zoomed.count)
    })

    test('the page is never trapped: a zoom-out at the full range scrolls the page, a zoom-in at the floor is held only mid-gesture', async ({ page }) => {
      const surface = await open(page)
      await reset(surface)
      const read = await recordWheels(page, PLOT_SELECTOR[surface.name])

      // Wheel-down over the plot at the full range: nothing to zoom out to.
      await center(page, surface)
      const top = await scrollYOf(page)
      for (let notch = 0; notch < 3; notch += 1) await page.mouse.wheel(0, 100)
      await expect.poll(() => scrollYOf(page), { message: 'a wheel-down at the full range scrolls the page' }).toBeGreaterThan(top)
      await surface.settle()
      await expect(surface.navigator).toHaveAttribute('data-hub-chart-navigator-window', `0:${surface.full - 1}`)
      expect((await read()).every(entry => !entry.prevented), 'nothing took the wheel-down from the page').toBe(true)

      // Zoom in all the way in one gesture: the notches past the floor are taken.
      await page.waitForTimeout(600)
      await center(page, surface)
      const atFloorScroll = await scrollYOf(page)
      for (let notch = 0; notch < 28; notch += 1) await page.mouse.wheel(0, -100)
      await surface.settle()
      const floor = (await windowOf(surface)).count
      expect(floor, 'reached the zoom floor').toBeLessThanOrEqual(surface.name === 'hub' ? 2 : 6)
      await expect(surface.navigator.getByRole('button', { name: 'Zoom in' })).toBeDisabled()
      expect(await scrollYOf(page), 'zooming into the floor did not move the page').toBe(atFloorScroll)

      // A fresh wheel-up after a pause has nothing to zoom: the page gets it.
      await page.waitForTimeout(1_700)
      await page.mouse.wheel(0, -100)
      await expect.poll(() => scrollYOf(page), { message: 'a fresh wheel-up at the floor scrolls the page' }).toBeLessThan(atFloorScroll)
      expect((await windowOf(surface)).count).toBe(floor)
    })

    test('a page scroll that sweeps the plot under the pointer keeps scrolling; after 600 ms of quiet a wheel zooms', async ({ page }) => {
      const surface = await open(page)
      await reset(surface)
      // Zoom in first (with the button, not the wheel), so a wheel-down over
      // the plot would have something to zoom out to.
      await surface.navigator.getByRole('button', { name: 'Zoom in' }).click()
      await surface.settle()
      const zoomed = await windowOf(surface)
      expect(zoomed.count).toBeLessThan(surface.full)
      await page.waitForTimeout(600)
      // Park the plot below the pointer, then wheel the page down so the plot
      // (and the navigator under it) pass up under the pointer.
      // Below any sticky site header.
      const pointer = { x: 0, y: 260 }
      await surface.plot.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
      const centered = (await surface.plot.boundingBox())!
      await page.evaluate(by => window.scrollBy({ top: by, behavior: 'instant' }), centered.y - (pointer.y + 160))
      const parked = (await surface.plot.boundingBox())!
      pointer.x = parked.x + parked.width / 2
      expect(parked.y, 'the plot starts below the pointer').toBeGreaterThan(pointer.y)
      await page.mouse.move(pointer.x, pointer.y)
      const read = await recordWheels(page, PLOT_SELECTOR[surface.name])
      const scrollBefore = await scrollYOf(page)
      // 14 notches, 70 ms apart: well inside the 400 ms window, and slow enough
      // for the page (and so the plot) to move under the pointer between them.
      for (let event = 0; event < 14; event += 1) {
        await page.mouse.wheel(0, 100)
        await page.waitForTimeout(70)
      }
      // The page scrolls until the sweep ends (or it reaches the bottom of the page).
      await expect.poll(() => scrollYOf(page)).toBeGreaterThan(scrollBefore + 150)
      await surface.settle()
      const sweep = await read()
      expect(sweep.filter(entry => entry.overPlot).length, 'the plot passed under the pointer').toBeGreaterThan(0)
      expect(sweep.filter(entry => entry.prevented).length, 'every sweep event scrolled the page').toBe(0)
      expect(await windowOf(surface), 'the sweep did not zoom').toEqual(zoomed)

      // After 600 ms of quiet, a wheel over the plot zooms (out, here).
      await page.waitForTimeout(600)
      await center(page, surface)
      const still = await scrollYOf(page)
      await page.mouse.wheel(0, 100)
      await surface.settle()
      expect((await windowOf(surface)).count).toBeGreaterThan(zoomed.count)
      expect(await scrollYOf(page)).toBe(still)
    })

    test('outside the plot the page scrolls: the navigator buttons, readout and hint', async ({ page }) => {
      const surface = await open(page)
      await reset(surface)
      for (const part of ['.hx-chart-navigator__zoom-buttons button', '.hx-chart-navigator__readout', '.hx-chart-navigator__hint']) {
        const target = surface.navigator.locator(part).first()
        await target.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
        const box = (await target.boundingBox())!
        await page.mouse.move(box.x + Math.min(10, box.width / 2), box.y + box.height / 2)
        const before = await scrollYOf(page)
        await page.mouse.wheel(0, -120)
        await expect.poll(() => scrollYOf(page), { message: `${part} scrolls the page` }).toBeLessThan(before)
        await surface.settle()
        await expect(surface.navigator).toHaveAttribute('data-hub-chart-navigator-window', `0:${surface.full - 1}`)
        await page.waitForTimeout(450)
      }
      // The navigator track is a zoom surface.
      const track = (await surface.navigator.locator('.hx-chart-navigator__track').boundingBox())!
      await page.mouse.move(track.x + track.width / 2, track.y + track.height / 2)
      const before = await scrollYOf(page)
      await page.mouse.wheel(0, -100)
      await surface.settle()
      expect((await windowOf(surface)).count).toBeLessThan(surface.full)
      expect(await scrollYOf(page)).toBe(before)
    })

    test('Scroll zoom is remembered: off survives a reload, cleared storage means on', async ({ page }) => {
      let surface = await open(page)
      await setScrollZoom(surface, false)
      expect(await page.evaluate(key => window.localStorage.getItem(key), STORAGE_KEY)).toBe('off')
      await page.reload()
      if (surface.name === 'stream') await openAnalyticsSession(page)
      surface = surface.name === 'hub' ? await hubSurface(page) : await streamSurface(page)
      await expect(toggleOf(surface)).toHaveAttribute('aria-pressed', 'false')
      // Reset and Escape never change the choice.
      await toggleOf(surface).focus()
      await page.keyboard.press('Escape')
      await expect(toggleOf(surface)).toHaveAttribute('aria-pressed', 'false')
      await page.evaluate(() => window.localStorage.clear())
      await page.reload()
      if (surface.name === 'stream') await openAnalyticsSession(page)
      surface = surface.name === 'hub' ? await hubSurface(page) : await streamSurface(page)
      await expect(toggleOf(surface)).toHaveAttribute('aria-pressed', 'true')
      await expect(toggleOf(surface)).toHaveAttribute('title', 'Remembered in this browser')
    })

    test('blocked storage: Scroll zoom defaults to on and the toggle still works for the page', async ({ page }) => {
      // Reading or writing this key throws, as in a locked-down browser.
      await page.addInitScript((key) => {
        const getItem = Storage.prototype.getItem
        const setItem = Storage.prototype.setItem
        Storage.prototype.getItem = function (name: string) {
          if (name === key) throw new DOMException('blocked', 'SecurityError')
          return getItem.call(this, name)
        }
        Storage.prototype.setItem = function (name: string, value: string) {
          if (name === key) throw new DOMException('blocked', 'SecurityError')
          return setItem.call(this, name, value)
        }
      }, STORAGE_KEY)
      const surface = await open(page)
      await expect(toggleOf(surface)).toHaveAttribute('aria-pressed', 'true')
      let point = await center(page, surface)
      await page.mouse.wheel(0, -100)
      await surface.settle()
      expect((await windowOf(surface)).count).toBeLessThan(surface.full)
      await reset(surface)
      await setScrollZoom(surface, false)
      point = await center(page, surface)
      const before = await scrollYOf(page)
      await page.mouse.wheel(0, -100)
      await expect.poll(() => scrollYOf(page)).toBeLessThan(before)
      await surface.settle()
      await expect(surface.navigator).toHaveAttribute('data-hub-chart-navigator-window', `0:${surface.full - 1}`)
      await setScrollZoom(surface, true)
      await page.waitForTimeout(600)
      point = await center(page, surface)
      await page.mouse.move(point.x, point.y)
      await page.mouse.wheel(0, -100)
      await surface.settle()
      expect((await windowOf(surface)).count).toBeLessThan(surface.full)
    })
  })
}

test.describe('stream chart: only the plot box zooms', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('a wheel over the axis labels, the legend or the games strip scrolls the page', async ({ page }) => {
    const surface = await openStream(page)
    await reset(surface)
    const plot = (await surface.plot.boundingBox())!
    const stack = page.locator('[data-session-chart-stack]')
    const spots = await stack.evaluate((element, plotBox) => {
      const stackBox = element.getBoundingClientRect()
      const out: Array<{ name: string; x: number; y: number }> = []
      // The time axis labels sit just under the plot box, inside the stack.
      out.push({ name: 'axis labels', x: plotBox.x + plotBox.width / 2, y: plotBox.y + plotBox.height + 8 })
      for (const [name, selector] of [['legend', '[data-chart-focus-bar]'], ['games strip', '[data-games-played]'], ['scale row', '[data-chart-scale-row]']] as const) {
        const node = document.querySelector(selector)
        const rect = node?.getBoundingClientRect()
        if (rect && rect.width > 0 && rect.height > 0) out.push({ name, x: rect.left + Math.min(12, rect.width / 2), y: rect.top + rect.height / 2 })
      }
      return { spots: out, stack: { top: stackBox.top, bottom: stackBox.bottom } }
    }, plot)
    expect(spots.spots.length).toBeGreaterThanOrEqual(2)
    for (const spot of spots.spots) {
      await surface.plot.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
      const now = (await surface.plot.boundingBox())!
      const y = spot.y + (now.y - plot.y)
      const x = spot.x
      // Never inside the plot box.
      expect(y < now.y || y > now.y + now.height || x < now.x || x > now.x + now.width, `${spot.name} is outside the plot box`).toBe(true)
      await page.mouse.move(x, y)
      const before = await scrollYOf(page)
      await page.mouse.wheel(0, -120)
      await expect.poll(() => scrollYOf(page), { message: `${spot.name} scrolls the page` }).toBeLessThan(before)
      await surface.settle()
      await expect(surface.navigator).toHaveAttribute('data-hub-chart-navigator-window', `0:${surface.full - 1}`)
      await page.waitForTimeout(450)
    }
  })
})

test.describe('wheel zoom at the owner window (2048x1018 at 125%)', () => {
  test.use({ viewport: { width: 2048, height: 1018 }, deviceScaleFactor: 1.25 })

  for (const [surfaceName, open] of Object.entries(SURFACES)) {
    test(`${surfaceName}: a notch and a high-resolution burst zoom the same amount, with no setup`, async ({ page }) => {
      const surface = await open(page)
      await expect(toggleOf(surface)).toHaveAttribute('aria-pressed', 'true')
      const counts: number[] = []
      for (const profile of [ZOOM_PROFILES[0]!, ZOOM_PROFILES[3]!]) {
        await reset(surface)
        const point = await center(page, surface)
        await sendProfile(page, point, profile)
        await surface.settle()
        counts.push((await windowOf(surface)).count)
      }
      expect(Math.abs(counts[0]! - counts[1]!)).toBeLessThanOrEqual(1)
      expect(counts[0]!).toBeLessThan(surface.full)
    })
  }
})
