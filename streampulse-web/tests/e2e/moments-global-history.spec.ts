import { test, expect } from '@playwright/test'

function availability(asOf: string, measured: (day: string) => boolean, login = '') {
  const serverToday = asOf.slice(0, 10)
  const start = Date.parse(serverToday) - 30 * 86400000
  const certifiedFrom = new Date(start).toISOString().slice(0, 10)
  return { schemaVersion: 1, state: 'ready', scope: 'indexed_completed_public_irc_streams', login,
    asOf, serverToday, certifiedFrom, certifiedThroughExclusive: serverToday, verifiedAt: asOf, certificateGeneration: 1,
    days: Array.from({ length: 30 }, (_, i) => { const day = new Date(start + i * 86400000).toISOString().slice(0, 10); const found = measured(day); return {
      day, state: found ? 'measured' : 'no_measurement', coverage: found ? 'partial' : 'none', streams: found ? 1 : 0,
      measuredStreamMinutes: found ? 60 : 0, chatMessages: found ? 100 : null, emoteUses: found ? 50 : null, detections: found ? i % 10 : null,
    } }) }
}

for (const width of [390, 1440]) test(`global recent History at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  const today = new Date().toISOString().slice(0, 10)
  const todayMs = Date.parse(today)
  const recentStart = new Date(todayMs - 30 * 86400000).toISOString().slice(0, 10)
  const targetDay = new Date(todayMs - 86400000).toISOString().slice(0, 10)
  const priorWeek = new Date(todayMs - 8 * 86400000).toISOString().slice(0, 10)
  const targetEnd = today
  const asOf = new Date().toISOString()
  const requests: URL[] = []
  const calendarRequests: URL[] = []
  await page.route('**/v1/**', route => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/discovery/ranked/availability')) {
      calendarRequests.push(url)
      return route.fulfill({ json: availability(asOf, day => day >= recentStart && day < today, url.searchParams.get('login') || '') })
    }
    if (url.pathname.endsWith('/discovery')) return route.fulfill({ status: 503, json: { error: 'legacy_calendar_forbidden_in_history' } })
    if (url.pathname.endsWith('/discovery/ranked')) {
      requests.push(url)
      const sort = url.searchParams.get('sort')!
      const creators = sort === 'volume' ? ['fixturealpha', 'fixturebeta'] : ['fixturebeta', 'fixturealpha']
      const items = creators.map((login, index) => ({ id: `dm_${(index + 1).toString().padStart(32, '0')}`, login, streamId: login === 'fixturealpha' ? '910001' : '910002', offsetSeconds: 60,
        at: Date.parse(targetDay + 'T10:00:00Z'), label: `${login} reaction`, category: 'Games', categorySource: 'measured_segment',
        chatPerMin: login === 'fixturealpha' ? 200 : 100, emotesPerMin: 50, source: 'stored_irc', revision: 1, rank: index + 1,
        score: sort === 'volume' ? 200 - index * 100 : 2 - index, rankingVersion: 'synthetic-v1', scoreExplanation: 'Synthetic test score', categoryMissing: false }))
      return route.fulfill({ json: { schemaVersion: 1, state: 'ready', scope: 'indexed_completed_public_irc_streams', from: url.searchParams.get('from'), to: url.searchParams.get('to'), login: '', category: null, categoryMissing: false, sort,
        asOf, rankingVersion: 'synthetic-v1', indexedRetentionStart: recentStart, indexedRetentionAttestedAt: asOf,
        certifiedThroughExclusive: today, certificateGeneration: 1,
        facets: [{ category: 'Games', categoryMissing: false, count: items.length, artwork: null }], items, nextCursor: null,
        coverage: { state: 'partial', scope: 'time_and_creator_completed_broadcasts_only', indexedStreams: 2, measuredMinutes: 60 },
        eligibility: { scope: 'time_creator_category_before_pagination', totalDetections: items.length, rankedDetections: items.length, excludedDetections: 0 },
        freshness: 'ready', projectionUpdatedAt: null, dataThrough: null } })
    }
    return route.fulfill({ json: {} })
  })
  await page.goto('/analytics/moments?view=history&creator=xqc')
  await expect(page.getByRole('heading', { name: 'Global moments', exact: true })).toBeVisible()
  await expect(page).not.toHaveURL(/creator=/)
  const day = page.getByRole('button', { name: new RegExp(`^${targetDay}:`) })
  await expect(day).toBeVisible()
  expect(calendarRequests.length).toBeGreaterThan(0)
  expect(calendarRequests.every(url => url.pathname.endsWith('/ranked/availability'))).toBe(true)
  await expect(page.locator('.moments-result').first()).toContainText('fixturealpha')
  const filterSummary = page.locator('.moments-history__filters summary')
  await filterSummary.focus()
  await filterSummary.press('Enter')
  await expect(page.locator('.moments-history__filters')).toHaveAttribute('open', '')
  await expect.poll(() => requests.some(url => url.searchParams.get('from') === recentStart && url.searchParams.get('sort') === 'volume' && !url.searchParams.has('login'))).toBe(true)
  await day.focus()
  await day.press('ArrowLeft')
  await expect(page.getByRole('button', { name: new RegExp(`^${priorWeek}:`) })).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(day).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(day).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('region', { name: 'Recent activity overview', exact: true })).toBeVisible()
  await expect.poll(() => requests.some(url => url.searchParams.get('from') === targetDay && url.searchParams.get('to') === targetEnd)).toBe(true)
  await expect(page.getByRole('button', { name: 'Top Relative Moments', exact: true })).toHaveCount(0)
  await expect.poll(() => requests.at(-1)?.searchParams.get('sort')).toBe('volume')
  await expect(page.locator('.moments-result').first()).toContainText('fixturealpha')
  await page.getByRole('button', { name: 'Clear day selection' }).click()
  await expect.poll(() => requests.at(-1)?.searchParams.get('from')).toBe(recentStart)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: `artifacts/global-history-${width}.png`, fullPage: true })
})

test('History distinguishes missing indexed measurement from zero moments', async ({ page }) => {
  const asOf = new Date().toISOString()
  await page.route('**/v1/**', route => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/discovery/ranked/availability')) {
      return route.fulfill({ json: availability(asOf, () => false, url.searchParams.get('login') || '') })
    }
    if (url.pathname.endsWith('/discovery/ranked')) {
      return route.fulfill({ json: { schemaVersion: 1, state: 'ready', scope: 'indexed_completed_public_irc_streams', from: url.searchParams.get('from'), to: url.searchParams.get('to'), login: '', category: null, categoryMissing: false, sort: 'volume',
        asOf, rankingVersion: 'volume-observed-irc-v1', indexedRetentionStart: new Date(Date.parse(new Date().toISOString().slice(0, 10)) - 30 * 86400000).toISOString().slice(0, 10), indexedRetentionAttestedAt: asOf,
        certifiedThroughExclusive: asOf.slice(0, 10), certificateGeneration: 1, facets: [], items: [], nextCursor: null,
        coverage: { state: 'none', scope: 'time_and_creator_completed_broadcasts_only', indexedStreams: 0, measuredMinutes: 0 },
        eligibility: { scope: 'time_creator_category_before_pagination', totalDetections: 0, rankedDetections: 0, excludedDetections: 0 },
        freshness: 'ready', projectionUpdatedAt: null, dataThrough: null } })
    }
    return route.fulfill({ json: {} })
  })
  await page.goto('/analytics/moments?view=history')
  await expect(page.getByRole('region', { name: 'Recent activity overview' })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'No indexed measurement in this selection. This does not mean no moments occurred.' })).toBeVisible()
  await expect(page.locator('.moments-result')).toHaveCount(0)
})
