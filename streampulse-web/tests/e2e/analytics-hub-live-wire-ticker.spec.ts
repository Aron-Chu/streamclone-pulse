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
  { width: 1119, height: 966 },
  { width: 1280, height: 900 },
  { width: 1440, height: 900 },
  { width: 1600, height: 900 },
] as const

test.describe('analytics hub Live Wire activity rail', () => {
  test.beforeEach(async ({ page }) => {
    await installHubUxMock(page)
  })

  for (const viewport of VIEWPORTS) {
    test(`keeps Live Wire in the shared chart-side rail @ ${viewport.width}px`, async ({ page }) => {
      const errors = attachConsoleErrorGuard(page)
      await page.setViewportSize(viewport)
      await page.goto('/analytics')

      const globalActivity = page.getByRole('region', { name: 'Global activity' })
      const rail = globalActivity.locator('.activity-context-rail')
      const liveWire = rail.getByRole('region', { name: 'Live Wire' })
      await expect(globalActivity.locator('.figma-global-activity__annotation-lane')).toHaveCount(0)
      await expect(rail).toHaveCount(1)
      await expect(rail).toHaveAttribute('data-activity-rail-view', 'idle')
      await expect(liveWire).toBeVisible()
      await expect(globalActivity.locator('.hub-live-wire--rail')).toHaveCount(1)
      await expect(globalActivity.locator('.hub-live-wire--lane, .hub-live-wire--explorer, .figma-analytics__right-rail')).toHaveCount(0)
      await expect(liveWire.getByRole('link', { name: /Pulse Explorer/i })).toHaveAttribute('href', '/analytics/explore')

      const cards = liveWire.locator('.hub-live-wire__event-card')
      await expect(cards).toHaveCount(2)
      await expect(cards.first()).toContainText('xQc')
      await expect(cards.first()).toContainText('Emote breakout')
      await expect(cards.first()).toContainText('133')
      await expect(cards.first()).toContainText('393 /min')
      await expect(cards.first()).toContainText('Inspect minute')
      await expect(liveWire.getByText('Scope', { exact: true })).toBeVisible()
      await expect(liveWire.getByText('Signal', { exact: true })).toBeVisible()
      await expect(liveWire.locator('.hub-live-wire__bar, [role="progressbar"]')).toHaveCount(0)
      await expect(liveWire.locator('[href="#"]')).toHaveCount(0)
      expect(await liveWire.locator('.hub-live-wire__event-card').evaluateAll((nodes) =>
        nodes.every((node) => node.querySelectorAll('.hub-live-wire__event-emote').length <= 3),
      )).toBe(true)

      const editorialStyle = await liveWire.evaluate((root) => {
        const card = root.querySelector<HTMLElement>('.hub-live-wire__event-card')
        const select = root.querySelector<HTMLSelectElement>('.hub-live-wire__explorer-select select')
        const selectShell = root.querySelector<HTMLElement>('.hub-live-wire__explorer-select-shell')
        const emoteCell = root.querySelector<HTMLElement>('.hub-live-wire__event-emote')
        const railStyle = getComputedStyle(root)
        const cardStyle = card ? getComputedStyle(card) : null
        const selectStyle = select ? getComputedStyle(select) : null
        const emoteStyle = emoteCell ? getComputedStyle(emoteCell) : null
        return {
          railBackgroundImage: railStyle.backgroundImage,
          cardBackgroundImage: cardStyle?.backgroundImage,
          cardSurfaceSeparated: cardStyle?.backgroundColor !== railStyle.backgroundColor,
          equalCardBorders: cardStyle
            ? cardStyle.borderLeftWidth === cardStyle.borderRightWidth &&
              cardStyle.borderLeftWidth === cardStyle.borderTopWidth
            : false,
          selectAppearance: selectStyle?.appearance,
          selectBackgroundImage: selectStyle?.backgroundImage,
          selectHasChevron: Boolean(selectShell?.querySelector('svg')),
          emoteCellBorder: emoteStyle?.borderTopStyle,
        }
      })
      expect(editorialStyle.railBackgroundImage).toBe('none')
      expect(editorialStyle.cardBackgroundImage).toBe('none')
      expect(editorialStyle.cardSurfaceSeparated).toBe(true)
      expect(editorialStyle.equalCardBorders).toBe(true)
      expect(editorialStyle.selectAppearance).toBe('none')
      expect(editorialStyle.selectBackgroundImage).toBe('none')
      expect(editorialStyle.selectHasChevron).toBe(true)
      expect(editorialStyle.emoteCellBorder).toBe('solid')

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
      if (viewport.width >= 1119) {
        expect(geometry?.beside).toBe(true)
        expect(geometry?.chartWidth).toBeGreaterThanOrEqual(520)
      } else {
        expect(geometry?.beside).toBe(false)
        expect(geometry?.stackedInOrder).toBe(true)
      }

      await assertNoPageHorizontalOverflow(page)
      await assertNoConsoleErrors(page, errors)
    })
  }

  test('overview does not request the separate Newsroom feed', async ({ page }) => {
    const newsroomRequests: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/v1/public/newsroom')) newsroomRequests.push(request.url())
    })
    await page.goto('/analytics')
    await expect(page.locator('.activity-context-rail .hub-live-wire--rail')).toBeVisible()
    expect(newsroomRequests).toEqual([])
  })

  test('rail event selects a real chart minute and Back restores Live Wire state', async ({ page }) => {
    await page.goto('/analytics')
    const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
    const rail = page.locator('.activity-context-rail')
    const routeBefore = page.url()
    const liveWire = rail.getByRole('region', { name: 'Live Wire' })
    await liveWire.getByLabel('Live Wire order').selectOption('strongest')
    await liveWire
      .getByRole('button', { name: /xQc.*Inspect this activity bucket/i })
      .click()
    await expect(chart).toHaveAttribute('data-selected', 'true')
    await expect(rail).toHaveAttribute('data-activity-rail-view', 'locked')
    expect(page.url()).toBe(routeBefore)

    await rail.getByRole('button', { name: 'Back to Live Wire' }).click()
    await expect(rail).toHaveAttribute('data-activity-rail-view', 'idle')
    await expect(liveWire).toBeVisible()
    await expect(liveWire.getByLabel('Live Wire order')).toHaveValue('strongest')

    await liveWire.getByRole('button', { name: /xQc.*Inspect this activity bucket/i }).click()
    await expect(rail).toHaveAttribute('data-activity-rail-view', 'locked')
    await page.keyboard.press('Escape')
    await expect(rail).toHaveAttribute('data-activity-rail-view', 'idle')
  })

  test('hover previews the exact bucket and category controls reorder the loaded set', async ({ page }) => {
    await page.goto('/analytics')
    const rail = page.locator('.activity-context-rail')
    const liveWire = rail.getByRole('region', { name: 'Live Wire' })
    const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
    const xqc = liveWire.getByRole('button', { name: /xQc.*Inspect this activity bucket/i })

    await expect(chart).not.toHaveAttribute('data-selected', 'true')
    await xqc.hover()
    await expect(page.locator('.hx-bucket-cue--accent')).toHaveCount(1)
    await expect(rail).toHaveAttribute('data-activity-rail-view', 'idle')
    await page.mouse.move(4, 4)
    await expect(page.locator('.hx-bucket-cue--accent')).toHaveCount(0)

    await liveWire.getByLabel('Live Wire order').selectOption('category')
    await expect(liveWire.locator('.hub-live-wire__category-group')).toHaveCount(2)
    await liveWire.getByLabel('Live Wire category').selectOption('just chatting')
    await expect(liveWire.locator('.hub-live-wire__event-card')).toHaveCount(1)
  })

  test('reduced motion swaps the activity rail without a pane transition', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/analytics')
    const rail = page.locator('.activity-context-rail')
    const liveWire = rail.getByRole('region', { name: 'Live Wire' })
    await liveWire.getByRole('button', { name: /xQc.*Inspect this activity bucket/i }).click()
    await expect(rail).toHaveAttribute('data-activity-rail-view', 'locked')
    expect(await rail.locator('.activity-context-rail__pane--inspector').evaluate((pane) =>
      getComputedStyle(pane).transitionDuration
        .split(',')
        .every((duration) => Number.parseFloat(duration) <= 0.001),
    )).toBe(true)
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

  test('single activity rail survives 1440px at deviceScaleFactor 1.25', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1.25,
    })
    const page = await context.newPage()
    const errors = attachConsoleErrorGuard(page)
    await installHubUxMock(page)
    await page.goto('/analytics')
    await expect(page.locator('.figma-global-activity__annotation-lane')).toHaveCount(0)
    await expect(page.locator('.activity-context-rail')).toHaveCount(1)
    await expect(page.locator('.activity-context-rail .hub-live-wire--rail')).toBeVisible()
    await expect(page.locator('.hub-live-wire--lane, .hub-live-wire--explorer, .figma-analytics__right-rail')).toHaveCount(0)
    await assertNoPageHorizontalOverflow(page)
    await assertNoConsoleErrors(page, errors)
    await context.close()
  })
})
