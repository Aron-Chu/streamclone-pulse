import { test, expect } from '@playwright/test'
import { installHubUxMock } from './helpers/momentshubUxMock'

test('real local router resolves category covers for Recent review and Saved without persisting media', async ({ page }, info) => {
  const backend = process.env.CATEGORY_ARTWORK_BACKEND_URL
  test.skip(!backend, 'Run through TestCategoryArtworkPortalIntegration with fake Helix')
  expect(new URL(backend!).hostname).toBe('127.0.0.1')
  await page.context().grantPermissions(['local-network-access'], { origin: new URL(process.env.PLAYWRIGHT_BASE_URL!).origin })
  await page.route('**/*', route => {
    const host = new URL(route.request().url()).hostname
    return host === '127.0.0.1' || host === 'localhost' ? route.continue() : route.abort()
  })
  await page.route('**/analytics/moments', async route => {
    const response = await route.fetch()
    await route.fulfill({ response, body: (await response.text()).replace("connect-src 'self'", `connect-src 'self' ${backend}`) })
  })
  // Existing explicit local opt-in, isolated to this browser's served module.
  await page.route('**/src/lib/auth.ts*', async route => {
    const response = await route.fetch()
    const body = await response.text()
    const envEnd = body.indexOf(';') + 1
    expect(envEnd).toBeGreaterThan(0)
    await route.fulfill({ response, body: body.slice(0, envEnd) + `\nimport.meta.env.VITE_ALLOW_LOCAL_BACKEND = '1'; import.meta.env.VITE_BACKEND_URL = ${JSON.stringify(backend)};\n` + body.slice(envEnd) })
  })
  await installHubUxMock(page)
  await page.route('**/v1/channels/*', route => route.fulfill({ json: {} }))
  await page.route('**/v1/portal/analytics/streams/**', route => route.fulfill({ json: {} }))
  await page.route('https://static-cdn.jtvnw.net/ttv-boxart/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="210" height="280"><rect width="210" height="280" fill="#30b898"/><text x="10" y="140">Synthetic cover</text></svg>' }))
  page.on('console', message => { if (message.type() === 'error') console.log('browser:', message.text()) })
  // React may cancel the initial read while the loaded collection settles.
  // Prove a completed browser response, not merely receipt of its headers.
  const result = page.waitForResponse(async response => response.url() === `${backend}/v1/public/categories/artwork`
    && response.request().method() === 'POST' && await response.finished() === null, { timeout: 15_000 })
  await page.goto('/analytics/moments')
  const response = await result
  expect(response.status()).toBe(200)
  expect((await response.json()).items).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'resolved', categoryId: '27471', matchedBy: 'name' })]))
  const category = page.locator('.moments-category-browser img').first()
  await expect(category).toHaveAttribute('src', /_IGDB-210x280.jpg$/)
  await page.locator('.moments-result .moment-save-control button').first().click()
  await page.locator('[data-discovery-key]').first().click()
  await expect(page.getByRole('table', { name: 'Loaded detection review' })).toBeVisible()
  await expect(page.locator('.moments-review-category img').first()).toHaveAttribute('src', /_IGDB-210x280.jpg$/)
  await page.getByRole('button', { name: 'Saved (1)', exact: true }).click()
  await expect(page.locator('.moments-category-browser img').first()).toHaveAttribute('src', /_IGDB-210x280.jpg$/)
  const storage = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])))
  const bookmarks = Object.entries(storage).filter(([key]) => /saved.*moment|moment.*saved/i.test(key))
  expect(bookmarks.length).toBeGreaterThan(0)
  expect(JSON.stringify(bookmarks)).not.toContain('ttv-boxart')
  await page.screenshot({ path: info.outputPath('synthetic-real-router-saved.png'), fullPage: true })
})
