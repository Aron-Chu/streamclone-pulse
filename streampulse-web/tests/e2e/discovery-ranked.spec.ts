import { test, expect, type Page } from '@playwright/test'

async function settledCapture(page: Page, path: string) {
  await expect(page.getByRole('region', { name: 'Moment results', exact: true, includeHidden: true })).toHaveAttribute('aria-busy', 'false')
  await expect.poll(() => page.locator('.moments-result').evaluateAll(rows => rows.every(row => {
    const style = getComputedStyle(row)
    return Number(style.opacity) === 1 && row.getAnimations().every(animation => animation.playState === 'finished' || animation.playState === 'idle')
  }))).toBe(true)
  await page.screenshot({ path, fullPage: false })
}

async function fixture(page: Page, rankedTotal = 52) {
  await page.clock.setFixedTime(new Date('2026-09-14T12:00:00Z'))
  const requests: URL[] = [], mutations: string[] = []
  const state = { unavailable: false, changed: false, fresh: false, malformed: false, playable: false }
  await page.route('**/v1/**', async route => {
    const request = route.request(), url = new URL(request.url())
    if (request.method() !== 'GET') mutations.push(url.pathname)
    if (url.pathname === '/v1/public/discovery/ranked/availability') {
      if (state.unavailable) return route.fulfill({ status: 503, json: { error: 'discovery_unavailable' } })
      const first = Date.parse('2026-08-15')
      return route.fulfill({ json: { schemaVersion: 1, state: 'ready', scope: 'indexed_completed_public_irc_streams',
        login: url.searchParams.get('login') || '', asOf: '2026-09-14T12:00:00Z', serverToday: '2026-09-14',
        certifiedFrom: '2026-08-14', certifiedThroughExclusive: '2026-09-14', verifiedAt: '2026-09-14T11:59:00Z', certificateGeneration: 1,
        days: Array.from({ length: 30 }, (_, i) => ({ day: new Date(first + i * 86400000).toISOString().slice(0, 10),
          state: 'no_measurement', coverage: 'none', streams: 0, measuredStreamMinutes: 0,
          chatMessages: null, emoteUses: null, detections: null })) } })
    }
    if (url.pathname !== '/v1/public/discovery/ranked') {
      if (url.pathname === '/v1/portal/analytics/streams/stream1') return route.fulfill({ json: {
        channel: 'creator', stream: { streamId: 'stream1', login: 'creator', ...(state.playable ? { vodId: '123456' } : {}) }, availability: { vodState: state.playable ? 'available' : 'unavailable' },
        ...(state.playable ? { vodTiming: { state: 'verified' }, vodAlignSeconds: 0, vodDurationSeconds: 18000 } : {}),
      } })
      return route.fulfill({ json: {} })
    }
    requests.push(url)
    if (state.unavailable) return route.fulfill({ status: 503, json: { error: 'discovery_unavailable' } })
    if (state.changed && url.searchParams.has('cursor')) return route.fulfill({ status: 400, json: { error: 'discovery_cursor_changed' } })
    const q = url.searchParams, categoryMissing = q.get('categoryMissing') === 'true', category = categoryMissing ? 'Unknown' : q.get('category')
    const start = q.get('cursor') === 'signed-fixture-cursor-2' ? 101 : q.has('cursor') ? 51 : 1
    const count = category || state.fresh ? 0 : Math.min(50, Math.max(0, rankedTotal - start + 1))
    const from = q.get('from')!, to = q.get('to')!
    const at = Math.min(Date.parse(from) + 3600000, Date.parse('2026-09-13T11:00:00Z'))
    return route.fulfill({ json: { schemaVersion: 1, state: 'ready', scope: 'indexed_completed_public_irc_streams', from, to,
      login: q.get('login') || undefined, category, categoryMissing, sort: 'volume', asOf: state.fresh ? '2026-09-14T12:01:00Z' : '2026-09-14T12:00:00Z',
      rankingVersion: 'synthetic-only-v1', facets: [
        { category: 'Just Chatting', categoryMissing: false, count: state.fresh ? 0 : rankedTotal, artwork: null },
        { category: 'Minecraft', categoryMissing: false, count: 0, artwork: null },
        { category: 'Unknown', categoryMissing: false, count: 0, artwork: null },
        { category: 'Unknown', categoryMissing: true, count: 0, artwork: null },
      ], items: Array.from({ length: count }, (_, i) => ({ id: `dm_${(start + i).toString(16).padStart(32, '0')}`, login: q.get('login') || 'creator', displayName: 'Creator', streamId: 'stream1',
        offsetSeconds: (start + i) * 60, at, label: `Measured reaction ${start + i}`, category: 'Just Chatting', categorySource: 'measured_segment', categoryMissing: false,
        chatPerMin: 200 - start - i, emotesPerMin: 30, source: 'stored_irc', revision: 1, rank: start + i, score: state.malformed ? null : 200 - start - i,
        rankingVersion: 'synthetic-only-v1', scoreExplanation: 'Observed IRC chat/min', topEmotes: [{ name: 'Kappa', count: 3, provider: 'twitch' }] })),
      nextCursor: count === 50 && start + count - 1 < rankedTotal ? `signed-fixture-cursor-${Math.ceil(start / 50)}` : null,
      coverage: { state: 'partial', scope: 'time_and_creator_completed_broadcasts_only', indexedStreams: 4, measuredMinutes: 240 },
      eligibility: { scope: 'time_creator_category_before_pagination', totalDetections: category ? 2 : state.fresh ? 8 : rankedTotal + 8,
        rankedDetections: category || state.fresh ? 0 : rankedTotal, excludedDetections: category ? 2 : 8 },
      freshness: 'ready', indexedRetentionStart: '2026-08-14', indexedRetentionAttestedAt: '2026-09-14T11:59:00Z', certifiedThroughExclusive: '2026-09-14', certificateGeneration: 1,
      projectionUpdatedAt: '2026-09-13T11:00:00Z', dataThrough: new Date(Math.min(Date.parse(to), Date.parse('2026-09-13T11:00:00Z'))).toISOString(),
    } })
  })
  return { requests, mutations, state }
}

test('ranked Explore reaches the 101st result through a third page', async ({ page }) => {
  const { requests, mutations } = await fixture(page, 101)
  await page.goto('/analytics/moments?view=explore')
  await expect(page.locator('.moments-result')).toHaveCount(50)
  await page.getByRole('button', { name: 'Load more moments (50)' }).click()
  await expect(page.locator('.moments-result')).toHaveCount(100)
  await page.getByRole('button', { name: 'Load more moments (50)' }).click()
  await expect(page.locator('.moments-result')).toHaveCount(101)
  await expect(page.locator('.moments-result').last()).toHaveAttribute('data-detection-id', `dm_${(101).toString(16).padStart(32, '0')}`)
  await expect(page.locator('.moments-result-rank').last()).toHaveText('#101')
  await expect(page.getByRole('button', { name: 'Load more moments (50)' })).toHaveCount(0)
  expect(requests.some(url => url.searchParams.get('cursor') === 'signed-fixture-cursor-1')).toBe(true)
  expect(requests.some(url => url.searchParams.get('cursor') === 'signed-fixture-cursor-2')).toBe(true)
  expect(mutations).toEqual([])
})

for (const width of [390, 768, 1440]) test(`ranked Explore filters, review, snapshots and Saved at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  await page.addInitScript(() => {
    const original = Element.prototype.animate
    const probe: number[] = []
    ;(window as unknown as { exploreArrivalOpacity: number[] }).exploreArrivalOpacity = probe
    Element.prototype.animate = function (...args) {
      const animation = original.apply(this, args)
      if (this.hasAttribute('data-arrival-key')) {
        animation.pause()
        animation.currentTime = 0
        probe.push(Number(getComputedStyle(this).opacity))
        animation.play()
      }
      return animation
    }
  })
  const { requests, mutations, state } = await fixture(page)
  await page.goto('/analytics/moments?view=explore')
  await expect(page.getByRole('tab', { name: 'Explore', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.moments-result')).toHaveCount(50)
  const arrivalOpacity = await page.evaluate(() => (window as unknown as { exploreArrivalOpacity: number[] }).exploreArrivalOpacity)
  expect(arrivalOpacity.length).toBeGreaterThan(0)
  expect(arrivalOpacity.every(opacity => opacity === 1)).toBe(true)
  expect(requests[0].searchParams.get('from')).toBe('2026-09-13')
  expect(requests[0].searchParams.get('to')).toBe('2026-09-14')
  expect(requests[0].searchParams.get('sort')).toBe('volume')
  expect(requests[0].searchParams.get('limit')).toBe('50')
  await expect(page.getByRole('button', { name: /Minecraft.*0 ranked moments/ })).toBeVisible()
  await expect(page.getByLabel('Selection eligibility')).toContainText('60 matching detections · 50 of 52 ranked loaded')
  await expect(page.getByLabel('Selection eligibility')).toContainText('8 excluded from volume ranking')
  await settledCapture(page, `artifacts/ranked-explore-${width}.png`)
  await page.locator('.moments-result').first().scrollIntoViewIfNeeded()
  await settledCapture(page, `artifacts/ranked-rows-${width}.png`)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Load more moments (50)' }).click()
  await expect(page.locator('.moments-result')).toHaveCount(52)
  await expect(page.getByLabel('Selection eligibility')).toContainText('60 matching detections · 52 of 52 ranked loaded')
  const beforeReview = requests.length
  expect(await page.locator('.moments-result-rank').allTextContents()).toEqual(Array.from({ length: 52 }, (_, i) => `#${i + 1}`))
  expect(await page.locator('.moments-result').evaluateAll(rows => rows.map(row => row.getAttribute('data-detection-id'))))
    .toEqual(Array.from({ length: 52 }, (_, i) => `dm_${(i + 1).toString(16).padStart(32, '0')}`))
  const savedKey = await page.locator('.moments-result .moments-card-primary').first().getAttribute('data-discovery-key')
  expect(savedKey).toBeTruthy()
  await page.locator('.moments-result').first().getByRole('button', { name: 'Save', exact: true }).click()
  await page.locator('.moments-card-primary').first().click()
  await expect(page.getByRole('region', { name: 'Selected moment', exact: true })).toBeVisible()
  await expect(page.getByText('Replay unavailable', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /Prepare clip in ReplayForge/ })).toHaveCount(0)
  await settledCapture(page, `artifacts/ranked-review-${width}.png`)
  await page.getByRole('button', { name: 'Next moment', exact: true }).click()
  await expect(page).toHaveURL(/offset=120/)
  expect(requests).toHaveLength(beforeReview)
  await page.getByRole('button', { name: '← Back to results', exact: true }).click()
  await page.getByRole('tab', { name: 'Saved (1)', exact: true }).click()
  await expect(page.locator('.moments-result')).toHaveCount(1)
  await expect(page.locator('.moments-result .moments-card-primary')).toHaveAttribute('data-discovery-key', savedKey!)
  await page.reload()
  await expect(page.getByRole('tab', { name: 'Saved (1)', exact: true })).toBeVisible()
  await expect(page.locator('.moments-result .moments-card-primary')).toHaveAttribute('data-discovery-key', savedKey!)
  await page.getByRole('tab', { name: 'Explore', exact: true }).click()
  await expect(page.locator('.moments-result')).toHaveCount(50)
  state.changed = true
  await page.getByRole('button', { name: 'Load more moments (50)' }).click()
  await expect(page.getByText(/Continuation failed/)).toBeVisible()
  await expect(page.locator('.moments-result')).toHaveCount(50)
  await expect(page.getByText(/Previous snapshot retained/)).toBeVisible()
  await expect(page.getByLabel('Selection eligibility')).toContainText('60 matching detections · 50 of 52 ranked loaded')
  state.fresh = true
  await page.getByRole('button', { name: 'Reload collection', exact: true }).click()
  await expect(page.locator('.moments-result')).toHaveCount(0)
  await expect(page.getByLabel('Selection eligibility')).toContainText('8 matching detections · 0 of 0 ranked loaded')
  await expect(page.getByText('Stored detections exist here, but none qualify for observed IRC volume ranking. Try another date or creator.')).toBeVisible()
  await page.getByRole('button', { name: /Minecraft.*0 ranked moments/ }).click()
  await expect(page).toHaveURL(/category=Minecraft/)
  await expect(page.getByRole('button', { name: 'Reset Explore' })).toBeVisible()
  await page.getByRole('button', { name: /Unknown \(category unavailable\)/ }).click()
  await expect.poll(() => requests.at(-1)?.searchParams.get('categoryMissing')).toBe('true')
  expect(requests.at(-1)?.searchParams.has('category')).toBe(false)
  await page.getByRole('button', { name: 'Reset Explore' }).click()
  await page.getByRole('combobox', { name: 'Period', exact: true }).click()
  await page.getByRole('option', { name: 'Up to 7 sealed days', exact: true }).click()
  await expect.poll(() => requests.at(-1)?.searchParams.get('from')).toBe('2026-09-07')
  await page.getByRole('combobox', { name: 'Period', exact: true }).click()
  await page.getByRole('option', { name: 'Latest sealed day', exact: true }).click()
  await expect.poll(() => requests.at(-1)?.searchParams.get('from')).toBe('2026-09-13')
  await page.getByRole('combobox', { name: 'Period', exact: true }).click()
  await page.getByRole('option', { name: 'Custom range', exact: true }).click()
  await page.getByLabel('From (UTC)', { exact: true }).fill('2026-08-15')
  await expect.poll(() => requests.at(-1)?.searchParams.get('from')).toBe('2026-08-15')
  expect(requests.at(-1)?.searchParams.get('to')).toBe('2026-09-14')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(mutations).toEqual([])
})

test('ranked unavailable and malformed responses never announce healthy empty', async ({ page }) => {
  const { state } = await fixture(page)
  state.unavailable = true
  await page.goto('/analytics/moments?view=explore')
  await expect(page.getByRole('heading', { name: 'Ranked moments unavailable' })).toBeVisible()
  await expect(page.getByText(/No ranked moments in/)).toHaveCount(0)
  state.unavailable = false; state.malformed = true
  await page.getByRole('button', { name: 'Reload collection' }).click()
  await expect(page.getByRole('heading', { name: 'Ranked moments unavailable' })).toBeVisible()
  await expect(page.locator('.moments-result')).toHaveCount(0)
  await expect(page.getByText(/No ranked moments in/)).toHaveCount(0)
})

for (const width of [390, 768, 1440]) test(`ranked exact playback and deep-link range at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  const { state, requests, mutations } = await fixture(page)
  state.playable = true
  await page.route('https://player.twitch.tv/**', route => route.fulfill({ contentType: 'text/html', body: '<p>Exact player fixture</p>' }))
  await page.goto('/analytics/moments?view=explore&period=custom&from=2026-08-15&to=2026-09-13&sort=volume&creator=creator')
  await expect(page.locator('.moments-result')).toHaveCount(50)
  expect(requests.at(-1)?.searchParams.get('from')).toBe('2026-08-15')
  expect(requests.at(-1)?.searchParams.get('to')).toBe('2026-09-14')
  await page.locator('.moments-card-primary').first().click()
  await expect(page.getByRole('link', { name: /^Open VOD at/ })).toHaveAttribute('href', 'https://www.twitch.tv/videos/123456?t=60s')
  if (width > 640) {
    await expect(page.getByRole('button', { name: /Load Twitch preview/ })).toBeVisible()
    await expect(page.locator('iframe[title="Selected moment Twitch VOD preview"]')).toHaveCount(0)
    await page.getByRole('button', { name: /Load Twitch preview/ }).click()
    await expect(page.getByTitle('Selected moment Twitch VOD preview')).toHaveAttribute('src', /video=v123456&time=60s/)
    await expect(page.frameLocator('iframe[title="Selected moment Twitch VOD preview"]').getByText('Exact player fixture')).toBeVisible()
  } else await expect(page.getByRole('link', { name: 'Watch on Twitch at 1:00' })).toBeVisible()
  const selectedUrl = page.url()
  await page.reload()
  await expect(page).toHaveURL(selectedUrl)
  await expect(page.getByRole('link', { name: /^Open VOD at/ })).toHaveAttribute('href', 'https://www.twitch.tv/videos/123456?t=60s')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await settledCapture(page, `artifacts/ranked-player-${width}.png`)
  expect(mutations).toEqual([])
})

test('invalid custom range makes no ranked read and reset recovers; named Unknown remains exact', async ({ page }) => {
  const { requests } = await fixture(page)
  await page.goto('/analytics/moments?view=explore&period=custom&from=2026-08-13&to=2026-09-13')
  await expect(page.getByText(/Choose 1 to 30 inclusive certified UTC days/)).toBeVisible()
  expect(requests).toHaveLength(0) // Availability never issues a ranked collection read.
  await page.getByRole('button', { name: 'Reset Explore' }).click()
  await expect(page.locator('.moments-result')).toHaveCount(50)
  await page.getByRole('button', { name: 'Unknown 0 ranked moments', exact: true }).click()
  await expect.poll(() => requests.at(-1)?.searchParams.get('category')).toBe('Unknown')
  expect(requests.at(-1)?.searchParams.has('categoryMissing')).toBe(false)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Unknown 0 ranked moments', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('Stored detections exist here, but none qualify for observed IRC volume ranking. Try another date or creator.')).toBeVisible()
})
