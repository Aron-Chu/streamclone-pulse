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

test.describe('Pulse Newsroom shared sidecar', () => {
  test('resolves a loaded story without a synthetic moment or historical bucket request', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    let bucketRequests = 0
    page.on('request', (request) => {
      if (/\/v1\/public\/hub\/moments(?:\?|$)/.test(request.url())) bucketRequests += 1
    })
    await install(page)
    await page.goto('/analytics')

    const activity = page.getByRole('region', { name: 'Global activity' })
    const sidecar = activity.locator('.activity-newsroom-sidecar')
    await expect(activity.locator('.figma-global-activity__annotation-lane')).toHaveCount(0)
    await expect(sidecar).toHaveCount(1)
    await expect(sidecar).toHaveAttribute('data-sidecar-view', 'live-desk')
    await expect(sidecar.getByText('Live Desk', { exact: true })).toBeVisible()
    await expect(sidecar.locator('.hub-live-wire')).toHaveCount(0)
    await expect(sidecar).not.toContainText('/100')

    const routeBefore = page.url()
    await sidecar.locator('[data-story-id="story-xqc"]').getByRole('button', { name: 'Inspect activity' }).click()
    await expect(sidecar).toHaveAttribute('data-sidecar-view', 'inspector')
    await expect(sidecar.getByRole('button', { name: 'Back to Live Desk' })).toBeFocused()
    await expect(page.locator('.figma-global-activity__hub-chart .hx-chart2')).toHaveAttribute('data-selected', 'true')
    await expect.poll(() => bucketRequests).toBe(0)
    expect(page.url()).toBe(routeBefore)

    await sidecar.getByRole('button', { name: 'Back to Live Desk' }).click()
    await expect(sidecar).toHaveAttribute('data-sidecar-view', 'live-desk')
    await expect(sidecar.getByText('Live Desk', { exact: true })).toBeVisible()
    await expect.poll(() => bucketRequests).toBe(0)
    await assertNoConsoleErrors(page, errors)
  })

  test('unresolved secondary story opens its canonical detail route', async ({ page }) => {
    await install(page)
    await page.goto('/analytics')
    await page.locator('.activity-newsroom-sidecar')
      .getByRole('button', { name: /lirik chat activity is developing/i })
      .click()
    await expect(page).toHaveURL(/\/analytics\/newsroom\/story-lirik$/)
    await expect(page.getByRole('heading', { name: 'Pulse story' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: /lirik chat activity is developing/i })).toBeVisible()
  })

  test('canonical detail survives refresh and exposes distinct accessible actions', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await install(page)
    await page.goto('/analytics/newsroom/story-xqc')
    await expect(page.getByRole('heading', { name: 'Pulse story' })).toBeVisible()
    const actions = page.getByRole('group', { name: 'Story actions' })
    const analytics = actions.getByRole('link', { name: 'Analytics' })
    const watch = actions.getByRole('link', { name: 'Watch live' })
    await expect(analytics).toHaveAttribute('href', /\/analytics\/xqc\/s1\?t=240$/)
    await expect(watch).toHaveAttribute('href', 'https://www.twitch.tv/xqc')
    await expect(actions.getByRole('button', { name: 'Copy link' })).toBeVisible()
    await expect(page.locator('.newsroom-page')).not.toContainText('/100')

    await page.reload()
    await expect(page).toHaveURL(/\/analytics\/newsroom\/story-xqc$/)
    await expect(page.getByRole('heading', { level: 2, name: /xQc emote reaction keeps building/i })).toBeVisible()
    await page.getByRole('link', { name: 'All stories' }).click()
    await expect(page).toHaveURL(/\/analytics\/newsroom$/)
    await page.goBack()
    await expect(page).toHaveURL(/\/analytics\/newsroom\/story-xqc$/)
    await assertNoConsoleErrors(page, errors)
  })

  for (const mode of ['empty', 'unavailable', 'malformed'] as const) {
    test(`${mode} state is explicit and never creates a second rail`, async ({ page }) => {
      await install(page, mode)
      await page.goto('/analytics')
      const activity = page.getByRole('region', { name: 'Global activity' })
      const sidecar = activity.locator('.activity-newsroom-sidecar')
      await expect(sidecar).toHaveCount(1)
      await expect(activity.locator('.figma-global-activity__annotation-lane, .figma-analytics__right-rail')).toHaveCount(0)
      if (mode === 'empty') {
        await expect(sidecar.getByText('Quiet now')).toBeVisible()
        await expect(sidecar.locator('.hub-live-wire')).toHaveCount(0)
      } else {
        await expect(sidecar.locator('.hub-live-wire--rail')).toBeVisible()
      }
    })
  }

  test('stale index preserves stories and labels both content and shell as stale', async ({ page }) => {
    await install(page, 'stale')
    await page.goto('/analytics/newsroom')
    await expect(page.getByLabel('Newsroom: Stale')).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: /xQc emote reaction keeps building/i })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: /Data through/i })).toBeVisible()
    await expect(page.getByLabel('Newsroom: Live')).toHaveCount(0)
  })

  for (const width of [390, 768, 1280, 1440, 1600]) {
    test(`keeps chart usable and the shared sidecar responsive at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 800 ? 1000 : 900 })
      await install(page)
      await page.goto('/analytics')
      await expect(page.getByRole('region', { name: 'Global activity' })).toBeVisible()
      await expect(page.locator('.figma-global-activity__chart-col')).toBeVisible()
      await expect(page.locator('.figma-global-activity__inspector')).toBeVisible()
      const geometry = await page.evaluate(() => {
        const chart = document.querySelector<HTMLElement>('.figma-global-activity__chart-col')
        const sidecar = document.querySelector<HTMLElement>('.figma-global-activity__inspector')
        if (!chart || !sidecar) return null
        const chartRect = chart.getBoundingClientRect()
        const sidecarRect = sidecar.getBoundingClientRect()
        const beside = Math.abs(chartRect.top - sidecarRect.top) < 2
        return {
          beside,
          chartWidth: chartRect.width,
          sidecarTop: sidecarRect.top,
          chartBottom: chartRect.bottom,
          sidecarOverflowY: getComputedStyle(sidecar).overflowY,
        }
      })
      expect(geometry).not.toBeNull()
      if (geometry?.beside) expect(geometry.chartWidth).toBeGreaterThanOrEqual(719)
      else expect(geometry!.sidecarTop).toBeGreaterThanOrEqual(geometry!.chartBottom - 2)
      expect(geometry?.sidecarOverflowY).not.toBe('auto')
      expect(geometry?.sidecarOverflowY).not.toBe('scroll')
      await assertNoPageHorizontalOverflow(page)
    })
  }

  test('window controls fetch their requested server range and preserve canonical navigation', async ({ page }) => {
    const requested: string[] = []
    page.on('request', (request) => {
      if (/\/v1\/public\/newsroom\?/.test(request.url())) requested.push(new URL(request.url()).searchParams.get('window') ?? '')
    })
    await install(page)
    await page.goto('/analytics/newsroom')
    await page.getByRole('button', { name: '24h' }).click()
    await expect(page).toHaveURL(/window=24h/)
    await page.getByRole('button', { name: '7d' }).click()
    await expect(page).toHaveURL(/window=7d/)
    await expect.poll(() => requested).toEqual(expect.arrayContaining(['live', '24h', '7d']))
  })
})
