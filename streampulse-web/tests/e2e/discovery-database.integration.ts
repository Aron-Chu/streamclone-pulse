import { test, expect, type Page } from '@playwright/test'

const apiOrigin = process.env.DISCOVERY_DATABASE_API_ORIGIN!
const month = '2026-08'
const entry = `/analytics/moments?collection=history&month=${month}`

async function connectDatabase(page: Page) {
  await page.addInitScript(() => { Object.assign(window, { __DISCOVERY_CATALOGUE_ENABLED__: true }) })
  await page.routeWebSocket(/.*/, socket => socket.close())
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    // Synthetic identities must never trigger real creator/media lookups.
    if (url.hostname === '127.0.0.1' || url.pathname.startsWith('/v1/')) return route.continue()
    return route.abort()
  })
  await page.route('**/v1/**', async route => {
    const source = new URL(route.request().url())
    if (source.pathname === '/v1/public/discovery' || source.pathname === '/v1/public/discovery/activity') {
      expect(route.request().method()).toBe('GET')
      // Real HTTP handler → isolated PostgreSQL. No synthetic catalogue response
      // or precomputed moment list is supplied by this browser test.
      const response = await page.request.get(`${apiOrigin}${source.pathname}${source.search}`)
      return route.fulfill({ response })
    }
    return route.fulfill({ status: 503, json: { error: 'synthetic_fixture_has_no_media_or_account' } })
  })
}

test.beforeEach(async ({ page }) => { await connectDatabase(page) })

test('exact stored category metadata reaches navigation without a source lookup', async ({ page, request }, info) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  const response = await (await request.get(`${apiOrigin}/v1/public/discovery?month=${month}&login=fixturealpha&limit=100`)).json()
  const minecraft = response.items.filter((item: { category?: string }) => item.category === 'Minecraft')
  expect(minecraft.length).toBeGreaterThan(0)
  const art = 'https://static-cdn.jtvnw.net/ttv-boxart/27471-210x280.jpg'
  for (const item of minecraft) {
    expect(item.categoryId).toBe('27471')
    expect(item.boxArtUrl).toBe(art)
  }
  // Explicit synthetic Helix provenance is persisted in the isolated fixture.
  // Only the image bytes are intercepted; this is not real-art availability proof.
  await page.route(art, route => route.fulfill({ contentType: 'image/svg+xml', body:
    '<svg xmlns="http://www.w3.org/2000/svg" width="210" height="280"><rect width="210" height="280" fill="#222"/><text x="8" y="140" fill="#ddd">Synthetic category art</text></svg>' }))
  let sourceChecks = 0
  page.on('request', req => { if (/\/streams\/[^/]+/.test(new URL(req.url()).pathname)) sourceChecks++ })
  await page.goto(`${entry}&creator=fixturealpha`)
  const category = page.getByRole('button', { name: /^Minecraft \d+ loaded detections?$/ })
  await expect(category).toBeVisible()
  const image = category.locator('img')
  await expect(image).toHaveAttribute('src', art)
  await category.scrollIntoViewIfNeeded()
  await expect(image).toHaveJSProperty('naturalWidth', 210)
  await page.screenshot({ path: info.outputPath('stored-category-artwork-1440.png') })
  await category.click()
  await expect(category).toHaveAttribute('aria-pressed', 'true')
  await expect(page).toHaveURL(/category=Minecraft/)
  expect(sourceChecks).toBe(0)
  await expect(page.locator('iframe')).toHaveCount(0)
})

test('stored artwork metadata never authorizes playback in compact history rows', async ({ page, request }, info) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  const response = await (await request.get(`${apiOrigin}/v1/public/discovery?month=${month}&login=fixturealpha`)).json()
  expect(response.items[0].archiveArtwork.kind).toBe('archive_thumbnail')
  // The metadata was cached through the Go publisher. Only image bytes are a
  // labeled synthetic stand-in; this test never requests a real Twitch asset.
  await page.route('https://static-cdn.jtvnw.net/cf_vods/archive/thumb/test.jpg', route => route.fulfill({
    contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#222"/><text x="24" y="180" fill="#ddd">Synthetic archive artwork test</text></svg>',
  }))
  let sourceChecks = 0
  page.on('request', req => { if (/\/streams\/[^/]+/.test(new URL(req.url()).pathname)) sourceChecks++ })
  await page.goto(`${entry}&creator=fixturealpha`)
  await expect(page.locator('.moments-result').first()).toBeVisible()
  // History uses compact review rows; cached broadcast art is not a frame preview.
  await expect(page.locator('.moments-card-artwork')).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('stored-artwork-gallery-1440.png'), fullPage: false })
  expect(sourceChecks).toBe(0)
  await expect(page.locator('iframe')).toHaveCount(0)
  await page.locator('.moments-result').first().locator('[data-discovery-key]').click()
  await expect(page.getByText('Could not check this source. Retry or open its exact analytics session.', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Selected moment', exact: true }).getByRole('link', { name: /Open VOD at/ })).toHaveCount(0)
  await expect(page.locator('iframe')).toHaveCount(0)
  expect(sourceChecks).toBeGreaterThan(0)
})

test('stored scorer results page beyond the live-feed cap and preserve totals', async ({ page, request }) => {
  const first = await (await request.get(`${apiOrigin}/v1/public/discovery?month=${month}&limit=50`)).json()
  const total = first.days.reduce((sum: number, day: { detections: number | null }) => sum + (day.detections ?? 0), 0)
  expect(total).toBeGreaterThanOrEqual(100)
  await page.goto(entry)
  await expect(page.getByRole('heading', { name: 'Detections 50 loaded', exact: true })).toBeVisible()
  const day = page.getByRole('button', { name: /^2026-08-04:/ })
  const before = await day.getAttribute('aria-label')
  await page.getByRole('combobox', { name: 'Calendar measure', exact: true }).click()
  await page.getByRole('listbox', { name: 'Calendar measure', exact: true }).getByRole('option', { name: 'Chat messages', exact: true }).click()
  await expect(day.locator('small')).toHaveAttribute('title', 'Chat messages: 282,000')
  await page.getByRole('combobox', { name: 'Calendar measure', exact: true }).click()
  await page.getByRole('listbox', { name: 'Calendar measure', exact: true }).getByRole('option', { name: 'Detected moments', exact: true }).click()
  await expect(day.locator('small')).toHaveText('60')
  while (await page.getByRole('button', { name: 'Load more indexed moments', exact: true }).count()) {
    const old = await page.locator('.moments-result').count()
    await page.getByRole('button', { name: 'Load more indexed moments', exact: true }).click()
    await expect.poll(() => page.locator('.moments-result').count()).toBeGreaterThan(old)
  }
  await expect(page.locator('.moments-result')).toHaveCount(total)
  await expect(day).toHaveAttribute('aria-label', before!)
  const identities = await page.locator('[data-discovery-key]').evaluateAll(items => items.map(item => item.getAttribute('data-discovery-key')))
  expect(new Set(identities).size).toBe(total)
})

test('day and creator scopes preserve exact selection, Save, Back and missing media', async ({ page }) => {
  await page.goto(entry)
  await page.getByRole('button', { name: /^2026-08-04:/ }).click()
  await expect(page).toHaveURL(/day=2026-08-04/)
  const opener = page.locator('[data-discovery-key]').first()
  await expect(opener).toBeVisible()
  const identity = JSON.parse((await opener.getAttribute('data-discovery-key'))!) as [string, string, number]
  expect(identity[0]).toBe('fixturebeta')
  await opener.click()
  await expect(page).toHaveURL(new RegExp(`stream=${identity[1]}.*offset=${identity[2]}`))
  const detail = page.getByRole('region', { name: 'Selected moment', exact: true })
  await expect(detail).toContainText('FixtureReaction')
  await expect(detail.getByRole('button', { name: 'Recheck source', exact: true })).toBeVisible()
  await expect(detail.locator('iframe,video')).toHaveCount(0)
  await expect(detail.getByRole('link', { name: /Open VOD at/ })).toHaveCount(0)
  await detail.getByRole('button', { name: 'Save on this device', exact: true }).click()
  await expect(detail.getByRole('button', { name: 'Saved on this device', exact: true })).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(/day=2026-08-04/)
  await expect(page.locator('[data-discovery-key]').first()).toBeFocused()
  await page.getByRole('textbox', { name: 'Browse creator login' }).fill('fixturealpha')
  await page.getByRole('button', { name: 'Apply creator', exact: true }).click()
  await expect(page).toHaveURL(/creator=fixturealpha/)
  await expect(page).not.toHaveURL(/day=/)
  await expect(page.locator('[data-discovery-key]')).toHaveCount(50)
  await expect.poll(async () => (await page.locator('[data-discovery-key]').evaluateAll(items => items.map(item => JSON.parse(item.getAttribute('data-discovery-key')!)[0]))).every(login => login === 'fixturealpha')).toBe(true)
  await page.reload()
  await page.getByText('Change creator', { exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Browse creator login' })).toHaveValue('fixturealpha')
  await expect(page.getByRole('button', { name: 'Saved (1)', exact: true })).toBeVisible()
})

test('measured zero and missing days are distinguishable from detector output', async ({ page }) => {
  await page.goto(entry)
  await expect(page.getByRole('button', { name: /^2026-08-06: 0 measured chat messages, 0 detections/ })).toBeVisible()
  const missing = page.getByRole('button', { name: '2026-08-05: no indexed measurements; not a measured zero', exact: true })
  await missing.click()
  await expect(page.getByRole('heading', { name: '2026-08-05 · UTC 0 loaded', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /^2026-08-04:/ })).toContainText(/[1-9]/)
})

test('year overview reads daily facts and drills into the exact day and creator', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto(entry)
  await page.getByRole('button', { name: 'Year overview', exact: true }).click()
  const overview = page.getByRole('region', { name: 'Year activity overview', exact: true })
  await expect(overview.getByText('120', { exact: true })).toBeVisible()
  await overview.getByText('More calendar options', { exact: true }).click()
  await overview.getByRole('combobox', { name: 'Years shown' }).click()
  await overview.getByRole('listbox', { name: 'Years shown', exact: true }).getByRole('option', { name: 'Up to three years', exact: true }).click()
  await expect(page).toHaveURL(/years=3/)
  await expect(overview.getByRole('region', { name: '2024 activity', exact: true })).toBeVisible()
  await expect(overview.getByRole('region', { name: '2025 activity', exact: true })).toBeVisible()
  await expect(overview.getByRole('region', { name: '2026 activity', exact: true }).getByText('120', { exact: true })).toBeVisible()
  await page.reload()
  await overview.getByText('More calendar options', { exact: true }).click()
  await expect(overview.getByRole('combobox', { name: 'Years shown' })).toContainText('Up to three years')
  const day = overview.getByRole('button', { name: /^2026-08-04:/ })
  const measuredFill = await day.evaluate(el => getComputedStyle(el).backgroundColor)
  await day.hover()
  expect(await day.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(measuredFill)
  await expect(overview.locator('.discovery-year__readout')).toContainText('60 detections')
  await page.screenshot({ path: info.outputPath('stored-year-1440.png') })
  await day.click()
  await expect(page).toHaveURL(/day=2026-08-04/)
  await expect(page.locator('[data-discovery-key]')).toHaveCount(50)
  await expect(page.locator('[data-discovery-key]').first()).toHaveAttribute('data-discovery-key', /fixturebeta/)
  await page.goBack()
  await expect(day).toBeFocused()
  await day.click()
  await page.getByRole('textbox', { name: 'Browse creator login' }).fill('fixturealpha')
  await page.getByRole('button', { name: 'Apply creator', exact: true }).click()
  await page.getByRole('button', { name: 'Year overview', exact: true }).click()
  await expect(overview.getByText('60', { exact: true })).toBeVisible()
  await expect(overview.getByRole('button', { name: /^2026-08-04:/ })).toHaveAttribute('data-state', 'no_measurement')
  await page.setViewportSize({ width: 768, height: 960 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await overview.getByRole('region', { name: '2026 activity', exact: true }).locator('.discovery-year__plot').scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('stored-year-768.png') })
  await page.setViewportSize({ width: 390, height: 960 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await overview.getByRole('region', { name: '2026 activity', exact: true }).locator('.discovery-year__plot').scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('stored-year-390.png') })
  await overview.getByRole('textbox', { name: 'Year overview day' }).fill('2026-08-03')
  await overview.getByRole('button', { name: 'Open day', exact: true }).click()
  await expect(page).toHaveURL(/day=2026-08-03/)
})

for (const width of [390, 768, 1440]) {
  test(`database-backed calendar and selected evidence at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 960 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(entry)
    await expect(page.getByRole('heading', { name: 'Detections 50 loaded', exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath(`stored-calendar-${width}.png`), fullPage: false })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.locator('[data-discovery-key]').first().click()
    const detail = page.getByRole('region', { name: 'Selected moment', exact: true })
    await expect(detail).toContainText('FixtureReaction')
    await expect(detail.getByRole('button', { name: 'Recheck source', exact: true })).toBeVisible()
    if (width < 850) await expect(page.getByRole('region', { name: 'Browse measured activity by day', exact: true })).toBeHidden()
    await page.screenshot({ path: info.outputPath(`stored-detail-${width}.png`), fullPage: false })
    if (width === 1440) {
      await page.evaluate(() => { document.documentElement.style.zoom = '2' })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    await detail.getByRole('button', { name: 'Back to results', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Browse measured activity by day', exact: true })).toBeVisible()
    await expect(page.locator('[data-discovery-key]').first()).toBeFocused()
  })
}
