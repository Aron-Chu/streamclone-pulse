import { expect, test } from '@playwright/test'

import { payload } from './helpers/explorerMock'
import { installHubUxMock } from './helpers/hubUxMock'

test('a Load more page that lands after a sort change never joins the new results', async ({ page }) => {
  // Registered first, so it only answers API reads no later mock handles.
  await page.route('**/v1/**', (route) => route.fulfill({ status: 404, json: { error: 'not_mocked' } }))
  await installHubUxMock(page)
  let releaseOldPage!: () => void
  const oldPageHeld = new Promise<void>((resolve) => { releaseOldPage = resolve })
  let oldPageSettled!: () => void
  const oldPageAnswered = new Promise<void>((resolve) => { oldPageSettled = resolve })
  let continuations = 0
  const firstPages: string[] = []
  const cancelled: string[] = []
  page.on('requestfailed', (request) => {
    if (new URL(request.url()).searchParams.has('cursor')) cancelled.push(request.url())
  })
  await page.route(/\/v1\/public\/explorer(\/[^?]+)?(\?.*)?$/, async (route) => {
    const url = new URL(route.request().url())
    const detailId = url.pathname.split('/explorer/')[1]
    const base = payload('ready', detailId, url)
    let body: object = base
    if (!detailId && url.searchParams.get('cursor')) {
      // The old query's page 2 is held until the reader has changed the sort.
      continuations += 1
      await oldPageHeld
      body = { ...base, broadcasts: base.broadcasts.map((row) => ({ ...row, id: `${row.id}-p2` })) }
    } else if (!detailId) {
      firstPages.push(url.searchParams.get('sort') || 'strongest')
      body = { ...base, nextCursor: `${url.searchParams.get('sort')}-page-2` }
    }
    // The page may already have cancelled the held request.
    await route.fulfill({ status: detailId && !base.broadcast ? 404 : 200, contentType: 'application/json', body: JSON.stringify(body) }).catch(() => {})
    if (!detailId && url.searchParams.get('cursor')) oldPageSettled()
  })

  await page.goto('/analytics/explore')
  await page.getByRole('button', { name: 'Load more broadcasts' }).click()
  await expect.poll(() => continuations).toBe(1)
  await page.getByLabel('Sort').selectOption('recent')
  await expect(page).toHaveURL(/sort=recent/)
  // Well inside the client's 8 s request deadline, which would otherwise cancel
  // the held page by itself: the new sort offers its own Load more at once,
  // and the old continuation has already been cancelled.
  await expect.poll(() => firstPages).toContain('recent')
  await expect(page.getByRole('button', { name: 'Load more broadcasts' })).toBeEnabled({ timeout: 3_000 })
  await expect.poll(() => cancelled.length, { timeout: 3_000 }).toBe(1)

  // Even if the old page is answered now, none of it may join the new results.
  releaseOldPage()
  await oldPageAnswered
  await page.waitForTimeout(1_000)
  await expect(page.locator('a.explorer-result[href*="-p2"]')).toHaveCount(0)
  await expect(page.locator('a.explorer-result')).toHaveCount(4)
  await expect(page.getByRole('button', { name: 'Load more broadcasts' })).toBeEnabled()
})
