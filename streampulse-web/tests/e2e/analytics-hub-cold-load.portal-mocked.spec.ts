import { expect, test, type Page } from './helpers/portalMockedTest'
import { installHubUxMock } from './helpers/hubUxMock'

// A busy API can take the whole 20 s deadline to build the 24h hub. A first
// visit shows the 30m view once the 24h read has run alone for its 1 s head
// start, with the chart still loading, and swaps in the 24h view when it lands.
// That 30m read is the load's only one. Every request is answered by the hub
// mock; the 24h reply is held behind a gate.

/** The Channels count once the mock's live rows are on screen. */
const LIVE_COUNT = /^14 of \d+ live$/

const isRecentHubRead = (url: string) =>
  /\/v1\/public\/hub\?/.test(url) &&
  new URL(url).searchParams.get('activityWindow') === '30m' &&
  !new URL(url).searchParams.has('include')

async function holdLongWindowHub(page: Page, gate: Promise<void>, reply: 'mock' | 503 = 'mock') {
  await page.route(/\/v1\/public\/hub(\?.*)?$/, async (route) => {
    if (new URL(route.request().url()).searchParams.get('activityWindow') === '30m') return route.fallback()
    await gate
    if (reply === 'mock') return route.fallback()
    return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'unavailable' }) })
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
    const channelCount = page.locator('[data-hv5-channel-count]')
    await expect(channelCount).toHaveText(LIVE_COUNT)
    await expect(chart).toHaveAttribute('data-refreshing', 'true')
    await expect(chart.getByText('Loading measured activity…', { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('early-30m-view.png') })

    release24h()
    await expect(chart).not.toHaveAttribute('data-refreshing', 'true')
    await expect(chart.getByText('Loading measured activity…', { exact: true })).toHaveCount(0)
    await expect.poll(() => chart.locator('.spc-bar').count()).toBeGreaterThan(30)
    await expect(channelCount).toHaveText(LIVE_COUNT)
    await page.screenshot({ path: testInfo.outputPath('swapped-24h-view.png') })
  } finally {
    release24h()
  }
})

test('a failed slow 24h read keeps the 30m view it already read, with no second 30m read', async ({ page }) => {
  let fail24h!: () => void
  const gate = new Promise<void>(resolve => { fail24h = resolve })
  await installHubUxMock(page)
  await holdLongWindowHub(page, gate, 503)
  const recentReads: string[] = []
  page.on('request', request => { if (isRecentHubRead(request.url())) recentReads.push(request.url()) })
  await page.goto('/analytics')
  try {
    const chart = page.locator('.figma-global-activity__hub-chart')
    await expect(chart).toHaveAttribute('data-refreshing', 'true')
    fail24h()
    const activity = page.locator('.figma-global-activity')
    await expect(chart).not.toHaveAttribute('data-refreshing', 'true')
    await expect(activity).toHaveAttribute('data-hub-activity-source', 'live_pool_fallback')
    await expect(activity).toHaveAttribute('data-hub-served-window-minutes', '30')
    await expect(page.locator('[data-hv5-channel-count]')).toHaveText(LIVE_COUNT)
    expect(recentReads).toHaveLength(1)
  } finally {
    fail24h()
  }
})

test('a quick 24h hub reply makes no 30m read', async ({ page }) => {
  await installHubUxMock(page)
  const recentReads: string[] = []
  page.on('request', request => { if (isRecentHubRead(request.url())) recentReads.push(request.url()) })
  await page.goto('/analytics')
  const chart = page.locator('.figma-global-activity__hub-chart')
  await expect.poll(() => chart.locator('.spc-bar').count()).toBeGreaterThan(30)
  // Past the 1 s head start: a timer left running would read the 30m view now.
  await page.waitForTimeout(2_000)
  expect(recentReads).toEqual([])
})
