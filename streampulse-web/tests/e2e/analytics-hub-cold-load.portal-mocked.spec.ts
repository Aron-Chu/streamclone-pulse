import { expect, test, type Page } from '@playwright/test'
import { installHubUxMock } from './helpers/hubUxMock'

// A busy API has taken 24–40 s to build the 24h hub. A first visit shows the
// 30m view once the 24h read has run alone for its head start, with the chart
// still loading, and swaps in the 24h view when it lands. Every request is
// answered by the hub mock; the 24h reply is held behind a gate.

const isRecentHubRead = (url: string) =>
  /\/v1\/public\/hub\?/.test(url) &&
  new URL(url).searchParams.get('activityWindow') === '30m' &&
  !new URL(url).searchParams.has('include')

async function holdLongWindowHub(page: Page, gate: Promise<void>) {
  await page.route(/\/v1\/public\/hub(\?.*)?$/, async (route) => {
    if (new URL(route.request().url()).searchParams.get('activityWindow') !== '30m') await gate
    await route.fallback()
  })
}

test('a first visit shows the 30m view while a slow 24h hub read finishes', async ({ page }, testInfo) => {
  let release24h!: () => void
  const gate = new Promise<void>(resolve => { release24h = resolve })
  await installHubUxMock(page)
  await holdLongWindowHub(page, gate)
  const recentRequested = page.waitForRequest(request => isRecentHubRead(request.url()))
  await page.goto('/analytics')
  try {
    await recentRequested
    const chart = page.locator('.figma-global-activity__hub-chart')
    const roster = page.locator('.live-channels-matrix')
    await expect(roster.locator('.live-channels-matrix__result-count')).toHaveText('14 channels tracked')
    await expect(page.getByText('Updating chart…')).toBeVisible()
    await expect(chart.getByText('Loading measured activity…', { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('early-30m-view.png') })

    release24h()
    await expect(page.getByText('Updating chart…')).toHaveCount(0)
    await expect(chart.getByText('Loading measured activity…', { exact: true })).toHaveCount(0)
    await expect.poll(() => chart.locator('.hx-chat-bar').count()).toBeGreaterThan(30)
    await expect(roster.locator('.live-channels-matrix__result-count')).toHaveText('14 channels tracked')
    await page.screenshot({ path: testInfo.outputPath('swapped-24h-view.png') })
  } finally {
    release24h()
  }
})

test('a quick 24h hub reply makes no 30m read', async ({ page }) => {
  await installHubUxMock(page)
  const recentReads: string[] = []
  page.on('request', request => { if (isRecentHubRead(request.url())) recentReads.push(request.url()) })
  await page.goto('/analytics')
  const chart = page.locator('.figma-global-activity__hub-chart')
  await expect.poll(() => chart.locator('.hx-chat-bar').count()).toBeGreaterThan(30)
  // Past the 3 s head start: a timer left running would read the 30m view now.
  await page.waitForTimeout(4_000)
  expect(recentReads).toEqual([])
})
