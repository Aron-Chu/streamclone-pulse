import { expect, test, type Page } from '@playwright/test'

const DAY = 86_400_000
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** Certified, empty ranked collections for any creator; every other API read gets an empty body. */
async function installRankedCollections(page: Page, options: { creatorAvailabilityDelayMs?: number } = {}) {
  const today = utcDay(Date.now())
  const todayMs = Date.parse(today)
  const firstDay = utcDay(todayMs - 30 * DAY)
  const asOf = new Date().toISOString()
  const availability: string[] = []
  const ranked: string[] = []
  await page.route('**/v1/**', async (route) => {
    const url = new URL(route.request().url())
    const login = url.searchParams.get('login') || ''
    if (url.pathname === '/v1/public/discovery/ranked/availability') {
      availability.push(login)
      if (login && options.creatorAvailabilityDelayMs) await new Promise((resolve) => setTimeout(resolve, options.creatorAvailabilityDelayMs))
      return route.fulfill({ json: { schemaVersion: 1, state: 'ready', scope: 'indexed_completed_public_irc_streams',
        login, asOf, serverToday: today, certifiedFrom: firstDay, certifiedThroughExclusive: today, verifiedAt: asOf, certificateGeneration: 1,
        days: Array.from({ length: 30 }, (_, i) => ({ day: utcDay(todayMs - 30 * DAY + i * DAY), state: 'no_measurement', coverage: 'none',
          streams: 0, measuredStreamMinutes: 0, chatMessages: null, emoteUses: null, detections: null })) } }).catch(() => {})
    }
    if (url.pathname === '/v1/public/discovery/ranked') {
      ranked.push(login)
      return route.fulfill({ json: { schemaVersion: 1, state: 'ready', scope: 'indexed_completed_public_irc_streams',
        from: url.searchParams.get('from'), to: url.searchParams.get('to'), login, category: null, categoryMissing: false, sort: 'volume', asOf,
        rankingVersion: 'volume-observed-irc-v1', items: [], nextCursor: null, facets: [],
        coverage: { state: 'none', scope: 'time_and_creator_completed_broadcasts_only', indexedStreams: 0, measuredMinutes: 0 },
        eligibility: { scope: 'time_creator_category_before_pagination', totalDetections: 0, rankedDetections: 0, excludedDetections: 0 },
        freshness: 'ready', indexedRetentionStart: firstDay, indexedRetentionAttestedAt: asOf,
        certifiedThroughExclusive: today, certificateGeneration: 1, projectionUpdatedAt: null, dataThrough: null } }).catch(() => {})
    }
    return route.fulfill({ json: {} }).catch(() => {})
  })
  return { availability, ranked }
}

/** Scroll the page down until the field sits `top` px below the viewport top (or as far as the page allows). */
async function scrollFieldTo(page: Page, label: string, top: number) {
  const scrollY = await page.getByLabel(label).evaluate((field, offset) => {
    window.scrollTo(0, Math.max(0, window.scrollY + field.getBoundingClientRect().top - offset))
    return window.scrollY
  }, top)
  expect(scrollY).toBeGreaterThan(0)
  return scrollY
}

const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 390, height: 844 }]

test('Explore creator login applies once after typing, replaces the history entry and keeps the reading position', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const { ranked } = await installRankedCollections(page)
  await page.goto('/analytics/moments?view=explore')
  await expect(page.getByText(/Snapshot:/)).toBeVisible()
  const historyLength = await page.evaluate(() => history.length)
  const input = page.getByLabel('Exact creator login')
  const scrollY = await scrollFieldTo(page, 'Exact creator login', 120)
  await input.click()
  await input.pressSequentially('creator', { delay: 80 })
  await expect(page).toHaveURL(/creator=creator/)
  await expect.poll(() => ranked.filter(Boolean)).toEqual(['creator'])
  expect(await page.evaluate(() => history.length)).toBe(historyLength)
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY)
  await expect(input).toBeInViewport()
  await expect(input).toBeFocused()
  await expect(input).toHaveValue('creator')
})

for (const viewport of VIEWPORTS) {
  test(`History creator keeps focus, the open Filters panel and its place while the new creator is checked (${viewport.width}px)`, async ({ page }) => {
    await page.setViewportSize(viewport)
    const { availability, ranked } = await installRankedCollections(page, { creatorAvailabilityDelayMs: 1_000 })
    await page.goto('/analytics/moments?view=history')
    const overview = page.getByRole('region', { name: 'Recent activity overview' })
    await expect(overview).toBeVisible()
    const filters = page.locator('details.moments-history__filters')
    await filters.locator('summary').click()
    const input = page.getByLabel('History creator')
    const clear = page.getByRole('button', { name: 'Clear filters' })
    const scrollY = await scrollFieldTo(page, 'History creator', viewport.height / 2)
    const panel = await clear.boundingBox()
    await input.click()
    await input.pressSequentially('creator', { delay: 80 })
    await expect(page).toHaveURL(/scope=creator&creator=creator/)
    // The last checked calendar stays while the new creator is checked, so nothing moves.
    await expect(page.getByText('Checking certified dates…')).toBeVisible()
    expect(await clear.boundingBox()).toEqual(panel)
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollY)
    await expect(input).toBeInViewport()
    await expect(input).toBeFocused()
    await expect(filters).toHaveJSProperty('open', true)

    await expect(page.getByRole('heading', { name: '@creator' })).toBeVisible()
    await expect(page.getByText('Checking certified dates…')).toHaveCount(0)
    await expect(overview).toBeVisible()
    expect(await clear.boundingBox()).toEqual(panel)
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollY)
    await expect(input).toBeInViewport()
    await expect(input).toBeFocused()
    await expect(input).toHaveValue('creator')
    await expect(filters).toHaveJSProperty('open', true)
    expect(availability.filter(Boolean)).toEqual(['creator'])
    await expect.poll(() => ranked.filter(Boolean)).toEqual(['creator'])
  })

  test(`a held mouse press on Clear filters right after typing a History creator still clears the filters (${viewport.width}px)`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await installRankedCollections(page, { creatorAvailabilityDelayMs: 1_500 })
    await page.goto('/analytics/moments?view=history')
    await expect(page.getByRole('region', { name: 'Recent activity overview' })).toBeVisible()
    await page.locator('details.moments-history__filters summary').click()
    const input = page.getByLabel('History creator')
    await scrollFieldTo(page, 'History creator', viewport.height / 2)
    await input.click()
    await input.pressSequentially('creator', { delay: 40 })
    // Leaving the field applies the typed creator on mousedown; the button must not move before mouseup.
    const box = (await page.getByRole('button', { name: 'Clear filters' }).boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(150)
    await page.mouse.up()
    await expect.poll(() => new URL(page.url()).searchParams.get('creator')).toBeNull()
    await expect(input).toHaveValue('')
    await expect(page.getByRole('heading', { name: 'Global moments' })).toBeVisible()
  })
}
