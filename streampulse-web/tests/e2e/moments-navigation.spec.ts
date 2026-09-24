import { test, expect } from '@playwright/test'
import { installDiscoveryFixture } from './helpers/discoveryFixture'
import { installHubUxMock } from './helpers/hubUxMock'
import { installNewsroomMock } from './helpers/newsroomMock'

function rankedHistoryResponse(url: URL) {
  const from = url.searchParams.get('from')!
  const to = url.searchParams.get('to')!
  const sort = 'volume'
  const base = Date.parse('2026-09-03T10:00:00Z')
  const logins = ['fixturealpha', 'fixturebeta']
  const items = logins.map((login, index) => ({
    id: `dm_${(index + 1).toString(16).padStart(32, '0')}`,
    login,
    streamId: login === 'fixturealpha' ? '910001' : '910002',
    offsetSeconds: 60,
    at: base,
    label: `${login} reaction`,
    category: 'Games',
    categorySource: 'measured_segment',
    chatPerMin: login === 'fixturealpha' ? 200 : 100,
    emotesPerMin: 50,
    source: 'stored_irc',
    revision: 1,
    rank: index + 1,
    score: sort === 'volume' ? 200 - index * 100 : 2 - index,
    rankingVersion: 'synthetic-v1',
    scoreExplanation: 'Synthetic test score',
    categoryMissing: false,
  }))
  return {
    schemaVersion: 1,
    state: 'ready',
    scope: 'indexed_completed_public_irc_streams',
    from,
    to,
    login: '',
    category: null,
    categoryMissing: false,
    sort,
    asOf: '2026-09-16T12:00:00Z',
    rankingVersion: 'synthetic-v1',
    facets: [{ category: 'Games', categoryMissing: false, count: 2, artwork: null }],
    items,
    nextCursor: null,
    coverage: { state: 'partial', scope: 'time_and_creator_completed_broadcasts_only', indexedStreams: 2, measuredMinutes: 60 },
    eligibility: { scope: 'time_creator_category_before_pagination', totalDetections: 2, rankedDetections: 2, excludedDetections: 0 },
    freshness: 'ready',
    indexedRetentionStart: '2026-08-17',
    indexedRetentionAttestedAt: '2026-09-16T11:59:00Z',
    certifiedThroughExclusive: '2026-09-16',
    certificateGeneration: 1,
    projectionUpdatedAt: null,
    dataThrough: null,
  }
}

for (const width of [390, 1440]) test(`History recent overview and ranking navigation at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  await page.clock.setFixedTime(new Date('2026-09-16T12:00:00Z'))
  await installDiscoveryFixture(page)
  const legacyCalendarRequests: URL[] = []
  await page.route(/\/v1\/public\/discovery(?:\?.*)?$/, route => {
    legacyCalendarRequests.push(new URL(route.request().url()))
    return route.fulfill({ status: 500, json: { error: 'Legacy calendar is not a certification source' } })
  })
  const availabilityRequests: URL[] = []
  await page.route(/\/v1\/public\/discovery\/ranked\/availability(?:\?.*)?$/, route => {
    const url = new URL(route.request().url())
    availabilityRequests.push(url)
    const first = Date.parse('2026-08-17T00:00:00Z')
    return route.fulfill({ json: {
      schemaVersion: 1, state: 'ready', scope: 'indexed_completed_public_irc_streams', login: url.searchParams.get('login') || '',
      asOf: '2026-09-16T12:00:00Z', serverToday: '2026-09-16', certifiedFrom: '2026-08-17',
      certifiedThroughExclusive: '2026-09-16', verifiedAt: '2026-09-16T11:59:00Z', certificateGeneration: 1,
      days: Array.from({ length: 30 }, (_, index) => {
        const day = new Date(first + index * 86400000).toISOString().slice(0, 10)
        const measured = day === '2026-09-03'
        return { day, state: measured ? 'measured' : 'no_measurement', coverage: measured ? 'partial' : 'none',
          streams: measured ? 2 : 0, measuredStreamMinutes: measured ? 60 : 0,
          chatMessages: measured ? 300 : null, emoteUses: measured ? 100 : null, detections: measured ? 2 : null }
      }),
    } })
  })
  const rankedRequests: URL[] = []
  await page.route(/\/v1\/public\/discovery\/ranked(?:\?.*)?$/, route => {
    const url = new URL(route.request().url())
    rankedRequests.push(url)
    return route.fulfill({ json: rankedHistoryResponse(url) })
  })
  await page.goto('/analytics/moments?view=history&year=2026')
  await expect(page.getByRole('tab', { name: 'History', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('heading', { name: 'Global moments', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Recent activity overview', exact: true })).toBeVisible()
  await expect(page.locator('.moments-result').first()).toContainText('fixturealpha')
  // The certificate fixes the exact 30 completed UTC days for calendar and ranking.
  await page.waitForTimeout(200)
  expect(availabilityRequests.length).toBeGreaterThan(0)
  expect(rankedRequests.length).toBeGreaterThan(0)
  expect(new Set(rankedRequests.map(url => url.searchParams.get('from')))).toEqual(new Set(['2026-08-17']))
  expect(new Set(rankedRequests.map(url => url.searchParams.get('to')))).toEqual(new Set(['2026-09-16']))
  expect(new Set(rankedRequests.map(url => url.searchParams.get('sort')))).toEqual(new Set(['volume']))
  expect(legacyCalendarRequests).toHaveLength(0)
  await expect(page.locator('.moments-result').first().locator('time')).toBeVisible()
  await expect(page.locator('.moments-result').first().locator('.moments-result-timing')).toContainText('UTC')
  await expect(page.locator('.moments-result').first().locator('.moments-result-timing')).toContainText('into broadcast')
  const day = page.getByRole('button', { name: /^2026-09-03:/ })
  await expect(day).toBeVisible()
  await day.click()
  await expect(day).toHaveAttribute('aria-pressed', 'true')
  await expect(page).toHaveURL(/day=2026-09-03/)
  await expect.poll(() => rankedRequests.at(-1)?.searchParams.get('from')).toBe('2026-09-03')
  expect(rankedRequests.at(-1)?.searchParams.get('to')).toBe('2026-09-04')
  await expect(page.locator('.moments-result').first()).toContainText('fixturealpha')
  await expect(page.getByRole('button', { name: 'Top Relative Moments', exact: true })).toHaveCount(0)
  await expect(page.locator('.moments-result').first()).toContainText('fixturealpha')
  await page.getByRole('button', { name: 'Clear day selection' }).click()
  await expect(page).not.toHaveURL(/day=/)
  await expect.poll(() => rankedRequests.at(-1)?.searchParams.get('from')).toBe('2026-08-17')
  expect(legacyCalendarRequests).toHaveLength(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: `artifacts/moments-history-${width}.png`, fullPage: true })
})

test('Latest has one category filter, opaque menus and a working Saved shortlist', async ({ page }) => {
  await page.route('**/v1/**', route => route.fulfill({ json: {} }))
  await installHubUxMock(page)
  await page.goto('/analytics/moments?view=recent')
  await expect(page.getByRole('button', { name: 'Sessions', exact: true })).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: 'Occurrence window' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Browse categories' })).toHaveCount(0)
  await page.getByRole('combobox', { name: 'Category', exact: true }).click()
  const menu = page.getByRole('listbox', { name: 'Category' })
  await expect(menu).toHaveCSS('background-color', 'rgb(24, 24, 27)')
  await page.screenshot({ path: 'artifacts/moments-menu.png' })
  await page.keyboard.press('Escape')
  await page.locator('.moments-result').first().locator('.moments-result-evidence').click()
  const selected = page.getByRole('region', { name: 'Selected moment', exact: true })
  await expect(selected).toBeVisible()
  await expect(selected.locator('time')).toHaveAttribute('dateTime', /Z$/)
  await expect(selected.locator('time')).toContainText('UTC')
  await page.getByRole('button', { name: '← Back to results', exact: true }).click()
  await page.locator('.moments-result').first().getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Selected moment', exact: true })).toHaveCount(0)
  await page.getByRole('tab', { name: 'Saved (1)', exact: true }).click()
  await expect(page.locator('.moments-result')).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Saved moments', exact: true })).toBeVisible()
  await expect(page.locator('.moments-result').getByRole('link', { name: /View stream timeline/ })).toHaveAttribute('href', /returnTo=.*view%3Dsaved/)
})

test('tab switches retain each view’s filters and keep the tab row steady', async ({ page }) => {
  await page.route('**/v1/**', route => route.fulfill({ json: {} }))
  await installHubUxMock(page)
  await page.goto('/analytics/moments?view=recent&q=xqc&category=Minecraft&sort=oldest')
  await expect(page.locator('.moments-result')).toHaveCount(1)
  await page.locator('.moments-result').getByRole('button', { name: 'Save', exact: true }).click()
  const tabs = page.getByRole('navigation', { name: 'Moment views' })
  const initialTop = await tabs.evaluate(element => element.getBoundingClientRect().top)

  await page.getByRole('tab', { name: 'Saved (1)', exact: true }).click()
  await expect(page.locator('.moments-result')).toHaveCount(1)
  await expect(page).toHaveURL(/view=saved&q=xqc&category=Minecraft&sort=oldest/)
  await expect(page.getByRole('searchbox', { name: 'Find loaded moments' })).toHaveValue('xqc')
  await expect(page.getByRole('combobox', { name: 'Sort loaded results' })).toHaveText('Oldest first')

  await page.getByRole('tab', { name: 'History', exact: true }).click()
  await expect(page).toHaveURL(/view=history/)
  expect(Math.abs(await tabs.evaluate(element => element.getBoundingClientRect().top) - initialTop)).toBeLessThan(1)
  await page.getByRole('tab', { name: 'Saved (1)', exact: true }).click()
  await expect(page).toHaveURL(/view=saved&q=xqc&category=Minecraft&sort=oldest/)
})

test('Moment view tabs support roving keyboard focus and expose the selected panel', async ({ page }) => {
  await installHubUxMock(page)
  await page.goto('/analytics/moments?view=recent')
  const tabs = page.getByRole('tablist', { name: 'Moment views' })
  await expect(tabs.getByRole('tab')).toHaveCount(4)
  await expect(page.getByRole('contentinfo', { name: 'Site information' })).toBeVisible()
  const latest = tabs.getByRole('tab', { name: 'Latest' })
  await expect(latest).toHaveAttribute('aria-selected', 'true')
  await expect(latest).toHaveAttribute('tabindex', '0')
  await expect(tabs.getByRole('tab', { name: 'History' })).toHaveAttribute('tabindex', '-1')
  await latest.focus()
  await latest.press('ArrowRight')
  const history = tabs.getByRole('tab', { name: 'History' })
  await expect(history).toBeFocused()
  await expect(history).toHaveAttribute('aria-selected', 'true')
  await expect(page).toHaveURL(/view=history/)
  await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'moments-view-tab-history')
  await history.press('End')
  const saved = tabs.getByRole('tab', { name: /^Saved/ })
  await expect(saved).toBeFocused()
  await expect(saved).toHaveAttribute('aria-selected', 'true')
  await saved.press('Home')
  const explore = tabs.getByRole('tab', { name: 'Explore' })
  await expect(explore).toBeFocused()
  await expect(explore).toHaveAttribute('aria-selected', 'true')
  await explore.press('ArrowLeft')
  await expect(saved).toBeFocused()
})

test('saving a Moment keeps the control under the pointer', async ({ page }) => {
  await installHubUxMock(page)
  await page.goto('/analytics/moments?view=recent')
  const row = page.locator('.moments-result').first()
  const save = row.getByRole('button', { name: 'Save', exact: true })
  const before = await save.boundingBox()
  expect(before).not.toBeNull()
  const originalCenter = { x: before!.x + before!.width / 2, y: before!.y + before!.height / 2 }
  await save.click()
  const saved = row.getByRole('button', { name: 'Saved', exact: true })
  await expect(saved).toHaveAttribute('aria-pressed', 'true')
  const after = await saved.boundingBox()
  expect(Math.abs(after!.x - before!.x)).toBeLessThan(12)
  await page.mouse.click(originalCenter.x, originalCenter.y)
  await expect(row.getByRole('button', { name: 'Save', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('region', { name: 'Selected moment', exact: true })).toHaveCount(0)
})

test('legacy session links resolve the authoritative broadcast and keep exact offsets', async ({ page }) => {
  await page.route('**/v1/**', route => route.fulfill({ json: {} }))
  await installNewsroomMock(page)
  await page.goto('/analytics/moments?view=sessions&story=story-xqc&login=xqc&stream=s1&offset=120')
  await expect(page).toHaveURL(/\/analytics\/xqc\/s1\?returnTo=.*#t=120$/)
  await expect(page.getByRole('navigation', { name: 'Broadcast navigation' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Broadcast navigation' }).getByRole('link', { name: 'Pulse Explorer' }))
    .toHaveAttribute('href', '/analytics/explore/story-xqc')
  await page.goto('/analytics/moments?view=sessions&story=missing')
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
  await expect(page).toHaveURL(/story=missing$/)
})

test('history failure preserves creator scope and offers latest recovery', async ({ page }) => {
  await page.route('**/v1/**', route => route.fulfill({ status: 503, json: { error: 'discovery_unavailable' } }))
  await page.goto('/analytics/moments?view=history&scope=creator&creator=forsen&year=2026')
  await expect(page.getByRole('heading', { name: 'History unavailable' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '@forsen' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'History', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page).toHaveURL(/scope=creator&creator=forsen/)
  await expect(page.getByRole('region', { name: 'Recent activity overview' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Browse Latest moments', exact: true })).toHaveAttribute('href', '/analytics/moments?view=recent')
})
