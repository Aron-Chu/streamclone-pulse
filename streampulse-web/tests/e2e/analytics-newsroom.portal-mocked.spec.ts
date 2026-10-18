import { expect, test } from '@playwright/test'
import {
  attachConsoleErrorGuard,
  assertNoConsoleErrors,
  assertNoPageHorizontalOverflow,
} from './helpers/assertions'
import { installHubUxMock } from './helpers/hubUxMock'
import { installNewsroomMock, type NewsroomMockMode } from './helpers/newsroomMock'

async function install(page: Parameters<typeof installHubUxMock>[0], mode: NewsroomMockMode = 'ready') {
  await installHubUxMock(page)
  await installNewsroomMock(page, mode)
}

test.describe('Pulse Newsroom and independent Live Wire', () => {
  test('historical 503 preserves measured live health with a visible recent-range label', async ({ page }, testInfo) => {
    const requested: string[] = []
    page.on('request', request => {
      if (/\/v1\/public\/hub\?/.test(request.url())) requested.push(new URL(request.url()).searchParams.get('activityWindow') ?? '')
    })
    await installHubUxMock(page, { historyUnavailable: true })
    await page.goto('/analytics')
    const wire = page.getByRole('region', { name: 'Live Wire', exact: true })
    await expect(wire).toBeVisible()
    await expect(wire.locator('[data-stream-id="s1"]').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Activity time window: 24h requested; only 30 minutes is currently available' })).toHaveText('24h · 30m available')
    await expect(page.locator('.hub-command-header')).not.toContainText('Unknown')
    expect(requested.filter(range => range === '30m')).toHaveLength(1)
    expect(requested[0]).toBe('24h')
    await page.screenshot({ path: testInfo.outputPath('live-wire-history-recovery.png'), fullPage: true })
  })

  test('inspects a real compact Live Wire moment without a synthetic request', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    let bucketRequests = 0
    page.on('request', (request) => {
      if (/\/v1\/public\/hub\/moments(?:\?|$)/.test(request.url())) bucketRequests += 1
    })
    await install(page)
    await page.goto('/analytics')

    const activity = page.getByRole('region', { name: 'Global activity' })
    const wire = page.getByRole('region', { name: 'Live Wire', exact: true })
    const inspector = activity.locator('.figma-global-activity__inspector')
    await expect(activity.locator('.figma-global-activity__annotation-lane')).toHaveCount(0)
    await expect(page.locator('.figma-analytics__right-rail .hub-live-wire')).toHaveCount(1)
    await expect(wire).toBeVisible()

    const routeBefore = page.url()
    const xqcRow = wire.locator('[data-stream-id="s1"]').first()
    await expect(xqcRow).toHaveAttribute('data-public-moment-id', 'public-xqc-1')
    const showOnChart = xqcRow.getByRole('button', { name: /Show xQc .* on chart/ })
    await showOnChart.click()
    await expect(showOnChart).toHaveAttribute('aria-pressed', 'true')
    await expect(wire).toBeVisible()
    await expect(inspector.getByTestId('bucket-inspector-linked-moment')).toContainText('xQc')
    await expect(page.locator('.figma-global-activity__hub-chart .hx-chart2')).toHaveAttribute('data-selected', 'true')
    await expect.poll(() => bucketRequests).toBe(0)
    expect(page.url()).toBe(routeBefore)

    await inspector.getByTestId('bucket-inspector-linked-moment').getByRole('button', { name: 'Clear' }).click()
    await expect(showOnChart).toHaveAttribute('aria-pressed', 'false')
    await expect(wire).toBeVisible()
    await expect.poll(() => bucketRequests).toBe(0)
    await assertNoConsoleErrors(page, errors)
  })

  for (const mode of ['empty', 'unavailable', 'malformed'] as const) {
    test(`${mode} state is explicit and never creates a second rail`, async ({ page }) => {
      await install(page, mode)
      await page.goto('/analytics')
      const activity = page.getByRole('region', { name: 'Global activity' })
      const wire = page.getByRole('region', { name: 'Live Wire', exact: true })
      await expect(page.locator('.figma-analytics__right-rail')).toHaveCount(1)
      await expect(activity.locator('.figma-global-activity__annotation-lane')).toHaveCount(0)
      await expect(wire).toBeVisible()
      await expect(activity.getByRole('complementary', { name: 'Activity bucket inspector' })).toHaveCount(0)
    })
  }

  for (const width of [390, 768, 1280, 1440, 1600]) {
    test(`keeps chart, bucket inspector, and separate Live Wire responsive at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: width < 800 ? 1000 : 900 })
      await install(page)
      await page.goto('/analytics')
      await expect(page.getByRole('region', { name: 'Global activity' })).toBeVisible()
      await expect(page.locator('.figma-global-activity__chart-col')).toBeVisible()
      const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
      const chartBox = await chart.boundingBox()
      await chart.click({ position: { x: chartBox!.width * 0.9, y: chartBox!.height * 0.5 } })
      const inspector = page.locator('.figma-global-activity__inspector')
      await expect(inspector.getByText('Bucket selected')).toBeVisible()
      const wire = page.getByRole('region', { name: 'Live Wire', exact: true })
      await expect(wire).toBeVisible()
      const geometry = await page.evaluate(() => {
        const chart = document.querySelector<HTMLElement>('.figma-global-activity__chart-col')
        const inspector = document.querySelector<HTMLElement>('.figma-global-activity__inspector')
        const center = document.querySelector<HTMLElement>('.figma-analytics__center')
        const rail = document.querySelector<HTMLElement>('.figma-analytics__right-rail')
        if (!chart || !inspector || !center || !rail) return null
        const chartRect = chart.getBoundingClientRect()
        const inspectorRect = inspector.getBoundingClientRect()
        const centerRect = center.getBoundingClientRect()
        const railRect = rail.getBoundingClientRect()
        return {
          chartTop: chartRect.top,
          chartRight: chartRect.right,
          chartWidth: chartRect.width,
          inspectorTop: inspectorRect.top,
          inspectorLeft: inspectorRect.left,
          chartBottom: chartRect.bottom,
          railLeft: railRect.left,
          railTop: railRect.top,
          centerRight: centerRect.right,
          centerBottom: centerRect.bottom,
        }
      })
      expect(geometry).not.toBeNull()
      if (geometry!.inspectorLeft >= geometry!.chartRight - 2) {
        expect(geometry!.chartWidth).toBeGreaterThanOrEqual(719)
      } else {
        expect(geometry!.inspectorTop).toBeGreaterThanOrEqual(geometry!.chartBottom - 2)
      }
      if (width >= 1440) expect(geometry!.railLeft).toBeGreaterThanOrEqual(geometry!.centerRight - 2)
      else expect(geometry!.railTop).toBeGreaterThanOrEqual(geometry!.centerBottom - 2)
      await assertNoPageHorizontalOverflow(page)
      if (width === 390 || width === 1440) {
        await page.screenshot({ path: testInfo.outputPath(`live-wire-${width}.png`), fullPage: true })
      }
    })
  }
})
