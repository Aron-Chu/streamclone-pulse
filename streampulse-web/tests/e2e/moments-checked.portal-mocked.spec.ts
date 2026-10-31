import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

import { assertNoConsoleErrors, assertNoPageHorizontalOverflow, attachConsoleErrorGuard } from './helpers/assertions'
import { installHubUxMock } from './helpers/hubUxMock'

/**
 * The checked Moments page (moments-r2, laid out as moments-r4 B2) on a build with
 * VITE_PUBLIC_MOMENTS_FEED=on. The default build leaves the flag off, so this
 * file skips there; run it against your own preview of a flag-on build:
 *
 *   VITE_PUBLIC_MOMENTS_FEED=on npx vite build --outDir <dir>
 *   npx vite preview --outDir <dir> --host 127.0.0.1 --port <port>
 *   PORTAL_E2E_MOCKED=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:<port> VITE_PUBLIC_MOMENTS_FEED=on \
 *     npx playwright test tests/e2e/moments-checked.portal-mocked.spec.ts
 */
test.skip(!/^(on|1)$/.test(process.env.VITE_PUBLIC_MOMENTS_FEED ?? ''), 'needs a build with VITE_PUBLIC_MOMENTS_FEED=on')

interface FeedItem {
  id: string; verdict: string; streamId: string; login: string; minuteStart: number; offsetSeconds: number; viewers?: number
  category: { id: string; name: string } | null
  spark: { chat: Array<number | null>; emotes: Array<number | null>; momentIndex: number }
  topEmotes: Array<{ name: string; imageUrl?: string; count: number }>
}
const fixture = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/moments_feed_v1.json'), 'utf8')) as { generatedAt: number; items: FeedItem[] }
// a grey square for every Twitch CDN image: no network, same sizes
// the feed pages as it does with sort=new: newest first, PAGE at a time behind a cursor, the counts for the whole window
const PAGE = 20
const newest = fixture.items.slice().sort((a, b) => b.minuteStart - a.minuteStart)
const verdicts = { ok: 0, warn: 0, bad: 0 } as Record<string, number>
for (const x of fixture.items) verdicts[x.verdict]++
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')

/**
 * 'outage': every read of the first page fails (a 503; the client's one retry gets it too) until the test calls up().
 * Every host but this preview is answered here or aborted: nothing leaves the machine.
 */
async function mockFeed(page: Page, feed: 'ok' | 'off' | 'outage' = 'ok', failPage?: number) {
  const reads: string[] = []
  const feedReads: string[] = []
  // moments asked for one at a time by id, and where each first page's window starts
  const idReads: string[] = []
  const froms: number[] = []
  let down = feed === 'outage'
  await page.route(url => !/^(127\.0\.0\.1|localhost)$/.test(url.hostname), route => route.abort())
  await page.route('**/v1/**', route => route.fulfill({ status: 503, json: { error: 'unmocked_endpoint' } }))
  await installHubUxMock(page)
  await page.route(/\/v1\/public\/discovery\/ranked\/availability(?:\?.*)?$/, route => route.fulfill({ status: 404, contentType: 'text/plain', body: '404 page not found\n' }))
  await page.route('https://static-cdn.jtvnw.net/**', route => route.fulfill({ contentType: 'image/png', body: PNG }))
  // the fixture's emotes (7TV, BTTV, FFZ and the API's own emote copies) get the same square
  await page.route(/^https:\/\/(cdn\.7tv\.app|cdn\.betterttv\.net|cdn\.frankerfacez\.com|api\.streampulse\.stream\/emotes)\//, route => route.fulfill({ contentType: 'image/png', body: PNG }))
  // the opened moment's two reads: its stream record (a VOD with verified timing) and its minutes (the feed's sparklines)
  await page.route(/\/v1\/portal\/analytics\/streams\/([^/?]+)(\/minutes)?(\?.*)?$/, route => {
    const url = new URL(route.request().url())
    reads.push(url.pathname)
    const streamId = decodeURIComponent(url.pathname.split('/')[5])
    const mine = fixture.items.filter(x => x.streamId === streamId)
    if (!mine.length) return route.fulfill({ status: 503, json: { error: 'unmocked_stream' } })
    const login = mine[0].login.toLowerCase(), startedAt = new Date(mine[0].minuteStart - mine[0].offsetSeconds * 1000).toISOString()
    if (!url.pathname.endsWith('/minutes')) {
      return route.fulfill({ json: { channel: login, vodId: '2000000001', vodAlignSeconds: 42, vodDurationSeconds: Math.max(...mine.map(x => x.offsetSeconds)) + 3600, vodTiming: { state: 'verified' },
        stream: { streamId, channel: login, startedAt, vodId: '2000000001' } } })
    }
    const rows = new Map<number, Record<string, unknown>>()
    for (const item of mine) {
      item.spark.chat.forEach((chat, j) => {
        if (chat == null) return
        const offsetSeconds = item.offsetSeconds + (j - item.spark.momentIndex) * 60
        rows.set(offsetSeconds, { offsetSeconds, chatCount: chat, totalEmoteCount: item.spark.emotes[j] ?? 0, viewerAvg: item.viewers,
          topEmotes: j === item.spark.momentIndex ? item.topEmotes : [] })
      })
    }
    return route.fulfill({ json: { streamId, channel: login, startedAt, minutes: [...rows.values()].sort((p, q) => Number(p.offsetSeconds) - Number(q.offsetSeconds)) } })
  })
  await page.route(/\/v1\/public\/moments(\?.*)?$/, route => {
    if (feed === 'off') return route.fulfill({ status: 404, contentType: 'text/plain', body: '404 page not found\n' })
    const params = new URL(route.request().url()).searchParams, id = params.get('id')
    if (id) {
      idReads.push(id)
      const item = fixture.items.find(x => x.id === id)
      return item ? route.fulfill({ json: { schemaVersion: 1, generatedAt: fixture.generatedAt, stale: false, item } }) : route.fulfill({ status: 404, json: { error: 'not_found' } })
    }
    const cursor = params.get('cursor')
    feedReads.push(cursor ?? 'first')
    if (!cursor) froms.push(Number(params.get('from')))
    if (down && !cursor) return route.fulfill({ status: 503, json: { error: 'unavailable' } })
    const from = cursor ? Number(cursor.slice(1)) : 0
    if (failPage != null && from === failPage * PAGE) return route.fulfill({ status: 503, headers: { 'retry-after': '5' }, json: { error: 'unavailable' } })
    const items = newest.slice(from, from + PAGE), next = from + PAGE < newest.length ? `c${from + PAGE}` : null
    return route.fulfill({ headers: { 'cache-control': 'public, max-age=30' }, json: { ...fixture, items, nextCursor: next, facets: { verdicts } } })
  })
  // the fixture's capture time, so "N min ago" reads as it did
  await page.clock.setFixedTime(fixture.generatedAt + 90_000)
  return Object.assign(reads, { feed: feedReads, ids: idReads, froms, up: () => { down = false } })
}
const headerBottom = (page: Page) => page.evaluate(() => document.querySelector('.analytics-topnav')!.getBoundingClientRect().bottom)

async function cls(page: Page): Promise<number> {
  return page.evaluate(() => new Promise<number>(done => {
    let total = 0
    new PerformanceObserver(list => {
      for (const e of list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) if (!e.hadRecentInput) total += e.value
    }).observe({ type: 'layout-shift', buffered: true })
    setTimeout(() => done(total), 1500)
  }))
}

const rows = (page: Page) => page.locator('.mk-list .mk-r')
/** One per stream: the stream's other moments are in its open moment (M1, 10-22). */
const streamRows = (page: Page) => page.locator('.mk-list > li.mk-g > .mk-r')
const seg = (page: Page, name: string) => page.getByRole('group', { name: 'Which moments' }).getByRole('button', { name: new RegExp(`^${name}`) })

test('wide: the latest moments, nothing open beside the list until a click', async ({ page }, testInfo) => {
  const errors = attachConsoleErrorGuard(page)
  const reads = await mockFeed(page)
  await page.goto('/analytics/moments', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { level: 1, name: 'Moments' })).toBeVisible()
  await expect(rows(page).first()).toBeVisible()
  const shift = await cls(page)
  testInfo.annotations.push({ type: 'CLS 1440', description: shift.toFixed(4) })
  expect(shift).toBeLessThan(0.1)

  const streams = new Set(fixture.items.filter(x => x.verdict !== 'bad').map(x => x.streamId)).size
  await expect(streamRows(page)).toHaveCount(streams)
  // every page of the last 24 hours (W1, 10-30), one at a time, then no more
  expect(reads.feed).toEqual(['first', 'c20'])
  expect(reads.froms).toEqual([Math.floor((fixture.generatedAt + 90_000 - 24 * 3_600_000) / 600_000) * 600_000])
  // nothing opens by itself (A1, 10-30), so nothing is read for it
  await expect(page.getByRole('complementary', { name: 'Selected moment' })).toHaveText('Pick a moment.')
  const detail = page.locator('.mk-det .mk-d')
  await expect(detail).toHaveCount(0)
  expect([...reads]).toEqual([])
  const open = await rows(page).first().getAttribute('data-key')
  await rows(page).first().locator('.mk-r-th').click()
  await expect(detail).toHaveAttribute('data-key', open!)
  const openStream = fixture.items.find(x => x.id === open)!.streamId
  // the games on top (M1, 10-22); the open stream's earlier moments are in the open moment
  await expect(page.getByRole('list', { name: 'Games, busiest first' })).toBeVisible()
  const earlier = fixture.items.filter(x => x.verdict !== 'bad' && x.streamId === openStream).length - 1
  await expect(page.locator('.mk-det .mk-d-more button')).toHaveCount(earlier)
  // the verdict's (i) says why it counts (moments-r4 B2: no verdict tiers, filters or orders); Esc closes only that.
  // A moment that holds up has it on its × line, the others on their chip (C1, 10-22)
  const chip = detail.locator('.mk-d-why, .mk-hold')
  await expect(chip).toHaveAttribute('aria-expanded', 'false')
  await chip.click()
  await expect(detail.getByRole('heading', { name: 'Why it counts' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(chip).toHaveAttribute('aria-expanded', 'false')
  await expect(detail).toBeVisible()
  await expect(detail.locator('.mk-ch svg rect.mk-cb.mo')).toHaveCount(1)
  await expect(page.getByRole('combobox')).toHaveCount(0)
  await expect(page.locator('.mk-foot')).toHaveCount(0)
  // the opened moment reads its stream record and its minutes; no row reads anything
  await expect.poll(() => reads.length).toBe(2)

  // hold a minute: the card under the chart, then Esc lets go. At 1440 x 900 the chart starts below the fold
  const svg = detail.locator('.mk-ch svg')
  await svg.scrollIntoViewIfNeeded()
  const box = (await svg.boundingBox())!
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.7)
  const card = page.locator('.mk-mc')
  await expect(card).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(card).toHaveCount(0)
  // with focus elsewhere in the moment (the Emotes switch), Esc still lets go of the minute first, and the moment stays open (Q4b, 10-31)
  const openKey = await detail.getAttribute('data-key')
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.7)
  await expect(card).toBeVisible()
  await detail.getByRole('group', { name: 'Chart shows' }).getByRole('button', { name: 'Emotes' }).click()
  await expect(card).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(card).toHaveCount(0)
  await expect(detail).toHaveAttribute('data-key', openKey!)
  await detail.getByRole('group', { name: 'Chart shows' }).getByRole('button', { name: 'Chat' }).click()

  // J moves to the next row and keeps the list put
  await rows(page).first().locator('.mk-r-hit').focus()
  const second = await rows(page).nth(1).getAttribute('data-key')
  await page.keyboard.press('j')
  await expect(detail).toHaveAttribute('data-key', second!)
  expect(new URL(page.url()).searchParams.get('m')).toBe(second)

  // / searches
  await page.keyboard.press('/')
  await expect(page.getByRole('searchbox', { name: 'Search channels, games or emotes' })).toBeFocused()
  await page.keyboard.type('ml7')
  await expect(streamRows(page)).toHaveCount(1)

  await assertNoPageHorizontalOverflow(page)
  await assertNoConsoleErrors(page, errors)
})

test('phone: a moment opens under its row and a second tap closes it', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const errors = attachConsoleErrorGuard(page)
  await mockFeed(page)
  await page.goto('/analytics/moments', { waitUntil: 'domcontentloaded' })
  await expect(rows(page).first()).toBeVisible()
  const shift = await cls(page)
  testInfo.annotations.push({ type: 'CLS 390', description: shift.toFixed(4) })
  expect(shift).toBeLessThan(0.1)
  await expect(page.locator('.mk-det .mk-d')).toHaveCount(0)
  const first = rows(page).first().locator('.mk-r-th')
  await first.click()
  await expect(page.locator('.mk-slot .mk-d')).toBeVisible()
  await assertNoPageHorizontalOverflow(page)
  await first.click()
  await expect(page.locator('.mk-slot')).toHaveCount(0)
  await assertNoConsoleErrors(page, errors)
})

test('phone: a deep-linked row lands below the portal’s header, and so does Esc’s focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockFeed(page)
  // the newest moment of the sixth stream that holds up: a scroll away
  const order = [...new Set(newest.filter(x => x.verdict !== 'bad').map(x => x.streamId))]
  const target = newest.find(x => x.verdict !== 'bad' && x.streamId === order[5])!
  await page.goto(`/analytics/moments?m=${target.id}`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.mk-slot .mk-d')).toHaveAttribute('data-key', target.id)
  const row = page.locator(`.mk-list .mk-r[data-key="${target.id}"]`)
  const header = await headerBottom(page)
  expect(header).toBeGreaterThan(100) // the portal's header at 390, taller than the mockup's
  await expect.poll(async () => (await row.boundingBox())!.y).toBeGreaterThanOrEqual(header)
  await page.keyboard.press('Escape')
  await expect(page.locator('.mk-slot')).toHaveCount(0)
  await expect(row.locator('.mk-r-hit')).toBeFocused()
  await expect.poll(async () => (await row.boundingBox())!.y).toBeGreaterThanOrEqual(await headerBottom(page))
})

test('a later page that fails keeps what has loaded', async ({ page }) => {
  const errors = attachConsoleErrorGuard(page)
  const reads = await mockFeed(page, 'ok', 1)
  await page.goto('/analytics/moments', { waitUntil: 'domcontentloaded' })
  await expect(rows(page).first()).toBeVisible()
  await expect.poll(() => reads.feed.filter(c => c === 'c20').length).toBeGreaterThan(0)
  const loaded = new Set(newest.slice(0, PAGE).filter(x => x.verdict !== 'bad').map(x => x.streamId)).size
  await expect(streamRows(page)).toHaveCount(loaded)
  // the dot alone, or how old once it greys (N1, 10-30)
  await expect(page.locator('.mk-fresh')).toHaveText(/^(updated .+)?$/)
  expect(reads.feed.filter(c => c === 'c40')).toEqual([])
  expect(errors.filter(e => !/status of 503/.test(e))).toEqual([])
})

test('a deep link to a moment that is gone says so, with the stream’s page, and opens nothing else', async ({ page }) => {
  const reads = await mockFeed(page)
  await page.goto('/analytics/moments?m=pulse-somestreamer-123456-930', { waitUntil: 'domcontentloaded' })
  const line = page.getByRole('status').filter({ hasText: 'That moment is no longer here.' })
  await expect(line).toBeVisible()
  await expect(line.getByRole('link', { name: 'Open it on the stream’s page' })).toHaveAttribute('href', '/analytics/somestreamer/123456?returnTo=%2Fanalytics%2Fmoments#t=930')
  await expect(page.locator('.mk-d')).toHaveCount(0)
  await page.waitForTimeout(500)
  expect([...reads]).toEqual([])
})

test('a deep link to a moment that didn’t hold up opens it in Live', async ({ page }) => {
  await mockFeed(page)
  const bad = fixture.items.find(x => x.verdict === 'bad')!
  await page.goto(`/analytics/moments?m=${bad.id}`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.mk-det .mk-d')).toHaveAttribute('data-key', bad.id)
  await expect(seg(page, 'Live')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator(`.mk-list .mk-r[data-key="${bad.id}"]`)).toHaveAttribute('aria-current', 'true')
})

test('Top: the last 24, 6 or 1 hours from what has loaded, with no new reads; an old Latest link opens Live', async ({ page }) => {
  const reads = await mockFeed(page)
  await page.goto('/analytics/moments?view=latest', { waitUntil: 'domcontentloaded' })
  await expect(seg(page, 'Live')).toHaveAttribute('aria-pressed', 'true')
  await expect(rows(page).first()).toBeVisible()
  await expect.poll(() => reads.feed).toEqual(['first', 'c20'])
  const range = page.getByRole('group', { name: 'How far back' })
  await expect(range).toHaveCount(0)
  await seg(page, 'Top').click()
  const caption = page.locator('.mk-cap')
  await expect(caption).toHaveText('Top moments in the last 24 hours, strongest first')
  await expect(range.getByRole('button', { name: '24h', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const times = () => rows(page).locator('time').evaluateAll(ts => ts.map(t => Date.parse(t.getAttribute('datetime') ?? '')))
  const now = fixture.generatedAt + 90_000
  let shown = await times()
  expect(Math.min(...shown)).toBeLessThan(now - 6 * 3_600_000)
  for (const [hours, words] of [[6, '6 hours'], [1, 'hour']] as const) {
    await range.getByRole('button', { name: `${hours}h`, exact: true }).click()
    await expect(caption).toHaveText(`Top moments in the last ${words}, strongest first`)
    const ats = await times()
    expect(ats.length).toBeGreaterThan(0)
    expect(ats.length).toBeLessThanOrEqual(shown.length)
    expect(Math.min(...ats)).toBeGreaterThan(now - hours * 3_600_000)
    shown = ats
  }
  expect(reads.feed).toEqual(['first', 'c20'])
  expect(reads.ids).toEqual([])
  expect([...reads]).toEqual([])
})

test('Saved is one list in this browser: an older save still reads, and no save is looked up', async ({ page }) => {
  const reads = await mockFeed(page)
  await page.goto('/analytics/moments', { waitUntil: 'domcontentloaded' })
  await expect(rows(page).first()).toBeVisible()
  // a save kept before the cards (v1), of a stream the feed no longer has
  await page.evaluate(at => localStorage.setItem('streampulse.saved-moments.v1', JSON.stringify({ version: 1,
    items: [{ login: 'somestreamer', streamId: '123456', offsetSeconds: 930, at, label: 'spammed PJSalt', savedAt: at }] })), fixture.generatedAt - 30 * 3_600_000)
  await page.reload({ waitUntil: 'domcontentloaded' })
  const key = await rows(page).first().getAttribute('data-key')
  const item = fixture.items.find(x => x.id === key)!
  await rows(page).first().locator('.mk-r-th').click()
  await page.locator('.mk-det').getByRole('button', { name: 'Save' }).click()
  // the save keeps its game in the one list; there is no second copy
  const kept = await page.evaluate(() => ({ list: JSON.parse(localStorage.getItem('streampulse.saved-moments.v2') ?? '{}'), copy: localStorage.getItem('sp-moments-checked-saved') }))
  expect(kept.copy).toBeNull()
  expect(kept.list.items.map((s: { streamId: string; categoryId?: string }) => [s.streamId, s.categoryId])).toEqual([[item.streamId, item.category!.id], ['123456', undefined]])
  await page.reload({ waitUntil: 'domcontentloaded' })
  await seg(page, 'Saved').click()
  await expect(streamRows(page)).toHaveCount(2)
  await expect(streamRows(page).first()).toHaveAttribute('data-key', key!)
  await expect(streamRows(page).nth(1)).toHaveClass(/mk-r-gone/)
  await expect(streamRows(page).nth(1)).toContainText('Gone from the feed')
  expect(reads.ids).toEqual([])
})

test('with the feed off (404) the page is the current one', async ({ page }) => {
  const errors = attachConsoleErrorGuard(page)
  await mockFeed(page, 'off')
  await page.goto('/analytics/moments', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('tab', { name: 'Latest', exact: true })).toBeVisible()
  await expect(page.locator('.mk')).toHaveCount(0)
  // the 404 itself is the only console error the browser logs
  expect(errors.filter(e => !/status of 404/.test(e))).toEqual([])
})

test('an outage says Moments couldn’t load, keeps the deep link, and Try again opens it', async ({ page }) => {
  const errors = attachConsoleErrorGuard(page)
  const reads = await mockFeed(page, 'outage')
  // a moment down the first page, not its first row
  const target = newest.slice(0, PAGE).filter(x => x.verdict === 'ok').at(-1)!
  expect(target.id).not.toBe(newest.find(x => x.verdict !== 'bad')!.id)
  await page.goto(`/analytics/moments?m=${target.id}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('alert')).toHaveText('Moments couldn’t load.')
  // not the current page: an outage isn't the feed being off
  await expect(page.getByRole('tab', { name: 'Latest', exact: true })).toHaveCount(0)
  expect(new URL(page.url()).searchParams.get('m')).toBe(target.id)
  expect(reads.feed.filter(c => c !== 'first')).toEqual([])
  reads.up()
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.locator('.mk-det .mk-d')).toHaveAttribute('data-key', target.id)
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(errors.filter(e => !/status of 503/.test(e))).toEqual([])
})
