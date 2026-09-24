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

test.describe('analytics hub independent Live Wire rail', () => {
  test.beforeEach(async ({ page }) => {
    await installHubUxMock(page)
  })

  for (const viewport of VIEWPORTS) {
    test(`keeps chart, Live Wire, and secondary content in the approved order @ ${viewport.width}px`, async ({ page }) => {
      const errors = attachConsoleErrorGuard(page)
      await page.setViewportSize(viewport)
      await page.goto('/analytics')

      const globalActivity = page.getByRole('region', { name: 'Global activity' })
      const wireRegion = page.locator('.figma-analytics__right-rail > .analytics-discovery-layout__wire')
      const liveWire = wireRegion.getByRole('region', { name: 'Live Wire' })
      await expect(globalActivity.locator('.figma-global-activity__annotation-lane')).toHaveCount(0)
      await expect(globalActivity.locator('.activity-newsroom-sidecar, .hub-live-wire')).toHaveCount(0)
      await expect(wireRegion).toHaveCount(1)
      await expect(page.locator('.hub-live-wire')).toHaveCount(1)
      await expect(liveWire).toBeVisible()
      await expect(wireRegion.locator('.hub-live-wire--rail')).toHaveCount(1)
      await expect(wireRegion.getByRole('link', { name: 'Browse all moments & saved →' })).toHaveAttribute('href', '/analytics/moments')
      await expect(wireRegion.getByRole('link', { name: /Newsroom/i })).toHaveCount(0)
      await expect(page.locator('.figma-analytics__right-rail')).toHaveCount(1)
      // The rail is an arrivals ticker: filtering and sorting stay with the
      // Pulse Moments table rather than being duplicated beside it.
      await expect(liveWire.locator('select')).toHaveCount(0)
      await expect(liveWire.getByText('Stream events unavailable')).toHaveCount(0)

      const cards = liveWire.locator('.hub-live-wire__event-card')
      await expect(cards).toHaveCount(2)
      await expect(cards.first()).toContainText('xQc')
      await expect(cards.first()).toContainText('Twitch emote spike')
      await expect(cards.first()).toContainText('133/m')
      await expect(cards.first()).toContainText('393/m')
      await expect(liveWire.locator('.hub-live-wire__bar')).toHaveCount(0)
      await expect(cards.first()).not.toContainText(/score\s+\d/i)
      await expect(cards.first().getByRole('link', { name: /^Stream analytics for / })).toBeVisible()
      await expect(cards.first().getByRole('button', { name: /^Save / })).toBeVisible()
      await expect(cards.first().getByRole('button', { name: /^Show .* on chart$/ })).toBeVisible()
      await expect(liveWire.locator('[role="progressbar"]')).toHaveCount(0)
      await expect(liveWire.locator('[href="#"]')).toHaveCount(0)

      const geometry = await page.evaluate(() => {
        const center = document.querySelector<HTMLElement>('.figma-analytics__center')
        const network = document.querySelector<HTMLElement>('#section-network')
        const rail = document.querySelector<HTMLElement>('.figma-analytics__right-rail')
        const emotes = document.querySelector<HTMLElement>('#section-emote-signal')
        if (!center || !network || !rail || !emotes) return null
        const centerRect = center.getBoundingClientRect()
        const networkRect = network.getBoundingClientRect()
        const railRect = rail.getBoundingClientRect()
        const emotesRect = emotes.getBoundingClientRect()
        return {
          centerWidth: centerRect.width,
          railWidth: railRect.width,
          besideCenter: railRect.left >= centerRect.right - 2,
          stackedInOrder: railRect.top >= networkRect.bottom - 2 && emotesRect.top >= railRect.bottom - 2,
        }
      })
      expect(geometry).not.toBeNull()
      if (!geometry) throw new Error('Expected the outer Live Wire rail and analytics sections to render')
      if (viewport.width >= 1440) {
        expect(geometry.besideCenter).toBe(true)
        expect(geometry.centerWidth).toBeGreaterThanOrEqual(719)
        expect(geometry.railWidth).toBeCloseTo(380, 0)
      }
      else expect(geometry.stackedInOrder).toBe(true)

      const jump = page.getByRole('link', { name: 'Jump to Live Wire' })
      if (viewport.width >= 1440) await expect(jump).toBeHidden()
      else await expect(jump).toBeVisible()

      await assertNoPageHorizontalOverflow(page)
      await assertNoConsoleErrors(page, errors)
    })
  }

  test('exact event selects a real chart minute without replacing Live Wire or fetching a synthetic bucket', async ({ page }) => {
    let bucketRequests = 0
    page.on('request', request => {
      if (/\/v1\/public\/hub\/moments(?:\?|$)/.test(request.url())) bucketRequests += 1
    })
    await page.goto('/analytics')
    const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
    const wire = page.locator('.analytics-discovery-layout__wire').getByRole('region', { name: 'Live Wire' })
    const routeBefore = page.url()
    const row = wire.locator('[data-stream-id="s1"]').first()
    await expect(row).toHaveAttribute('data-public-moment-id', 'public-xqc-1')
    await row.getByRole('button', { name: /^Show .* on chart$/ }).click()
    await expect(chart).toHaveAttribute('data-selected', 'true')
    await expect(wire).toBeVisible()
    const inspector = page.locator('.analytics-discovery-layout__chart .figma-global-activity__inspector')
    await expect(inspector).toBeVisible()
    expect(page.url()).toBe(routeBefore)
    await expect.poll(() => bucketRequests).toBe(0)

    await chart.focus()
    await page.keyboard.press('Escape')
    await expect(chart).not.toHaveAttribute('data-selected', 'true')
    await expect(wire).toBeVisible()
    await expect.poll(() => bucketRequests).toBe(0)
  })

  test('independent rail survives 1440px at deviceScaleFactor 1.25', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1.25,
    })
    const page = await context.newPage()
    const errors = attachConsoleErrorGuard(page)
    await installHubUxMock(page)
    await page.goto('/analytics')
    await expect(page.locator('.figma-global-activity__annotation-lane')).toHaveCount(0)
    await expect(page.locator('.activity-newsroom-sidecar')).toHaveCount(0)
    await expect(page.locator('.figma-analytics__right-rail > .analytics-discovery-layout__wire .hub-live-wire--rail')).toBeVisible()
    await expect(page.locator('.figma-global-activity .hub-live-wire')).toHaveCount(0)
    await expect(page.locator('.figma-analytics__right-rail')).toHaveCount(1)
    await assertNoPageHorizontalOverflow(page)
    await assertNoConsoleErrors(page, errors)
    await context.close()
  })
})
