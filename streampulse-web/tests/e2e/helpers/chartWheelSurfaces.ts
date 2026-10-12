import { expect, type Locator, type Page } from '@playwright/test'
import { installHubUxMock } from './hubUxMock'
import {
  buildMinutes,
  installPortalAcceptanceHarness,
  openAnalyticsSession,
} from './portalAcceptanceHarness'

/**
 * The two website charts that share the wheel-zoom navigator, opened on mocked
 * data: the hub's Global activity chart (/analytics) and the stream chart
 * (/analytics/:login/:streamId). Shared by the wheel specs.
 */
export interface ChartSurface {
  name: 'hub' | 'stream'
  navigator: Locator
  /** The plot box. */
  plot: Locator
  /** Navigator steps at the full range. */
  full: number
  /** Lets queued frames and timers run so the plot reaches its target. */
  settle: () => Promise<void>
  /** The plot's own visible range, as navigator steps, once settled. */
  plotSteps: () => Promise<number>
}

export const HUB_BUCKETS = 240
export const STREAM_MINUTES = 748
export const SCROLL_ZOOM_STORAGE_KEY = 'sp.chart.scrollZoom.v1'

export async function openHub(page: Page): Promise<ChartSurface> {
  await installHubUxMock(page)
  await page.goto('/analytics')
  return hubSurface(page)
}

export async function hubSurface(page: Page): Promise<ChartSurface> {
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

export async function openStream(page: Page): Promise<ChartSurface> {
  const harness = await installPortalAcceptanceHarness(page)
  harness.setMinutesPayload(buildMinutes({ count: STREAM_MINUTES, withEmotes: true }))
  await openAnalyticsSession(page)
  return streamSurface(page)
}

export async function streamSurface(page: Page): Promise<ChartSurface> {
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

export const CHART_SURFACES = { hub: openHub, stream: openStream } as const

export function stepsOf(window: string | null): { start: number; end: number; count: number } {
  const [start, end] = String(window).split(':').map(Number)
  return { start: start!, end: end!, count: end! - start! + 1 }
}

export const windowOf = async (surface: ChartSurface) => stepsOf(await surface.navigator.getAttribute('data-hub-chart-navigator-window'))
export const scrollYOf = (page: Page) => page.evaluate(() => window.scrollY)

export async function resetZoom(surface: ChartSurface) {
  const button = surface.navigator.getByRole('button', { name: 'Reset zoom' })
  if (await button.isEnabled()) await button.click()
  await surface.settle()
  await expect(surface.navigator).toHaveAttribute('data-hub-chart-navigator-window', `0:${surface.full - 1}`)
}

export const scrollZoomToggleOf = (surface: ChartSurface) => surface.navigator.getByRole('button', { name: /Scroll zoom/ })

export async function setScrollZoom(surface: ChartSurface, on: boolean) {
  const toggle = scrollZoomToggleOf(surface)
  if ((await toggle.getAttribute('aria-pressed')) !== String(on)) await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', String(on))
}
