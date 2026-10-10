import { expect, test, type Locator, type Page } from '@playwright/test'
import { installHubUxMock } from './helpers/hubUxMock'
import {
  buildMinutes,
  installPortalAcceptanceHarness,
  openAnalyticsSession,
} from './helpers/portalAcceptanceHarness'

// Owner report (2026-10-09): "scroll zoom doesn't work on global activity graph
// ... same as streamer analytics". Both charts share one navigator, so every
// wheel profile must do the same thing on both: with Scroll zoom on or Alt held
// it zooms by the total delta (one 100px notch = e^0.25, however the delta is
// split into events), and nothing else moves the page; with Scroll zoom off the
// page scrolls and the chart stays put; Shift+wheel and horizontal swipes pan;
// Ctrl/Meta+wheel stay the browser's zoom. Nothing is taken from the page
// without an effect.

type Mode = 'off' | 'on' | 'alt'

interface Surface {
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

async function openHub(page: Page): Promise<Surface> {
  await installHubUxMock(page)
  await page.goto('/analytics')
  const navigator = page.locator('.figma-global-activity__hub-chart [data-hub-chart-navigator], [data-hub-chart-navigator]').first()
  await expect(navigator).toHaveAttribute('data-hub-chart-navigator-window', `0:${HUB_BUCKETS - 1}`, { timeout: 30_000 })
  const plot = page.locator('[data-hub-chart-wheel-surface]')
  const stack = page.locator('.hx-plot-stack').first()
  return {
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
  const navigator = page.locator('[data-session-chart-navigator] [data-hub-chart-navigator]')
  await expect(navigator).toHaveAttribute('data-hub-chart-navigator-window', `0:${STREAM_MINUTES - 1}`, { timeout: 30_000 })
  const plot = page.locator('svg[aria-label="Analytics timeline chart"] rect[data-chart-touch-action]')
  return {
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

async function setScrollZoom(surface: Surface, on: boolean) {
  const toggle = surface.navigator.getByRole('button', { name: /Scroll zoom/ })
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

for (const [surfaceName, open] of Object.entries(SURFACES)) {
  test.describe(`${surfaceName} chart wheel matrix`, () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    for (const mode of ['on', 'alt'] as Mode[]) {
      test(`${mode === 'on' ? 'Scroll zoom on' : 'Alt held'}: every profile zooms by its total delta and keeps the page still`, async ({ page }) => {
        const surface = await open(page)
        for (const profile of ZOOM_PROFILES) {
          await reset(surface)
          if (mode === 'on') await setScrollZoom(surface, true)
          const point = await center(page, surface)
          const scrollBefore = await page.evaluate(() => window.scrollY)
          if (mode === 'alt') await page.keyboard.down('Alt')
          await sendProfile(page, point, profile, mode === 'alt' ? { altKey: true } : {})
          if (mode === 'alt') await page.keyboard.up('Alt')
          await surface.settle()
          const expected = surface.full * Math.exp(totalPixels(profile) * 0.0025)
          const { count } = stepsOf(await surface.navigator.getAttribute('data-hub-chart-navigator-window'))
          expect(Math.abs(count - expected), `${profile.name}: ${count} of ${surface.full}, expected about ${expected.toFixed(1)}`).toBeLessThanOrEqual(1.5)
          // The plot shows the zoomed view too, not only the readout.
          expect(Math.abs((await surface.plotSteps()) - count), `${profile.name}: plot follows the navigator`).toBeLessThanOrEqual(1)
          expect(await page.evaluate(() => window.scrollY), `${profile.name}: the page did not scroll`).toBe(scrollBefore)
        }
      })
    }

    test('Scroll zoom off: every profile scrolls the page and leaves the chart alone', async ({ page }) => {
      const surface = await open(page)
      await reset(surface)
      await setScrollZoom(surface, false)
      for (const profile of ZOOM_PROFILES) {
        const point = await center(page, surface)
        const scrollBefore = await page.evaluate(() => window.scrollY)
        expect(scrollBefore, 'the page can scroll up from here').toBeGreaterThan(50)
        const kept = await sendProfile(page, point, profile)
        if (kept != null) expect(kept, `${profile.name}: the page keeps the event`).toBe(1)
        else await expect.poll(() => page.evaluate(() => window.scrollY), { message: `${profile.name}: the page scrolls` }).toBeLessThan(scrollBefore)
        await surface.settle()
        await expect(surface.navigator).toHaveAttribute('data-hub-chart-navigator-window', `0:${surface.full - 1}`)
      }
    })

    test('Shift+wheel and horizontal swipes pan a zoomed view; Ctrl/Meta+wheel stay browser zoom', async ({ page }) => {
      const surface = await open(page)
      await reset(surface)
      await setScrollZoom(surface, true)
      let point = await center(page, surface)
      for (let notch = 0; notch < 4; notch += 1) await page.mouse.wheel(0, -100)
      await surface.settle()
      const zoomed = stepsOf(await surface.navigator.getAttribute('data-hub-chart-navigator-window'))
      expect(zoomed.count).toBeLessThan(surface.full / 2)

      // Shift + one notch pans an eighth of the view (800px = one view).
      point = await center(page, surface)
      const scrollBefore = await page.evaluate(() => window.scrollY)
      await page.keyboard.down('Shift')
      await page.mouse.wheel(0, 100)
      await page.keyboard.up('Shift')
      await surface.settle()
      const shifted = stepsOf(await surface.navigator.getAttribute('data-hub-chart-navigator-window'))
      expect(shifted.count).toBe(zoomed.count)
      expect(Math.abs(shifted.start - zoomed.start - zoomed.count / 8)).toBeLessThanOrEqual(1.5)

      // A horizontal trackpad swipe of small deltas pans by its total too.
      for (let event = 0; event < 20; event += 1) await page.mouse.wheel(5, 0)
      await surface.settle()
      const swiped = stepsOf(await surface.navigator.getAttribute('data-hub-chart-navigator-window'))
      expect(swiped.count).toBe(zoomed.count)
      expect(Math.abs(swiped.start - shifted.start - zoomed.count / 8)).toBeLessThanOrEqual(1.5)
      expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore)

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
      expect(stepsOf(await surface.navigator.getAttribute('data-hub-chart-navigator-window')).count).toBe(zoomed.count)
    })
  })
}

test.describe('wheel zoom at the owner window (2048x1018 at 125%)', () => {
  test.use({ viewport: { width: 2048, height: 1018 }, deviceScaleFactor: 1.25 })

  for (const [surfaceName, open] of Object.entries(SURFACES)) {
    test(`${surfaceName}: a notch and a high-resolution burst zoom the same amount`, async ({ page }) => {
      const surface = await open(page)
      const counts: number[] = []
      for (const profile of [ZOOM_PROFILES[0]!, ZOOM_PROFILES[3]!]) {
        await reset(surface)
        await setScrollZoom(surface, true)
        const point = await center(page, surface)
        await sendProfile(page, point, profile)
        await surface.settle()
        counts.push(stepsOf(await surface.navigator.getAttribute('data-hub-chart-navigator-window')).count)
      }
      expect(Math.abs(counts[0]! - counts[1]!)).toBeLessThanOrEqual(1)
      expect(counts[0]!).toBeLessThan(surface.full)
    })
  }
})
