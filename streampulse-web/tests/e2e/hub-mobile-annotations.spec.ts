import { test, expect, type Locator } from '@playwright/test'
import { attachHostedApiGuard } from './helpers/hostedApi'
import { installHubUxMock } from './helpers/hubUxMock'

const VIEWPORTS = [
  { width: 320, height: 720 },
  { width: 390, height: 844 },
  { width: 480, height: 900 },
  { width: 1600, height: 900 },
] as const

function overlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
  epsilon = 1,
): boolean {
  return (
    a.width > 1 &&
    a.height > 1 &&
    b.width > 1 &&
    b.height > 1 &&
    a.x < b.x + b.width - epsilon &&
    a.x + a.width > b.x + epsilon &&
    a.y < b.y + b.height - epsilon &&
    a.y + a.height > b.y + epsilon
  )
}

async function visibleBox(locator: Locator) {
  if ((await locator.count()) === 0) return null
  const box = await locator.boundingBox()
  if (!box || box.width <= 1 || box.height <= 1) return null
  return box
}

test.describe('hub mobile annotations', () => {
  for (const viewport of VIEWPORTS) {
    test(`annotations stay stacked and in-frame at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport)
      const hostedHits = attachHostedApiGuard(page)
      await installHubUxMock(page)
      await page.goto('/analytics')

      const chart = page.locator('.figma-global-activity__hub-chart')
      await expect(chart.locator('.hx-chart2')).toBeVisible()

      const labels = chart.locator('[data-hub-chart-series-labels]')
      const status = chart.locator('[data-hub-chart-status]')
      const plot = chart.locator('.hx-chart2')
      await expect(labels).toHaveCount(1)
      await expect(status).toHaveCount(1)

      const labelBox = await visibleBox(labels)
      const statusBox = await visibleBox(status)
      const plotBox = await visibleBox(plot)
      expect(plotBox).toBeTruthy()
      if (labelBox && plotBox) expect(overlap(labelBox, plotBox)).toBeFalsy()
      if (statusBox && plotBox) expect(overlap(statusBox, plotBox)).toBeFalsy()
      if (labelBox && statusBox) expect(overlap(labelBox, statusBox)).toBeFalsy()

      const headerOverflow = await chart.locator('.hx-chart-header').evaluate((el) => {
        const parent = el.closest('.figma-global-activity__hub-chart') ?? el.parentElement
        if (!parent) return 0
        return el.getBoundingClientRect().right - parent.getBoundingClientRect().right
      })
      expect(headerOverflow).toBeLessThanOrEqual(1)

      await expect(chart).toHaveScreenshot(`hub-chart-annotations-${viewport.width}.png`, {
        maxDiffPixelRatio: 0.03,
      })
      expect(hostedHits.filter((url) => /localhost|127\.0\.0\.1/.test(url))).toEqual([])
    })
  }
})
