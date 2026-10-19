import { test, expect, type Locator, type Page } from '@playwright/test'
import { installHubUxMock } from './helpers/hubUxMock'

// The d3-v5 hub (PR 1 of 5). Runs only against a build made with VITE_PUBLIC_HUB_V5=on;
// a default build serves the Command Center, which the spec without .hub-v5 covers.
test.skip(!/^(on|1)$/.test(process.env.VITE_PUBLIC_HUB_V5 ?? ''), 'needs a build with VITE_PUBLIC_HUB_V5=on')

// The hub activity chart on the shared SpChart core (2026-10-13 d3 design,
// plan §2.1-§2.3): chat bars at the served bucket floor in the upper panel,
// emotes as a line on the same scale, sampled viewers in the lower quarter
// with hatched gaps, no peak caps or ticks (F3), one Now/hover readout above
// the plot, and the time axis, navigator and provider lanes on the plot edges.

const CARD = '.figma-global-activity__hub-chart'
const PLOT = `${CARD} svg[data-bench-plot]`
const READOUT = `${CARD} [data-hub-readout]`

async function openHub(page: Page, path = '/analytics') {
  await page.goto(path)
  await expect(page.locator(PLOT)).toBeVisible()
}

/** Where the plot, its rows, the bars and the viewer line sit (page px). */
async function chartGeometry(card: Locator) {
  return card.evaluate((root) => {
    const plot = root.querySelector('svg[data-bench-plot]')!.getBoundingClientRect()
    const surface = root.querySelector('[data-hub-plot-box]')!.getBoundingClientRect()
    const rows = ['[data-bench-axis]', '.hx-chart-navigator__track', '[data-hub-provider-lanes] svg']
      .map((selector) => {
        const rect = root.querySelector(selector)!.getBoundingClientRect()
        return { selector, left: rect.left, right: rect.right }
      })
    const bars = Array.from(root.querySelectorAll('.spc-bar')).map((node) => node.getBoundingClientRect()).filter((rect) => rect.width > 0 && rect.height > 0)
    const viewers = Array.from(root.querySelectorAll('.spc-line-viewers path')).map((node) => node.getBoundingClientRect()).filter((rect) => rect.height > 0 || rect.width > 0)
    return {
      plot: { top: plot.top, height: plot.height, left: plot.left, right: plot.right },
      surface: { left: surface.left, right: surface.right, width: surface.width },
      rows,
      barCount: bars.length,
      barsBottom: bars.length ? Math.max(...bars.map((rect) => rect.bottom)) : null,
      barsTop: bars.length ? Math.min(...bars.map((rect) => rect.top)) : null,
      viewersTop: viewers.length ? Math.min(...viewers.map((rect) => rect.top)) : null,
      peakMarks: root.querySelectorAll('svg[data-bench-plot] [class*="peak"], svg[data-bench-plot] [class*="cap"]').length,
    }
  })
}

type ChartGeometry = Awaited<ReturnType<typeof chartGeometry>>

/** The axis, navigator track and provider lanes share the plot's edges; viewers sit under the bars, in the lower quarter. */
function expectChartLayout(geometry: ChartGeometry) {
  for (const row of geometry.rows) {
    expect(Math.abs(row.left - geometry.surface.left), row.selector).toBeLessThanOrEqual(1)
    if (row.selector !== '[data-hub-provider-lanes] svg') expect(Math.abs(row.right - geometry.surface.right), row.selector).toBeLessThanOrEqual(1)
  }
  expect(geometry.peakMarks).toBe(0)
  expect(geometry.viewersTop).not.toBeNull()
  expect(geometry.viewersTop! - geometry.plot.top).toBeGreaterThanOrEqual(geometry.plot.height * 0.7)
  if (geometry.barsBottom != null) expect(geometry.viewersTop!).toBeGreaterThanOrEqual(geometry.barsBottom - 0.5)
}

test('hub chart keeps chat bars over the viewer panel, emotes as a line, and one Now readout', async ({ page }) => {
  await installHubUxMock(page)
  await openHub(page)
  const card = page.locator(CARD)
  await expect(card.locator('.spc-bar')).not.toHaveCount(0)
  await expect(card.locator('.spc-line-emotes path')).not.toHaveCount(0)
  await expect(card.locator('.spc-line-viewers path')).not.toHaveCount(0)
  expectChartLayout(await chartGeometry(card))
  await expect(page.locator(READOUT)).toHaveCount(1)
  await expect(page.locator(READOUT)).toHaveAttribute('data-hub-readout-mode', 'now')
  await expect(page.locator(`${READOUT} .tm .l1`)).toHaveText('Now')
  // Old layers are gone: no SVG tooltips, moment markers or bucket cues on the plot.
  await expect(card.locator('.hx-chart-tip-slot .tip, .hx-moment-marker, .hx-bucket-cue__node')).toHaveCount(0)
})

test('hub chart shows the hovered bar in the readout and returns to Now', async ({ page }) => {
  await installHubUxMock(page)
  await openHub(page)
  const plot = page.locator(PLOT)
  const readout = page.locator(READOUT)
  await plot.scrollIntoViewIfNeeded()
  const box = (await plot.boundingBox())!
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5)
  await expect(readout).toHaveAttribute('data-hub-readout-mode', 'hover')
  await expect(readout.locator('[data-k="viewers"]')).toBeVisible()
  await page.mouse.move(4, 4)
  await expect(readout).toHaveAttribute('data-hub-readout-mode', 'now')
  await expect(readout.locator('.tm .l1')).toHaveText('Now')
})

test('Live Wire explains the detected event and keeps chat plus emote from the same channel', async ({ page }) => {
  await installHubUxMock(page)
  await page.goto('/analytics')

  const liveWire = page.getByRole('region', { name: 'Live Wire' })
  await expect(liveWire).toBeVisible()
  const first = liveWire.locator('[data-stream-id="s1"]').first()
  await expect(first).toContainText('xQc')
  await expect(first).toContainText('Twitch emote spike')
  await expect(first).toContainText('393/m')
  await expect(first).toContainText('133/m')
  // No ready comparison: the row says so plainly, and the baseline evidence
  // stays reachable on the detector's own label.
  await expect(first.locator('.hub-live-wire__rail-comparison')).toContainText('Comparison unavailable')
  await expect(first.locator('.hub-live-wire__magnitude')).toHaveCount(0)
  await expect(first.locator('.hub-live-wire__rail-label')).toHaveAttribute('title', /IRC measured · comparison unavailable/i)
  await expect(first.getByRole('button', { name: /^Show .* on chart$/ })).toBeVisible()
  await expect(first.getByRole('link', { name: /^Stream analytics for / })).toBeVisible()
  await expect(first.getByRole('button', { name: /^Save / })).toBeVisible()
  await expect(first).not.toContainText(/score\s+\d/i)
  await expect(first.locator('.hub-live-wire__bar')).toHaveCount(0)
})

test('Live Wire "Show on chart" selects the matching bar and Escape on the plot clears it', async ({ page }) => {
  await installHubUxMock(page)
  await page.goto('/analytics')

  const liveWire = page.getByRole('region', { name: 'Live Wire' })
  await liveWire.getByRole('button', { name: /^Show .* on chart$/ }).first().click()
  const plot = page.locator(PLOT)
  await expect(plot).toHaveAttribute('data-selection', '')
  await expect(liveWire).toBeVisible()
  await plot.focus()
  await page.keyboard.press('Escape')
  await expect(plot).not.toHaveAttribute('data-selection', /.*/)
})

test('reduced motion leaves Live Wire without entrance animation class churn', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await installHubUxMock(page)
  await page.goto('/analytics')
  await expect(page.getByRole('region', { name: 'Live Wire' })).toBeVisible()
  await expect(page.locator('.hub-live-wire__event-card.is-entering')).toHaveCount(0)
})

test('the plot is 420 px on desktop and 300 px on a phone, with its rows on the plot edges', async ({ page }) => {
  await installHubUxMock(page)
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    await openHub(page)
    const geometry = await chartGeometry(page.locator(CARD))
    expect(Math.round(geometry.plot.height)).toBe(viewport.width < 720 ? 300 : 420)
    // The value-axis column is 68 px (44 px on a phone) to the right of the plot area.
    expect(Math.round(geometry.plot.right - geometry.surface.right)).toBe(viewport.width < 720 ? 44 : 68)
    expectChartLayout(geometry)
  }
})

test('7d diurnal fixture draws bars on the served 10-minute floor with viewers in the lower panel', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-13T12:00:00Z'))
  await installHubUxMock(page, { diurnal7d: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await openHub(page, '/analytics?window=7d')
  await expect(page.locator(`${CARD} [data-hub-activity-header] h2`)).toHaveText('Activity · last 7 days')
  const minutes = Number(await page.locator(PLOT).getAttribute('data-activity-bucket-minutes'))
  expect(minutes % 10).toBe(0)
  await expect(page.locator(`${CARD} .hx-chart-navigator__bucket-count`)).toHaveText(new RegExp(`^(\\d+) of \\1 10-min buckets · bars ${minutes}-min$`))
  expectChartLayout(await chartGeometry(page.locator(CARD)))
})

for (const window of ['30m', '24h', '7d', '1m', '3m', '1y']) {
  test(`all-range layout: ${window} at desktop and mobile widths`, async ({ page }) => {
    await installHubUxMock(page, { matchActivityWindow: true })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 })
      const response = page.waitForResponse((res) => new URL(res.url()).searchParams.get('activityWindow') === window && res.ok())
      await openHub(page, `/analytics?window=${window}`)
      const payload = await (await response).json()
      const expectedMinutes = { '30m': 30, '24h': 1440, '7d': 10080, '1m': 43200, '3m': 129600, '1y': 525600 }[window]
      expect(payload.activity.servedWindowMinutes).toBe(expectedMinutes)
      const heading = { '30m': '30 min', '24h': '24 h', '7d': '7 days', '1m': '30 days', '3m': '90 days', '1y': '365 days' }[window]
      await expect(page.locator(`${CARD} [data-hub-activity-header] h2`)).toHaveText(`Activity · last ${heading}`)
      const seg = page.locator(`${CARD} [data-hub-window-seg] button`)
      await expect(seg).toHaveCount(['1m', '3m', '1y'].includes(window) ? 4 : 3)
      await expect(seg.and(page.locator('[aria-pressed="true"]'))).toHaveCount(1)
      // Bars use the served bucket (or a whole multiple of it once they merge).
      const plot = page.locator(PLOT)
      const minutes = Number(await plot.getAttribute('data-activity-bucket-minutes'))
      expect(minutes % payload.activity.bucketMinutes).toBe(0)
      const geometry = await chartGeometry(page.locator(CARD))
      expect(Math.round(geometry.plot.height)).toBe(width < 720 ? 300 : 420)
      expectChartLayout(geometry)

      await plot.scrollIntoViewIfNeeded()
      const beforeHover = (await plot.boundingBox())!
      const readout = page.locator(READOUT)
      const readoutBefore = (await readout.boundingBox())!
      for (const fraction of [0.1, 0.55, 0.9]) {
        await page.mouse.move(beforeHover.x + geometry.surface.width * fraction, beforeHover.y + beforeHover.height * 0.5)
        await expect(readout).toHaveAttribute('data-hub-readout-mode', 'hover')
        const plotBox = (await plot.boundingBox())!
        const readoutBox = (await readout.boundingBox())!
        expect(readoutBox.y + readoutBox.height).toBeLessThanOrEqual(plotBox.y)
        expect(Math.abs(plotBox.y - beforeHover.y)).toBeLessThan(1)
        expect(Math.abs(plotBox.height - beforeHover.height)).toBeLessThan(1)
        expect(Math.abs(readoutBox.height - readoutBefore.height)).toBeLessThan(1)
        expect(await readout.evaluate((el) => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1)).toBe(true)
      }
      await page.mouse.move(0, 0)
      await expect(readout).toHaveAttribute('data-hub-readout-mode', 'now')
      if (window === '24h') {
        await page.mouse.click(beforeHover.x + geometry.surface.width * 0.55, beforeHover.y + beforeHover.height * 0.55)
        await expect(plot).toHaveAttribute('data-selection', '')
        await plot.focus()
        await page.keyboard.press('Escape')
        await expect(plot).not.toHaveAttribute('data-selection', /.*/)
      }
    }
  })
}
