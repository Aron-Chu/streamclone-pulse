import { expect, test, type Page } from './helpers/portalMockedTest'
import { installHubUxMock } from './helpers/hubUxMock'

/** Pulse Explorer is retired into Moments; its old links still land on a real page. */
async function install(page: Page) {
  const explorerRequests: string[] = []
  page.on('request', request => {
    if (/\/v1\/public\/explorer(?:[/?]|$)/.test(request.url())) explorerRequests.push(request.url())
  })
  await page.route('**/v1/**', route => route.fulfill({ json: {} }))
  await installHubUxMock(page)
  return explorerRequests
}

test.describe('retired Pulse Explorer', () => {
  test('is gone from the top navigation', async ({ page }) => {
    await install(page)
    await page.goto('/analytics')
    await expect(page.getByRole('link', { name: 'All moments', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Pulse Explorer' })).toHaveCount(0)
  })

  for (const path of [
    '/analytics/explore',
    '/analytics/explore?window=7d&signal=emotes&sort=strongest&q=chat#evidence',
    '/analytics/explore/story-1?window=live',
  ]) {
    test(`${path} opens Moments without Explorer's filters`, async ({ page }) => {
      const explorerRequests = await install(page)
      await page.goto(path)
      await expect(page).toHaveURL(/\/analytics\/moments$/)
      await expect(page.getByRole('tablist', { name: 'Moment views' })).toBeVisible()
      expect(explorerRequests).toEqual([])
    })
  }

  test('a broadcast link opens that stream page', async ({ page }) => {
    const explorerRequests = await install(page)
    await page.goto('/analytics/explore/pulse-xqc-session-1?window=7d&sort=recent#evidence')
    await expect(page).toHaveURL(/\/analytics\/xqc\/session-1$/)
    await expect(page.getByRole('navigation', { name: 'Broadcast navigation' })).toBeVisible()
    expect(explorerRequests).toEqual([])
  })
})
