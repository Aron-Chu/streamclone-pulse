import { expect, test, type Page } from '@playwright/test'

const DAY = 86_400_000
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

interface HistoryFixtureOptions {
  measured?: boolean
  detections?: number
  unavailable?: boolean
}

async function installRecentHistory(page: Page, options: HistoryFixtureOptions = {}) {
  const today = utcDay(Date.now())
  const todayMs = Date.parse(today)
  const firstDay = utcDay(todayMs - 30 * DAY)
  const eventDay = utcDay(todayMs - DAY)
  const asOf = new Date().toISOString()
  const measured = options.measured !== false
  const detections = measured ? options.detections ?? 2 : 0
  const requests: URL[] = []

  await page.route('**/v1/**', route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/v1/public/discovery/ranked/availability') {
      if (options.unavailable) return route.fulfill({ status: 503, json: { error: 'discovery_unavailable' } })
      return route.fulfill({ json: { schemaVersion: 1, state: 'ready', scope: 'indexed_completed_public_irc_streams',
        login: url.searchParams.get('login') || '', asOf, serverToday: today,
        certifiedFrom: firstDay, certifiedThroughExclusive: today, verifiedAt: asOf, certificateGeneration: 1,
        days: Array.from({ length: 30 }, (_, i) => {
          const day = utcDay(todayMs - 30 * DAY + i * DAY)
          const isMeasured = measured && day === eventDay
          return { day, state: isMeasured ? 'measured' : 'no_measurement', coverage: isMeasured ? 'partial' : 'none',
            streams: isMeasured ? 1 : 0, measuredStreamMinutes: isMeasured ? 60 : 0,
            chatMessages: isMeasured ? 300 : null, emoteUses: isMeasured ? 45 : null,
            detections: isMeasured ? detections : null }
        }) } })
    }
    if (url.pathname === '/v1/public/discovery' || url.pathname === '/v1/public/discovery/activity')
      return route.fulfill({ status: 503, json: { error: 'legacy_calendar_forbidden_in_history' } })
    if (url.pathname === '/v1/public/discovery/ranked') {
      requests.push(url)
      if (options.unavailable) return route.fulfill({ status: 503, json: { error: 'discovery_unavailable' } })
      const from = url.searchParams.get('from')!
      const to = url.searchParams.get('to')!
      const login = url.searchParams.get('login') || ''
      const category = url.searchParams.get('category')
      const inRange = from <= eventDay && eventDay < to
      const count = inRange && category !== 'Other' ? detections : 0
      const items = Array.from({ length: count }, (_, i) => ({
        id: `dm_${(i + 1).toString(16).padStart(32, '0')}`,
        login: login || 'fixturealpha', displayName: login || 'Fixture Alpha', streamId: '910001',
        offsetSeconds: (i + 1) * 60, at: Date.parse(eventDay + 'T10:00:00Z') + i * DAY / 1440,
        label: 'Measured chat spike', category: 'Games', categorySource: 'measured_segment',
        chatPerMin: 200 - i * 100, emotesPerMin: 45, source: 'stored_irc', revision: 1,
        rank: i + 1, score: 200 - i * 100, rankingVersion: 'volume-observed-irc-v1',
        scoreExplanation: 'Observed IRC chat/min', categoryMissing: false,
      }))
      return route.fulfill({ json: {
        schemaVersion: 1, state: 'ready', scope: 'indexed_completed_public_irc_streams',
        from, to, login, category, categoryMissing: false, sort: 'volume', asOf,
        rankingVersion: 'volume-observed-irc-v1', items, nextCursor: null,
        facets: [
          { category: 'Games', categoryMissing: false, count, artwork: null },
          ...(category === 'Other' ? [{ category: 'Other', categoryMissing: false, count: 0, artwork: null }] : []),
        ],
        coverage: { state: measured && inRange ? 'partial' : 'none', scope: 'time_and_creator_completed_broadcasts_only',
          indexedStreams: measured && inRange ? 1 : 0, measuredMinutes: measured && inRange ? 60 : 0 },
        eligibility: { scope: 'time_creator_category_before_pagination', totalDetections: count,
          rankedDetections: count, excludedDetections: 0 },
        freshness: 'ready', indexedRetentionStart: firstDay, indexedRetentionAttestedAt: asOf,
        certifiedThroughExclusive: today, certificateGeneration: 1, projectionUpdatedAt: null, dataThrough: null,
      } })
    }
    return route.fulfill({ json: {} })
  })
  return { today, firstDay, eventDay, requests }
}

for (const width of [320, 390, 768, 1440]) {
  test(`recent History calendar selects an exact UTC day at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const { firstDay, eventDay, today, requests } = await installRecentHistory(page)
    await page.goto('/analytics/moments?view=history')
    const overview = page.getByRole('region', { name: 'Recent activity overview' })
    await expect(overview).toBeVisible()
    await expect(overview.locator('.discovery-year__grid button')).toHaveCount(30)
    await expect(page.getByRole('combobox', { name: 'Activity year' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Most active detected moments' })).toBeVisible()
    const measuredDay = overview.getByRole('button', { name: new RegExp(`^${eventDay}:`) })
    await expect(measuredDay).toBeVisible()
    const widthPx = await measuredDay.evaluate(element => element.getBoundingClientRect().width)
    expect(widthPx).toBeGreaterThanOrEqual(width <= 520 ? 40 : 32)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await measuredDay.click()
    await expect(measuredDay).toHaveAttribute('aria-pressed', 'true')
    await expect(page).toHaveURL(new RegExp(`day=${eventDay}`))
    await expect(page.locator('.moments-result')).toHaveCount(2)
    await expect.poll(() => requests.some(url =>
      url.searchParams.get('from') === eventDay && url.searchParams.get('to') === today
      && url.searchParams.get('sort') === 'volume')).toBe(true)
    await page.getByRole('button', { name: 'Clear day selection' }).click()
    await expect.poll(() => requests.some(url => url.searchParams.get('from') === firstDay)).toBe(true)
  })
}

test('old year links explain the retention boundary and recover into recent volume History', async ({ page }) => {
  const { firstDay, requests } = await installRecentHistory(page)
  const oldYear = Number(firstDay.slice(0, 4)) - 1
  await page.goto(`/analytics/moments?view=history&year=${oldYear}`)
  await expect(page.getByText(/History currently covers .* UTC. Choose a recent day/)).toBeVisible()
  expect(requests).toHaveLength(0) // Invalid filters never fetch a ranked collection.
  await page.getByRole('button', { name: 'Open recent volume history' }).click()
  await expect.poll(() => requests.some(url => url.searchParams.get('from') === firstDay && url.searchParams.get('sort') === 'volume')).toBe(true)
})

test('old creator month bookmarks keep identity and use only retained days', async ({ page }) => {
  const { today, firstDay, requests } = await installRecentHistory(page)
  const month = today.slice(0, 7)
  const from = `${month}-01` > firstDay ? `${month}-01` : firstDay
  await page.goto(`/analytics/moments?view=recent&collection=history&creator=fixturealpha&month=${month}&calendar=year`)
  await expect(page).toHaveURL(new RegExp('view=history.*creator=fixturealpha.*month='))
  await expect(page.getByRole('heading', { name: '@fixturealpha' })).toBeVisible()
  await expect(page.getByText(`Month ${month} · date filter`)).toBeVisible()
  await expect.poll(() => requests.some(url => url.searchParams.get('from') === from
    && url.searchParams.get('to') === today
    && url.searchParams.get('login') === 'fixturealpha')).toBe(true)
  expect(requests.every(url => url.searchParams.get('login') === 'fixturealpha')).toBe(true)
})

test('old creator month bookmarks outside retention explain the limit without dropping the creator', async ({ page }) => {
  const { today, requests } = await installRecentHistory(page)
  const oldMonth = utcDay(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 3, 1)).slice(0, 7)
  await page.goto(`/analytics/moments?view=recent&collection=history&creator=fixturealpha&month=${oldMonth}&calendar=year`)
  await expect(page.getByRole('heading', { name: '@fixturealpha' })).toBeVisible()
  await expect(page.getByText(/Older months are not a durable archive/)).toBeVisible()
  expect(requests).toHaveLength(0) // Invalid month never fetches a ranked collection.
})

test('unmeasured day and measured zero remain different states', async ({ page }) => {
  const { eventDay } = await installRecentHistory(page, { detections: 0 })
  await page.goto('/analytics/moments?view=history')
  const overview = page.getByRole('region', { name: 'Recent activity overview' })
  await expect(overview.getByRole('button', { name: new RegExp(`^${eventDay}:`) })).toHaveAttribute('data-state', 'measured')
  const otherDay = utcDay(Date.parse(eventDay) - DAY)
  await expect(overview.getByRole('button', { name: new RegExp(`^${otherDay}:`) })).toHaveAttribute('data-state', 'no_measurement')
  await expect(page.getByText(/No stored detections in this/)).toBeVisible()
})

test('history outage shows recovery, without turning missing data into a quiet day', async ({ page }) => {
  await installRecentHistory(page, { unavailable: true })
  await page.goto('/analytics/moments?view=history')
  await expect(page.getByRole('heading', { name: 'History unavailable' })).toBeVisible()
  await expect(page.getByText(/No indexed measurement in this selection/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Open recent volume history' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Browse Latest moments' })).toBeVisible()
})
