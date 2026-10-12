import { test, expect, type Locator } from '@playwright/test'
import { installHubUxMock } from './helpers/hubUxMock'

/**
 * The viewer scale sits inside the plot's left edge, under "Sampled viewers",
 * so the plot and every time row run the full card width (2026-10-11, mockup
 * chart-width B). Returns where the labels, the plot, the time rows, the bars
 * and the Pulse Moments card below sit, and how many points of the drawn
 * viewer line fall under a visible scale label (it must be none).
 */
async function viewerLaneGeometry(chart: Locator) {
  return chart.evaluate((root) => {
    const svgElement = root.querySelector('svg')!
    const svg = svgElement.getBoundingClientRect()
    const stack = root.closest('.hx-plot-stack')!
    const rows = ['.hx-axis', '.hx-chart-navigator', '.hx-provider-lanes']
      .map((selector) => stack.querySelector(selector)!.getBoundingClientRect())
    const bars = Array.from(root.querySelectorAll('.hx-chat-bar')).map((node) => node.getBoundingClientRect()).filter((rect) => rect.width > 0)
    const card = document.querySelector('.pulse-moments-live--embedded .pulse-moments__leaderboard')!.getBoundingClientRect()
    const frame = document.querySelector('.figma-global-activity__body')!.getBoundingClientRect()
    const labels = Array.from(root.querySelectorAll<HTMLElement>('.hx-viewer-axis-ticks span'))
      .map((node) => ({ rect: node.getBoundingClientRect().toJSON() as DOMRect, visible: getComputedStyle(node).visibility !== 'hidden' }))
    // Sample every drawn viewer path (solid and dashed) densely and count points under a visible label.
    const ctm = svgElement.getScreenCTM()!
    const linePoints: Array<{ x: number; y: number }> = []
    for (const path of Array.from(root.querySelectorAll<SVGPathElement>('.hx-chart-line--viewers, .hx-chart-line--viewers-sampled'))) {
      const length = path.getTotalLength()
      for (let i = 0; i <= 4000; i += 1) {
        const point = path.getPointAtLength((length * i) / 4000)
        const screen = new DOMPoint(point.x, point.y).matrixTransform(ctm)
        linePoints.push({ x: screen.x, y: screen.y })
      }
    }
    // The stroke is 2.25px wide: a point within about a pixel of a plate touches it.
    const covered = linePoints.filter((point) => labels.some(({ rect, visible }) => visible &&
      point.x >= rect.left - 1 && point.x <= rect.right + 1 && point.y >= rect.top - 1 && point.y <= rect.bottom + 1)).length
    return {
      svg: { left: svg.left, right: svg.right, width: svg.width },
      rows: rows.map((rect) => ({ left: rect.left, right: rect.right })),
      bars: bars.length ? { left: Math.min(...bars.map((rect) => rect.left)), right: Math.max(...bars.map((rect) => rect.right)) } : null,
      card: { left: card.left, right: card.right },
      frame: { left: frame.left, right: frame.right },
      labels,
      linePoints: linePoints.length,
      covered,
    }
  })
}

type ViewerLaneGeometry = Awaited<ReturnType<typeof viewerLaneGeometry>>

/**
 * Labels inside the left edge, every time row on the plot's edges, the Moments
 * card under them. `bars` also checks the outermost bars, for fixtures whose
 * buckets fill the window (in 30m the first bar starts at its own minute).
 */
function expectFullWidthViewerLane(geometry: ViewerLaneGeometry, { bars = true }: { bars?: boolean } = {}) {
  const { svg } = geometry
  // Scale labels sit inside the plot's left edge (a 4.5rem column), never in a side gutter.
  expect(geometry.labels).toHaveLength(3)
  for (const { rect } of geometry.labels) {
    expect(rect.height).toBeGreaterThan(0)
    expect(rect.left).toBeGreaterThanOrEqual(svg.left)
    expect(rect.right).toBeLessThanOrEqual(svg.left + 72 + 1)
  }
  // At least two labels always show, so the scale is readable.
  expect(geometry.labels.filter((label) => label.visible).length).toBeGreaterThanOrEqual(2)
  // The time axis, zoom bar and provider lanes share the plot's edges.
  for (const row of geometry.rows) {
    expect(Math.abs(row.left - svg.left)).toBeLessThanOrEqual(2)
    expect(Math.abs(row.right - svg.right)).toBeLessThanOrEqual(2)
  }
  // The bars and the plot line up with the Pulse Moments card below, which lines up with the chart frame.
  expect(geometry.bars).not.toBeNull()
  if (bars) {
    expect(Math.abs(geometry.bars!.left - geometry.card.left)).toBeLessThanOrEqual(2)
    expect(Math.abs(geometry.bars!.right - geometry.card.right)).toBeLessThanOrEqual(2)
  }
  expect(Math.abs(svg.left - geometry.card.left)).toBeLessThanOrEqual(2)
  expect(Math.abs(svg.right - geometry.card.right)).toBeLessThanOrEqual(2)
  expect(Math.abs(geometry.frame.left - geometry.card.left)).toBeLessThanOrEqual(1)
  expect(Math.abs(geometry.frame.right - geometry.card.right)).toBeLessThanOrEqual(1)
  // No scale label covers any part of the viewer line.
  expect(geometry.linePoints).toBeGreaterThan(0)
  expect(geometry.covered).toBe(0)
}

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
    expectFullWidthViewerLane(await viewerLaneGeometry(chart))
    await expect(chart.locator('..')).toHaveScreenshot(`hub-global-activity-${viewport.width}.png`, {
      animations: 'disabled',
      // Geometry checks above protect clipping; tolerate SVG edge antialiasing.
      maxDiffPixelRatio: 0.03,
    })
  }
})

test('7d diurnal fixture keeps a wide viewer swing, with the scale clear of the line and the newest data', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-13T12:00:00Z'))
  await installHubUxMock(page, { diurnal7d: true })
  await page.goto('/analytics?window=7d')
  const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
  await expect(chart).toBeVisible()
  await expect(chart.locator('.hx-viewer-axis-ticks span')).toHaveText(['1.4M', '682.5K', '0'])
  const geometry = await viewerLaneGeometry(chart)
  expectFullWidthViewerLane(geometry)
  // Here the oldest stretch of the line runs through 682.5K, so that label
  // steps just clear of it instead of covering it (mockup B's chip hid it).
  await expect(chart.locator('.hx-viewer-axis-ticks span').nth(1)).toHaveAttribute('data-moved', 'true')
  expect(geometry.labels.every(({ visible }) => visible)).toBe(true)
  // The labels stay at the oldest edge: nothing sits over the newest tenth of the plot.
  expect(geometry.labels.every(({ rect }) => rect.right < geometry.svg.left + geometry.svg.width * 0.9)).toBe(true)
  await expect(chart.locator('..')).toHaveScreenshot('hub-global-activity-7d-diurnal.png', {
    animations: 'disabled',
    // The plotted paths match; Windows rasterization can shift antialiasing
    // around the long SVG lines without changing their geometry.
    maxDiffPixelRatio: 0.015,
  })
})

for (const window of ['24h', '7d'] as const) {
  test(`${window}: the plot and its time rows line up with the Pulse Moments card at 1440 and 1920`, async ({ page }) => {
    if (window === '7d') await page.clock.setFixedTime(new Date('2026-09-13T12:00:00Z'))
    await installHubUxMock(page, window === '7d' ? { diurnal7d: true } : {})
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
      await page.setViewportSize(viewport)
      await page.goto(window === '7d' ? '/analytics?window=7d' : '/analytics')
      const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
      await expect(chart.locator('.hx-viewer-axis-ticks span')).toHaveCount(3)
      expectFullWidthViewerLane(await viewerLaneGeometry(chart))
      // The "Live-session peaks" caption starts on the same column as the card under it.
      const caption = await page.locator('.pulse-moments-live__sub strong').boundingBox()
      const card = await page.locator('.pulse-moments-live--embedded .pulse-moments__leaderboard').boundingBox()
      expect(Math.abs(caption!.x - card!.x)).toBeLessThanOrEqual(1)
    }
  })
}

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
      expectFullWidthViewerLane(await viewerLaneGeometry(chart), { bars: false })
      const geometry = await chart.evaluate((root) => {
        return {
          viewerBounds: Array.from(root.querySelectorAll<SVGGraphicsElement>('.hx-chart-line--viewers')).map((node) => {
            const { y, height } = node.getBBox()
            return { y, height }
          }),
          chatTops: Array.from(root.querySelectorAll<SVGGraphicsElement>('.hx-chat-bar')).map((node) => node.getBBox().y),
        }
      })
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
        // scrollHeight does not catch grid rows that are too short for their
        // content, so check the parts of the compact desktop readout
        // (analytics-compact.css, >=1100px): the metrics stay inside the
        // content box and end above the status line, which ends inside it.
        // The 390px readout keeps its older rows and is not covered here.
        if (width < 1100) continue
        const parts = await readout.evaluate((el) => {
          const box = el.getBoundingClientRect()
          const style = getComputedStyle(el)
          const metrics = el.querySelector('.hx-hover-metrics')!.getBoundingClientRect()
          const status = el.querySelector('.hx-hover-status')!.getBoundingClientRect()
          return {
            contentTop: box.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop),
            contentBottom: box.bottom - parseFloat(style.borderBottomWidth) - parseFloat(style.paddingBottom),
            metricsTop: metrics.top,
            metricsBottom: metrics.bottom,
            statusTop: status.top,
            statusBottom: status.bottom,
          }
        })
        expect(parts.metricsTop).toBeGreaterThanOrEqual(parts.contentTop - 0.5)
        expect(parts.metricsBottom).toBeLessThanOrEqual(parts.statusTop + 0.5)
        expect(parts.statusBottom).toBeLessThanOrEqual(parts.contentBottom + 0.5)
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
