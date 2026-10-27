import { test, expect, type Locator } from '@playwright/test'
import { attachHostedApiGuard } from './helpers/hostedApi'
import { installHubUxMock } from './helpers/hubUxMock'

const VIEWPORTS = [
  { width: 320, height: 720 },
  { width: 390, height: 844 },
  { width: 480, height: 900 },
  { width: 1600, height: 900 },
] as const

type Box = { x: number; y: number; width: number; height: number }

function overlap(a: Box, b: Box, epsilon = 1): boolean {
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

// The hub activity card's header row (heading, window seg, series chips),
// the Now/hover readout and the plot stack in order and stay inside the card
// at every width: nothing overlaps the plot and nothing runs past the card.
test.describe('hub mobile annotations', () => {
  for (const viewport of VIEWPORTS) {
    test(`header row, readout and plot stay stacked and in-frame at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport)
      const hostedHits = attachHostedApiGuard(page)
      await installHubUxMock(page)
      await page.goto('/analytics')

      const card = page.locator('.figma-global-activity__hub-chart')
      const plot = card.locator('svg[data-bench-plot]')
      await expect(plot).toBeVisible()

      const header = card.locator('[data-hub-activity-header]')
      const readout = card.locator('[data-hub-readout]')
      await expect(header).toHaveCount(1)
      await expect(readout).toHaveCount(1)

      const headerBox = await visibleBox(header)
      const readoutBox = await visibleBox(readout)
      const plotBox = await visibleBox(plot)
      expect(headerBox).toBeTruthy()
      expect(readoutBox).toBeTruthy()
      expect(plotBox).toBeTruthy()
      expect(overlap(headerBox!, plotBox!)).toBeFalsy()
      expect(overlap(readoutBox!, plotBox!)).toBeFalsy()
      expect(overlap(headerBox!, readoutBox!)).toBeFalsy()
      expect(headerBox!.y + headerBox!.height).toBeLessThanOrEqual(readoutBox!.y + 1)
      expect(readoutBox!.y + readoutBox!.height).toBeLessThanOrEqual(plotBox!.y + 1)

      // Every header control and every readout slot stays inside the card.
      const overflow = await card.evaluate((root) => {
        const bounds = root.getBoundingClientRect()
        return Array.from(root.querySelectorAll<HTMLElement>('[data-hub-activity-header] > *, [data-hub-activity-header] button, [data-hub-readout] .slot'))
          .filter((element) => element.getClientRects().length > 0)
          .flatMap((element) => {
            const rect = element.getBoundingClientRect()
            return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 ? [] : [`${element.className || element.tagName} ${Math.round(rect.left)}-${Math.round(rect.right)}`]
          })
      })
      expect(overflow).toEqual([])
      // Header controls never overlap each other.
      const controls = await header.locator('h2, [data-hub-window-seg], [data-hub-series-chip], [data-hub-bars-note], .hub-act-info').evaluateAll((nodes) =>
        nodes.filter((node) => node.getClientRects().length > 0 && node.getBoundingClientRect().width > 1).map((node) => {
          const rect = node.getBoundingClientRect()
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        }))
      for (let i = 0; i < controls.length; i += 1) {
        for (let j = i + 1; j < controls.length; j += 1) expect(overlap(controls[i]!, controls[j]!), `controls ${i}/${j}`).toBeFalsy()
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      expect(hostedHits.filter((url) => /localhost|127\.0\.0\.1/.test(url))).toEqual([])
    })
  }
})
