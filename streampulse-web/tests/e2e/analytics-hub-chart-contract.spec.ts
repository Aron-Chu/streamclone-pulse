import { test, expect } from '@playwright/test'
import { installHubUxMock } from './helpers/hubUxMock'

test('hub chart keeps viewers above truthful chat bars with an external hover readout', async ({ page }) => {
  await installHubUxMock(page)
  await page.goto('/analytics')

  const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
  await expect(chart).toBeVisible()
  // Viewers and emotes use independent line scales; tracked chat is the only
  // bar series. Unlike units are never stacked into one contribution bar.
  await expect(chart.locator('.hx-chart-line--viewers')).not.toHaveCount(0)
  await expect(chart.locator('.hx-chart-line--emotes')).not.toHaveCount(0)
  await expect(chart.locator('[data-component="HubActivityBarSeries"] .hx-chat-bar')).not.toHaveCount(0)
  await expect(chart.locator('.hx-bar-segment--viewers, .hx-bar-segment--emotes')).toHaveCount(0)
  await expect(chart).toHaveAttribute('data-chart-layout', 'viewer-lane')
  const elementsExist = await chart.evaluate((root) => {
    const viewerPaths = Array.from(root.querySelectorAll<SVGGraphicsElement>('.hx-chart-line--viewers'))
    const chatBars = Array.from(root.querySelectorAll<SVGGraphicsElement>('[data-component="HubActivityBarSeries"] .hx-chat-bar'))
    return viewerPaths.length > 0 && chatBars.length > 0 &&
      viewerPaths.every((path) => path.getBBox().y + path.getBBox().height < 50) &&
      chatBars.every((bar) => bar.getBBox().y > 52)
  })
  expect(elementsExist).toBe(true)
  await expect(chart.locator('.hx-viewer-axis-ticks span')).toHaveCount(3)
  const ticks = await chart.locator('.hx-viewer-axis-ticks span').evaluateAll((nodes) => nodes.map((node) => ({ text: node.textContent, rect: node.getBoundingClientRect().toJSON() })))
  expect(ticks[0]!.rect.top).toBeLessThan(ticks[1]!.rect.top)
  expect(ticks[1]!.rect.top).toBeLessThan(ticks[2]!.rect.top)
  const laneGeometry = await chart.evaluate((root) => {
    const viewer = root.querySelector<SVGGraphicsElement>('.hx-chart-line--viewers')
    const chat = root.querySelector<SVGGraphicsElement>('[data-component="HubActivityBarSeries"] .hx-chat-bar')
    return viewer && chat ? { viewerBottom: viewer.getBBox().y + viewer.getBBox().height, chatTop: chat.getBBox().y } : null
  })
  expect(laneGeometry).not.toBeNull()
  expect(laneGeometry!.chatTop - laneGeometry!.viewerBottom).toBeGreaterThan(8)
  await expect(page.locator('.hx-moment-marker')).toHaveCount(0)
  await expect(chart.locator('.hdot')).toHaveCount(0)
  await expect(chart.locator('.hx-bucket-cue__node, .hx-bucket-cue__ring')).toHaveCount(0)
  await expect(chart.locator('.hx-chart-line--chat-detail')).toHaveCount(0)
  await expect(chart.locator('.hx-chart-tip-slot .tip')).toHaveCount(0)
  await expect(page.locator('.hx-chart-header__readout')).toHaveCount(1)
})

test('hub chart shows one reserved external readout on hover and returns to calm', async ({ page }) => {
  await installHubUxMock(page)
  await page.goto('/analytics')

  const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
  const readout = page.locator('.figma-global-activity__hub-chart .hx-chart-header__readout')

  await expect(chart).toBeVisible()
  await expect(chart).not.toHaveAttribute('data-hover')
  await expect(chart.locator('.hx-chart-detail-layer')).toHaveCount(0)

  const box = await chart.boundingBox()
  expect(box).toBeTruthy()
  await chart.hover({ position: { x: box!.width * 0.55, y: box!.height * 0.5 } })

  await expect(chart).toHaveAttribute('data-hover', 'true')
  await expect(readout).toContainText('Viewers')
  await expect(chart.locator('.hx-detail-readout')).toHaveCount(0)
  await expect(page.locator('.hx-moment-marker')).toHaveCount(0)

  await page.mouse.move(4, 4)
  await expect(chart).not.toHaveAttribute('data-hover')
  await expect(readout).toBeVisible()
  await expect(readout).not.toHaveAttribute('data-active')
  await expect(readout.locator('strong')).toHaveText(['—', '—', '—'])
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

test('Live Wire inspection selects the matching chart bucket and Escape clears it', async ({ page }) => {
  await installHubUxMock(page)
  await page.goto('/analytics')

  const liveWire = page.getByRole('region', { name: 'Live Wire' })
  await liveWire.getByRole('button', { name: /^Show .* on chart$/ }).first().click()
  const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
  await expect(chart).toHaveAttribute('data-selected', 'true')
  await expect(liveWire).toBeVisible()
  const chartRegion = page.locator('.analytics-discovery-layout__chart')
  const inspector = chartRegion.locator('.figma-global-activity__inspector')
  await expect(inspector).toBeVisible()
  const geometry = await page.evaluate(() => {
    const chart = document.querySelector<HTMLElement>('.figma-global-activity__chart-col')
    const inspector = document.querySelector<HTMLElement>('.figma-global-activity__inspector')
    const container = document.querySelector('.figma-activity-hub')
    const plotColumn = document.querySelector('.figma-global-activity__chart-col')
    return chart && inspector && container && plotColumn ? { chartBottom: chart.getBoundingClientRect().bottom, inspectorTop: inspector.getBoundingClientRect().top, inspectorLeft: inspector.getBoundingClientRect().left, columnRight: plotColumn.getBoundingClientRect().right, columnWidth: plotColumn.getBoundingClientRect().width, available: container.clientWidth } : null
  })
  expect(geometry).not.toBeNull()
  if (geometry!.available >= 1200) expect(geometry!.inspectorLeft).toBeGreaterThanOrEqual(geometry!.columnRight - 2)
  else expect(geometry!.inspectorTop).toBeGreaterThanOrEqual(geometry!.chartBottom - 2)
  await chart.focus()
  await page.keyboard.press('Escape')
  await expect(chart).not.toHaveAttribute('data-selected', 'true')
})

test('reduced motion leaves Live Wire without entrance animation class churn', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await installHubUxMock(page)
  await page.goto('/analytics')
  await expect(page.getByRole('region', { name: 'Live Wire' })).toBeVisible()
  await expect(page.locator('.hub-live-wire__event-card.is-entering')).toHaveCount(0)
})

test('viewer lane remains readable at desktop and mobile widths', async ({ page }) => {
  await installHubUxMock(page)
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    await page.goto('/analytics')
    const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
    await expect(chart).toBeVisible()
    await expect(chart).toHaveCSS('height', `${viewport.width < 720 ? 360 : 420}px`)
    await expect(chart.locator('.hx-viewer-axis-ticks span')).toHaveCount(3)
    const geometry = await chart.evaluate((root) => {
      const svg = root.querySelector('svg')!.getBoundingClientRect()
      const ticks = Array.from(root.querySelectorAll<HTMLElement>('.hx-viewer-axis-ticks span')).map((node) => node.getBoundingClientRect())
      const stack = root.closest('.hx-plot-stack')!
      const alignedRights = ['.hx-axis', '.hx-chart-navigator', '.hx-provider-lanes']
        .map((selector) => stack.querySelector(selector)!.getBoundingClientRect().right)
      return { svgRight: svg.right, ticks, alignedRights }
    })
    expect(geometry.ticks.every((rect) => rect.height > 0 && rect.left >= geometry.svgRight - 1 && rect.right <= viewport.width - 8)).toBe(true)
    expect(geometry.alignedRights.every((right) => Math.abs(right - geometry.svgRight) <= 2)).toBe(true)
    await expect(chart.locator('..')).toHaveScreenshot(`hub-global-activity-${viewport.width}.png`, {
      animations: 'disabled',
      // Geometry checks above protect clipping; tolerate SVG edge antialiasing.
      maxDiffPixelRatio: 0.03,
    })
  }
})

test('7d diurnal fixture preserves a wide viewer swing without clipping newest data', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-13T12:00:00Z'))
  await installHubUxMock(page, { diurnal7d: true })
  await page.goto('/analytics?window=7d')
  const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
  await expect(chart).toBeVisible()
  await expect(chart.locator('.hx-viewer-axis-ticks span')).toHaveText(['1.4M', '682.5K', '0'])
  const geometry = await chart.evaluate((root) => {
    const svg = root.querySelector('svg')!.getBoundingClientRect()
    const ticks = Array.from(root.querySelectorAll<HTMLElement>('.hx-viewer-axis-ticks span')).map((node) => node.getBoundingClientRect())
    return { svgRight: svg.right, ticks }
  })
  expect(geometry.ticks.every((rect) => rect.left >= geometry.svgRight - 1)).toBe(true)
  await expect(chart.locator('..')).toHaveScreenshot('hub-global-activity-7d-diurnal.png', {
    animations: 'disabled',
    // The plotted paths match; Windows rasterization can shift antialiasing
    // around the long SVG lines without changing their geometry.
    maxDiffPixelRatio: 0.015,
  })
})

for (const window of ['30m', '24h', '7d', '1m', '3m', '1y']) {
  test(`all-range viewer layout: ${window} at desktop and mobile widths`, async ({ page }) => {
    await installHubUxMock(page, { matchActivityWindow: true })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 })
      const response = page.waitForResponse((res) => new URL(res.url()).searchParams.get('activityWindow') === window && res.ok())
      await page.goto(`/analytics?window=${window}`)
      const payload = await (await response).json()
      const expectedMinutes = { '30m': 30, '24h': 1440, '7d': 10080, '1m': 43200, '3m': 129600, '1y': 525600 }[window]
      expect(payload.activity.servedWindowMinutes).toBe(expectedMinutes)
      const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
      await expect(chart).toHaveAttribute('data-chart-layout', 'viewer-lane')
      await expect(chart).toHaveCSS('height', `${width < 720 ? 360 : 420}px`)
      await expect(chart.locator('.hx-viewer-axis-ticks span')).toHaveCount(3)
      await expect(page.locator('.hx-axis span')).toHaveCount(width < 720 ? 3 : 8)
      const geometry = await chart.evaluate((root) => {
        const svg = root.querySelector('svg')!.getBoundingClientRect()
        const stack = root.closest('.hx-plot-stack')!
        return {
          svgRight: svg.right,
          ticks: Array.from(root.querySelectorAll('.hx-viewer-axis-ticks span')).map((node) => node.getBoundingClientRect().toJSON()),
          alignedRights: ['.hx-axis', '.hx-chart-navigator', '.hx-provider-lanes'].map((selector) => stack.querySelector(selector)!.getBoundingClientRect().right),
          viewerBounds: Array.from(root.querySelectorAll<SVGGraphicsElement>('.hx-chart-line--viewers')).map((node) => {
            const { y, height } = node.getBBox()
            return { y, height }
          }),
          chatTops: Array.from(root.querySelectorAll<SVGGraphicsElement>('.hx-chat-bar')).map((node) => node.getBBox().y),
        }
      })
      expect(geometry.ticks.every((rect) => rect.height > 0 && rect.left >= geometry.svgRight - 1 && rect.right <= width - 8)).toBe(true)
      expect(geometry.alignedRights.every((right) => Math.abs(right - geometry.svgRight) <= 2)).toBe(true)
      expect(geometry.viewerBounds.length).toBeGreaterThan(0)
      expect(geometry.viewerBounds.every((rect) => rect.y >= 6 && rect.y + rect.height <= 48.01)).toBe(true)
      expect(geometry.chatTops.length).toBeGreaterThan(0)
      expect(geometry.chatTops.every((top) => top >= 58)).toBe(true)
      await chart.scrollIntoViewIfNeeded()
      const beforeHover = await chart.boundingBox()
      const readout = page.locator('.hx-chart-header__readout')
      for (const fraction of [0.1, 0.55, 0.95]) {
        await chart.hover({ position: { x: beforeHover!.width * fraction, y: beforeHover!.height * 0.6 } })
        await expect(readout).toBeVisible()
        await expect(readout).toContainText('Viewers')
        const plotBox = await chart.boundingBox()
        const readoutBox = await readout.boundingBox()
        expect(readoutBox!.y + readoutBox!.height).toBeLessThanOrEqual(plotBox!.y)
        const headerBox = await readout.locator('..').boundingBox()
        expect(readoutBox!.x).toBeGreaterThanOrEqual(headerBox!.x - 1)
        expect(readoutBox!.x + readoutBox!.width).toBeLessThanOrEqual(headerBox!.x + headerBox!.width + 1)
        expect(Math.abs(plotBox!.y - beforeHover!.y)).toBeLessThan(1)
        expect(Math.abs(plotBox!.height - beforeHover!.height)).toBeLessThan(1)
        expect(await readout.evaluate(el => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth)).toBe(true)
      }
      await page.mouse.move(0, 0)
      await expect(readout).toBeVisible()
      await expect(page.locator('.hx-chart-tip-slot .tip')).toHaveCount(0)
      if (window === '24h') {
        await chart.click({ position: { x: beforeHover!.width * 0.55, y: beforeHover!.height * 0.6 } })
        await expect(chart).toHaveAttribute('data-selected', 'true')
        await expect(page.locator('.figma-global-activity__inspector')).toBeVisible()
        await chart.focus()
        await page.keyboard.press('Escape')
        await expect(chart).not.toHaveAttribute('data-selected', 'true')
      }
    }
  })
}
