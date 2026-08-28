import { test, expect } from '@playwright/test'
import {
  attachConsoleErrorGuard,
  assertNoConsoleErrors,
  assertNoPageHorizontalOverflow,
} from './helpers/assertions'
import { installHubUxMock } from './helpers/hubUxMock'

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 900 },
  { width: 1440, height: 900 },
  { width: 1600, height: 900 },
] as const

test.describe('analytics hub Live Wire compatibility fallback', () => {
  test.beforeEach(async ({ page }) => {
    await installHubUxMock(page)
  })

  for (const viewport of VIEWPORTS) {
    test(`uses the single shared sidecar when Newsroom reads are absent @ ${viewport.width}px`, async ({ page }) => {
      const errors = attachConsoleErrorGuard(page)
      await page.setViewportSize(viewport)
      await page.goto('/analytics')

      const globalActivity = page.getByRole('region', { name: 'Global activity' })
      const sidecar = globalActivity.locator('.activity-newsroom-sidecar')
      const liveWire = sidecar.getByRole('region', { name: 'Live Wire' })
      await expect(globalActivity.locator('.figma-global-activity__annotation-lane')).toHaveCount(0)
      await expect(sidecar).toHaveCount(1)
      await expect(sidecar).toHaveAttribute('data-sidecar-view', 'live-desk')
      await expect(liveWire).toBeVisible()
      await expect(globalActivity.locator('.hub-live-wire--rail')).toHaveCount(1)
      await expect(globalActivity.locator('.hub-live-wire--lane, .figma-analytics__right-rail')).toHaveCount(0)

      const cards = liveWire.locator('.hub-live-wire__event-card')
      await expect(cards).toHaveCount(2)
      await expect(cards.first()).toContainText('xQc')
      await expect(cards.first()).toContainText('Emote breakout')
      await expect(cards.first()).toContainText('Emotes 133/min')
      await expect(cards.first()).toContainText('Chat 393/min')
      await expect(liveWire.locator('.hub-live-wire__bar, [role="progressbar"]')).toHaveCount(0)
      await expect(liveWire.locator('[href="#"]')).toHaveCount(0)

      const geometry = await page.evaluate(() => {
        const chart = document.querySelector<HTMLElement>('.figma-global-activity__chart-col')
        const inspector = document.querySelector<HTMLElement>('.figma-global-activity__inspector')
        if (!chart || !inspector) return null
        const chartRect = chart.getBoundingClientRect()
        const inspectorRect = inspector.getBoundingClientRect()
        const beside = Math.abs(chartRect.top - inspectorRect.top) < 2
        return {
          beside,
          chartWidth: chartRect.width,
          stackedInOrder: inspectorRect.top >= chartRect.bottom - 2,
        }
      })
      expect(geometry).not.toBeNull()
      if (geometry?.beside) expect(geometry.chartWidth).toBeGreaterThanOrEqual(719)
      else expect(geometry?.stackedInOrder).toBe(true)

      await assertNoPageHorizontalOverflow(page)
      await assertNoConsoleErrors(page, errors)
    })
  }

  test('fallback event selects a real chart minute and Back restores Live Wire', async ({ page }) => {
    await page.goto('/analytics')
    const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
    const sidecar = page.locator('.activity-newsroom-sidecar')
    const routeBefore = page.url()
    await sidecar.getByRole('region', { name: 'Live Wire' })
      .getByRole('button', { name: /xQc.*Show this minute on the activity chart/i })
      .click()
    await expect(chart).toHaveAttribute('data-selected', 'true')
    await expect(sidecar).toHaveAttribute('data-sidecar-view', 'inspector')
    expect(page.url()).toBe(routeBefore)

    await sidecar.getByRole('button', { name: 'Back to Live Desk' }).click()
    await expect(sidecar).toHaveAttribute('data-sidecar-view', 'live-desk')
    await expect(sidecar.getByRole('region', { name: 'Live Wire' })).toBeVisible()
  })

  test('renders the compact Pulse Moments table as readable cards at 390px', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await page.setViewportSize({ width: 390, height: 1000 })
    await page.goto('/analytics')
    const row = page.locator('.pulse-moments__leaderboard--compact [data-moment-row]').first()
    await expect(row).toBeVisible()
    const geometry = await row.evaluate((node) => {
      const cells = [...node.querySelectorAll<HTMLElement>('td')]
      const rects = cells.map((cell) => ({
        label: cell.dataset.label,
        left: cell.getBoundingClientRect().left,
        right: cell.getBoundingClientRect().right,
        width: cell.getBoundingClientRect().width,
      }))
      const rowRect = node.getBoundingClientRect()
      return {
        display: getComputedStyle(node).display,
        rowLeft: rowRect.left,
        rowRight: rowRect.right,
        rects,
      }
    })
    expect(geometry.display).toBe('grid')
    expect(geometry.rects.find((cell) => cell.label === 'Channel')?.width).toBeGreaterThan(80)
    expect(geometry.rects.find((cell) => cell.label === 'Moment')?.width).toBeGreaterThan(180)
    expect(geometry.rects.every((cell) => cell.left >= geometry.rowLeft - 1 && cell.right <= geometry.rowRight + 1)).toBe(true)
    await assertNoPageHorizontalOverflow(page)
    await assertNoConsoleErrors(page, errors)
  })

  test('single fallback sidecar survives 1440px at deviceScaleFactor 1.25', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1.25,
    })
    const page = await context.newPage()
    const errors = attachConsoleErrorGuard(page)
    await installHubUxMock(page)
    await page.goto('/analytics')
    await expect(page.locator('.figma-global-activity__annotation-lane')).toHaveCount(0)
    await expect(page.locator('.activity-newsroom-sidecar')).toHaveCount(1)
    await expect(page.locator('.hub-live-wire--rail')).toBeVisible()
    await expect(page.locator('.hub-live-wire--lane, .figma-analytics__right-rail')).toHaveCount(0)
    await assertNoPageHorizontalOverflow(page)
    await assertNoConsoleErrors(page, errors)
    await context.close()
  })
})
