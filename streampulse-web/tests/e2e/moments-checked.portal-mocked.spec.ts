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

async function mockFeed(page: Page, feed: 'ok' | 'off' = 'ok', failPage?: number) {
  const reads: string[] = []
  const feedReads: string[] = []
  await page.route('**/v1/**', route => route.fulfill({ status: 503, json: { error: 'unmocked_endpoint' } }))
  await installHubUxMock(page)
  await page.route(/\/v1\/public\/discovery\/ranked\/availability(?:\?.*)?$/, route => route.fulfill({ status: 404, contentType: 'text/plain', body: '404 page not found\n' }))
  await page.route('https://static-cdn.jtvnw.net/**', route => route.fulfill({ contentType: 'image/png', body: PNG }))
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
      const item = fixture.items.find(x => x.id === id)
      return item ? route.fulfill({ json: { schemaVersion: 1, generatedAt: fixture.generatedAt, stale: false, item } }) : route.fulfill({ status: 404, json: { error: 'not_found' } })
    }
    const cursor = params.get('cursor')
    feedReads.push(cursor ?? 'first')
    const from = cursor ? Number(cursor.slice(1)) : 0
    if (failPage != null && from === failPage * PAGE) return route.fulfill({ status: 503, headers: { 'retry-after': '5' }, json: { error: 'unavailable' } })
    const items = newest.slice(from, from + PAGE), next = from + PAGE < newest.length ? `c${from + PAGE}` : null
    return route.fulfill({ headers: { 'cache-control': 'public, max-age=30' }, json: { ...fixture, items, nextCursor: next, facets: { verdicts } } })
  })
  // the fixture's capture time, so "N min ago" reads as it did
  await page.clock.setFixedTime(fixture.generatedAt + 90_000)
  return Object.assign(reads, { feed: feedReads })
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
/** One per stream: the open stream's earlier moments sit under its row. */
const streamRows = (page: Page) => page.locator('.mk-list > li.mk-g > .mk-r')
const seg = (page: Page, name: string) => page.getByRole('group', { name: 'Which moments' }).getByRole('button', { name: new RegExp(`^${name}`) })

test('wide: the latest moments, the first one open beside the list', async ({ page }, testInfo) => {
  const errors = attachConsoleErrorGuard(page)
  const reads = await mockFeed(page)
  await page.goto('/analytics/moments')
  await expect(page.getByRole('heading', { level: 1, name: 'Moments' })).toBeVisible()
  await expect(rows(page).first()).toBeVisible()
  const shift = await cls(page)
  testInfo.annotations.push({ type: 'CLS 1440', description: shift.toFixed(4) })
  expect(shift).toBeLessThan(0.1)

  const streams = new Set(fixture.items.filter(x => x.verdict !== 'bad').map(x => x.streamId)).size
  await expect(streamRows(page)).toHaveCount(streams)
  // every page, one at a time, then no more
  expect(reads.feed).toEqual(['first', 'c20'])
  const open = await page.locator('.mk-det .mk-d').getAttribute('data-key')
  const openStream = fixture.items.find(x => x.id === open)!.streamId
  await expect(page.locator('.mk-sub .mk-r')).toHaveCount(fixture.items.filter(x => x.verdict !== 'bad' && x.streamId === openStream).length - 1)
  const detail = page.locator('.mk-det .mk-d')
  await expect(detail).toBeVisible()
  // the verdict chip's (i) says why it counts (moments-r4 B2: no verdict tiers, filters or orders); Esc closes only that
  const chip = detail.locator('.mk-hold')
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

  // hold a minute: the card under the chart, then Esc lets go
  const svg = detail.locator('.mk-ch svg')
  const box = (await svg.boundingBox())!
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.7)
  const card = page.locator('.mk-mc')
  await expect(card).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(card).toHaveCount(0)

  // J moves to the next row and keeps the list put
  await rows(page).first().focus()
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
  await page.goto('/analytics/moments')
  await expect(rows(page).first()).toBeVisible()
  const shift = await cls(page)
  testInfo.annotations.push({ type: 'CLS 390', description: shift.toFixed(4) })
  expect(shift).toBeLessThan(0.1)
  await expect(page.locator('.mk-det .mk-d')).toHaveCount(0)
  const first = rows(page).first()
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
  await page.goto(`/analytics/moments?m=${target.id}`)
  await expect(page.locator('.mk-slot .mk-d')).toHaveAttribute('data-key', target.id)
  const row = page.locator(`.mk-list .mk-r[data-key="${target.id}"]`)
  const header = await headerBottom(page)
  expect(header).toBeGreaterThan(100) // the portal's header at 390, taller than the mockup's
  await expect.poll(async () => (await row.boundingBox())!.y).toBeGreaterThanOrEqual(header)
  await page.keyboard.press('Escape')
  await expect(page.locator('.mk-slot')).toHaveCount(0)
  await expect(row).toBeFocused()
  await expect.poll(async () => (await row.boundingBox())!.y).toBeGreaterThanOrEqual(await headerBottom(page))
})

test('a later page that fails keeps what has loaded', async ({ page }) => {
  const errors = attachConsoleErrorGuard(page)
  const reads = await mockFeed(page, 'ok', 1)
  await page.goto('/analytics/moments')
  await expect(rows(page).first()).toBeVisible()
  await expect.poll(() => reads.feed.filter(c => c === 'c20').length).toBeGreaterThan(0)
  const loaded = new Set(newest.slice(0, PAGE).filter(x => x.verdict !== 'bad').map(x => x.streamId)).size
  await expect(streamRows(page)).toHaveCount(loaded)
  await expect(page.locator('.mk-fresh')).toContainText('updated')
  expect(reads.feed.filter(c => c === 'c40')).toEqual([])
  expect(errors.filter(e => !/status of 503/.test(e))).toEqual([])
})

test('a deep link to a moment that is gone says so, with the stream’s page, and opens nothing else', async ({ page }) => {
  const reads = await mockFeed(page)
  await page.goto('/analytics/moments?m=pulse-somestreamer-123456-930')
  const line = page.getByRole('status').filter({ hasText: 'That moment is no longer here.' })
  await expect(line).toBeVisible()
  await expect(line.getByRole('link', { name: 'Open it on the stream’s page' })).toHaveAttribute('href', '/analytics/somestreamer/123456?returnTo=%2Fanalytics%2Fmoments#t=930')
  await expect(page.locator('.mk-d')).toHaveCount(0)
  await page.waitForTimeout(500)
  expect([...reads]).toEqual([])
})

test('a deep link to a moment that didn’t hold up opens it in Latest', async ({ page }) => {
  await mockFeed(page)
  const bad = fixture.items.find(x => x.verdict === 'bad')!
  await page.goto(`/analytics/moments?m=${bad.id}`)
  await expect(page.locator('.mk-det .mk-d')).toHaveAttribute('data-key', bad.id)
  await expect(seg(page, 'Latest')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator(`.mk-list .mk-r[data-key="${bad.id}"]`)).toHaveAttribute('aria-current', 'true')
})

test('Saved keeps a moment across a reload', async ({ page }) => {
  await mockFeed(page)
  await page.goto('/analytics/moments')
  await page.locator('.mk-det').getByRole('button', { name: 'Save' }).click()
  await page.reload()
  await seg(page, 'Saved').click()
  await expect(streamRows(page)).toHaveCount(1)
})

test('with the feed off (404) the page is the current one', async ({ page }) => {
  const errors = attachConsoleErrorGuard(page)
  await mockFeed(page, 'off')
  await page.goto('/analytics/moments')
  await expect(page.getByRole('tab', { name: 'Latest', exact: true })).toBeVisible()
  await expect(page.locator('.mk')).toHaveCount(0)
  // the 404 itself is the only console error the browser logs
  expect(errors.filter(e => !/status of 404/.test(e))).toEqual([])
})
