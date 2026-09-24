import { test, expect } from '@playwright/test'

// Opt-in live evidence, not deterministic fixture acceptance. No API interception.
test('hosted Latest first screen and unavailable discovery recovery', async ({ page }, testInfo) => {
  test.skip(process.env.PORTAL_LIVE_AVAILABILITY !== '1', 'Requires explicit hosted read-only observation')
  const reads: { path: string; status: number }[] = []
  const mutations: string[] = []
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/v1/') && request.method() !== 'GET') mutations.push(request.method() + ' ' + request.url())
  })
  page.on('response', response => {
    const url = new URL(response.url())
    if (url.pathname.startsWith('/v1/public/')) reads.push({ path: url.origin + url.pathname + url.search, status: response.status() })
  })
  const hubResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/v1/public/hub')
  await page.goto('/analytics/moments')
  const hub = await hubResponse
  expect(new URL(hub.url()).origin).toBe('https://api.streampulse.stream')
  expect(hub.status()).toBe(200)
  const payload = await hub.json()
  await expect(page.getByRole('tab', { name: 'Latest', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.moments-result').first()).toBeVisible()
  await expect(page.getByLabel('Ranked order')).toHaveCount(0)
  await expect(page.locator('.moments-result-rank')).toHaveCount(0)
  expect(reads.some(read => read.path.includes('/discovery'))).toBe(false)
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.locator('.moments-result').first()).toBeInViewport()
    await expect.poll(() => page.locator('.moments-result').first().evaluate(row => Number(getComputedStyle(row).opacity))).toBe(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`latest-live-${width}.png`) })
  }
  const shown = await page.locator('.moments-result').count()
  await page.getByRole('tab', { name: 'Explore', exact: true }).click()
  await expect(page).toHaveURL(/view=explore/)
  await expect(page.getByText(/not deployed on this server \(HTTP 404\)/)).toBeVisible()
  await expect(page.getByText(/No ranked moments in/)).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('explore-live-404.png') })
  await page.getByRole('link', { name: /^Browse Latest moments/ }).click()
  await expect(page.locator('.moments-result').first()).toBeVisible()
  await page.getByRole('tab', { name: 'History', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'History', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('region', { name: 'Year activity overview', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Rankings unavailable' })).toBeVisible()
  await expect(page.getByText(/not deployed on this server \(HTTP 404\)/)).toBeVisible()
  await expect(page.getByText(/No ranked moments in/)).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('history-live-404.png') })
  await page.getByRole('link', { name: /^Browse Latest moments/ }).click()
  await expect(page.locator('.moments-result').first()).toBeVisible()
  expect(mutations).toEqual([])
  console.log(JSON.stringify({ shown, suppliedLiveMoments: payload.livePulseMoments?.length, generatedAt: payload.generatedAt, reads, mutations }))
})
