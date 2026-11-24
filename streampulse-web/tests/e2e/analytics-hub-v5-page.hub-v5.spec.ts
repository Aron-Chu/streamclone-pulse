import { expect, test, type Page } from '@playwright/test'
import { installHubUxMock, READY_FEATURED_SESSION, type HubUxMockOptions } from './helpers/hubUxMock'
import { openV5Hub } from './helpers/openV5Hub'

// The page around the chart (d3-v5 mockup, round 5; its reading order since H1, 11-19): the search hero,
// Busiest now, the Top emotes row, the chart, Top moments today (five still rows) beside or over Picking
// up now, the emote map, Where chat is, Channels and How this is measured. The shared mock has no
// screener windows, so this spec serves the same reply with one per channel: three games, one channel
// with viewers only and one whose average is too short to compare. With the check working, the reply
// also names xQc as its featured stream, as production's replies do (picks I1 and I1b, 10-30). Since H1
// that stream is Busiest now's first row, with no card of its own.

// Top moments today lists, from the hub, a moment from 20 minutes into its stream that rose
// 1.5x or more over that stream's own average. The mock's moments are 2 and 4 minutes in with
// no comparison, so a spec that needs a moment row serves the first one an hour in, compared.
const TOP_MOMENT: HubUxMockOptions = { withComparisons: true, momentOffsets: [3600, 3600] }

async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
}

const box = async (page: Page, selector: string) => (await page.locator(selector).boundingBox())!

// After a resize the chart re-measures and, a frame later, the search hero grows; every row
// below moves (about 36 px at 1440), so each layout check retries until the boxes agree.
const SETTLED = { timeout: 10_000 }

// Since H1 (11-19) one set of grid templates: the Featured stream card is gone, so a reply with or without a featured
// stream reads in the same order.
for (const [label, featuredSession] of [['with', READY_FEATURED_SESSION], ['without', undefined]] as const) {
  test(`sections stack in the reading order on a phone and sit in their columns on desktop, ${label} a featured stream`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width: 390, height: 844 })
    await openV5Hub(page, { featuredSession })
    await expect(page.getByRole('heading', { level: 1, name: 'Find your streamer' })).toBeVisible()
    await expect(page.locator('.hv5-most, #big-moments')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Featured stream' })).toHaveCount(0)
    const order = ['.hv5-mast', '#busiest', '.hv5-emr', '#activity', '#top-moments', '#latest', '#emotes', '#games', '#channels', '#measured']
    await expect(async () => {
      const tops: number[] = []
      for (const selector of order) tops.push((await box(page, selector)).y)
      expect(tops).toEqual([...tops].sort((a, b) => a - b))
    }).toPass(SETTLED)
    await noSideScroll(page)

    // from 1200 px Top moments today and Picking up now share the row under the chart (H1); from 1536 px Picking up now
    // is the sticky column on the right, from Busiest now down (L1, 11-16)
    for (const [width, height] of [[1440, 900], [1920, 1000]] as const) {
      await page.setViewportSize({ width, height })
      const column = width >= 1536
      const flow = column ? order.filter((selector) => selector !== '#latest') : order
      await expect(async () => {
        const ys: number[] = []
        for (const selector of flow) ys.push((await box(page, selector)).y)
        expect(ys).toEqual([...ys].sort((a, b) => a - b))
        const [busiest, row, activity, top, rail, emotes, games] = await Promise.all(['#busiest', '.hv5-emr', '#activity', '#top-moments', '#latest', '#emotes', '#games'].map((selector) => box(page, selector)))
        // the Top emotes row is as wide as the chart, between Busiest now and the chart
        expect(Math.abs(row.x - activity.x)).toBeLessThanOrEqual(1)
        expect(Math.abs(row.width - activity.width)).toBeLessThanOrEqual(1)
        expect(row.y).toBeGreaterThanOrEqual(busiest.y + busiest.height - 1)
        expect(activity.y).toBeGreaterThanOrEqual(row.y + row.height - 1)
        expect(Math.abs(top.x - activity.x)).toBeLessThanOrEqual(1)
        expect(top.y).toBeGreaterThanOrEqual(activity.y + activity.height - 1)
        if (column) {
          expect(Math.abs(rail.width - 380)).toBeLessThanOrEqual(1)
          expect(Math.abs(rail.y - busiest.y)).toBeLessThanOrEqual(1)
          expect(rail.x).toBeGreaterThanOrEqual(activity.x + activity.width + 23)
          expect(games.x + games.width).toBeLessThanOrEqual(rail.x - 23)
          expect(Math.abs(top.width - activity.width)).toBeLessThanOrEqual(1)
        } else {
          expect(Math.abs(rail.y - top.y)).toBeLessThanOrEqual(1)
          expect(rail.x).toBeGreaterThanOrEqual(top.x + top.width + 1)
          expect(emotes.y).toBeGreaterThanOrEqual(Math.max(top.y + top.height, rail.y + rail.height) - 1)
        }
        expect(Math.abs(emotes.y - games.y)).toBeLessThanOrEqual(1)
        expect(emotes.x + emotes.width).toBeLessThanOrEqual(games.x + 1)
      }).toPass(SETTLED)
      await expect(page.locator('#latest')).toHaveCSS('position', column ? 'sticky' : 'static')
      await noSideScroll(page)
    }
  })
}

test('Busiest now names the featured stream with its live game, as its first row (H1, 11-19)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 360, height: 780 })
  await openV5Hub(page)
  // the live row's name and game, never the stored record's (XQC, Grand Theft Auto V)
  const first = page.locator('#busiest li[data-rank="1"]')
  await expect(first).toHaveAttribute('data-login', 'xqc')
  await expect(first.locator('.hv5-bzt-cat')).toHaveText('Just Chatting')
  await expect(page.locator('#busiest')).not.toContainText('Grand Theft Auto V')
  await noSideScroll(page)
})

test('the Top emotes row holds its place while the hub loads, so the chart under it does not move when it lands (H1, 11-19)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const payload = await openV5Hub(page)
  // Every load starts with nothing saved: the hub's poll can save a copy between a clear and the reload.
  await page.addInitScript(() => localStorage.clear())
  // a first visit (nothing saved) on a phone and at two desktop templates; the reply waits until the row is measured
  for (const [width, height] of [[390, 844], [1440, 900], [1920, 1000]] as const) {
    await page.setViewportSize({ width, height })
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    await page.route(/\/v1\/public\/hub(\?.*)?$/, async (route) => { await held; await route.fulfill({ json: payload }) })
    await page.reload()
    const row = page.locator('.hv5-emr')
    await expect(row).toHaveAttribute('aria-busy', 'true')
    let before = { height: 0, gap: 0 }
    await expect(async () => {
      const [r, activity] = [await box(page, '.hv5-emr'), await box(page, '#activity')]
      before = { height: r.height, gap: activity.y - r.y }
      expect(r.height).toBeGreaterThan(40)
    }).toPass(SETTLED)
    release()
    await expect(row).not.toHaveAttribute('aria-busy', /.*/)
    await expect(row.locator('button.hv5-emr-c').first()).toBeVisible()
    await expect(async () => {
      const [r, activity] = [await box(page, '.hv5-emr'), await box(page, '#activity')]
      expect([width, Math.round(r.height), Math.round(activity.y - r.y)]).toEqual([width, Math.round(before.height), Math.round(before.gap)])
    }).toPass(SETTLED)
  }
})

/**
 * The search's lookups for one login (3A): the latest recorded stream and the Twitch profile. Fulfilled here, never
 * passed on: a login in `streams` answers with that stream, every other read is the edge's 502.
 */
async function fenceLookups(page: Page, streams: Record<string, Record<string, unknown>> = {}) {
  await page.route(/\/v1\/channels\/[^/?]+(\?.*)?$/, route => {
    const login = new URL(route.request().url()).pathname.split('/').pop() ?? ''
    return streams[login]
      ? route.fulfill({ json: { login, displayName: String(streams[login].displayName ?? login) } })
      : route.fulfill({ status: 502, contentType: 'text/plain', body: 'error code: 502' })
  })
  await page.route(/\/v1\/portal\/analytics\/channels\/[^/]+\/streams(\?.*)?$/, route => {
    const login = new URL(route.request().url()).pathname.split('/')[5] ?? ''
    return streams[login]
      ? route.fulfill({ json: { channel: login, items: [{ login, ...streams[login] }] } })
      : route.fulfill({ status: 502, contentType: 'text/plain', body: 'error code: 502' })
  })
}

test('the hero search lists live channels, filters as you type and opens the pick', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await fenceLookups(page)
  await openV5Hub(page)
  const input = page.getByRole('combobox', { name: /search/i })
  await expect(input).toHaveAttribute('placeholder', 'Streamers or games')
  await expect(input).toHaveAttribute('aria-label', 'Search streamers or games')
  await page.keyboard.press('Control+k')
  await expect(input).toBeFocused()
  const list = page.getByRole('listbox', { name: 'Search suggestions' })
  await expect(list).toBeVisible()
  await expect(list.getByRole('option')).toHaveCount(6)
  await expect(list.getByRole('option').first()).toContainText('xQc')
  await input.fill('channel1')
  await expect(list.getByRole('option').first()).toContainText('channel1')
  for (const text of await list.getByRole('option').allTextContents()) expect(text).toMatch(/channel1|Open analytics/)
  await page.keyboard.press('Escape')
  await expect(list).toBeHidden()
  await input.fill('sodapoppin')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/analytics\/sodapoppin$/)
})

test('the hero search shows an offline channel from its records, and "can’t check" when the read fails', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await fenceLookups(page, {
    mizkif: { displayName: 'Mizkif', streamId: '777', startedAt: '2026-10-31T18:00:00Z', endedAt: '2026-10-31T22:00:00Z', category: 'Just Chatting' },
  })
  await openV5Hub(page)
  const input = page.getByRole('combobox', { name: /search/i })
  const list = page.getByRole('listbox', { name: 'Search suggestions' })
  // not live in the mock, so its row comes from the lookups
  await input.fill('mizkif')
  const row = list.locator('[data-kind="login"]')
  await expect(row).toHaveAttribute('data-state', 'recorded')
  await expect(row).toContainText('Mizkif')
  await expect(row).toContainText('Offline · last streamed Oct 31 · Just Chatting')
  await expect(row).toHaveAttribute('href', '/analytics/mizkif/777')
  await input.fill('zzzqqqxx1')
  await expect(row).toHaveAttribute('data-state', 'unknown')
  await expect(row).toContainText('Open analytics for zzzqqqxx1')
  await expect(row).toContainText('Can’t check right now')
  await expect(row).toHaveAttribute('href', '/analytics/zzzqqqxx1')
  await noSideScroll(page)
})

test('a game from the hero search filters Channels in place and keeps it in the link', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await fenceLookups(page)
  await openV5Hub(page)
  // the hero's box: once the page scrolls to Channels, the top bar shows its own
  const hero = page.getByRole('main')
  const input = hero.getByRole('combobox', { name: /search/i })
  const list = hero.getByRole('listbox', { name: 'Search suggestions', includeHidden: true })
  await input.fill('minec')
  const game = list.locator('[data-kind="game"]', { hasText: 'Minecraft' })
  await expect(game).toContainText('4 channels live')
  await game.click()
  await expect(page).toHaveURL(/\/analytics\?game=Minecraft$/)
  await expect(input).toHaveValue('')
  await expect(list).toBeHidden()
  const channels = page.locator('#channels')
  await expect(channels.locator('[data-chip="game"]')).toContainText('Minecraft')
  await expect(channels.locator('[data-hv5-channel-count]')).toHaveText('4 channels')
  await expect(page.locator('#games [data-game="Minecraft"]')).toHaveAttribute('aria-pressed', 'true')
  // the link opens on the same filter
  await page.reload()
  await expect(page.locator('#channels [data-chip="game"]')).toContainText('Minecraft')
  await page.locator('#channels').getByRole('button', { name: 'Remove the Minecraft filter' }).click()
  await expect(page).toHaveURL(/\/analytics$/)
})

test('an emote from the hero search is found on the Top emotes map, and Find emote clears with Esc', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await fenceLookups(page)
  await openV5Hub(page, { bucketEmoteDetail: true })
  const emotes = page.locator('#emotes')
  await expect(emotes.locator('.hv5-em-t').first()).toBeVisible()
  const input = page.getByRole('combobox', { name: /search/i })
  const list = page.getByRole('listbox', { name: 'Search suggestions' })
  await input.fill('OMEGA')
  const pick = list.locator('[data-kind="emote"]', { hasText: 'OMEGALUL' })
  await expect(pick).toContainText('BTTV')
  await pick.click()
  const find = emotes.getByRole('searchbox', { name: 'Find emote on the map' })
  await expect(find).toHaveValue('OMEGALUL')
  const found = emotes.locator('.hv5-em-ly:not([data-out]) > .hv5-em-t[data-found]')
  await expect(found).toHaveCount(1)
  await expect(found).toHaveAttribute('aria-pressed', 'true')
  await expect(found).toHaveAttribute('aria-label', /OMEGALUL/)
  await expect(emotes.locator('.hv5-el-ti')).toContainText('OMEGALUL')
  await expect(emotes).toBeInViewport()
  // typed in the map's own box: the best match, and a plain line when nothing matches
  await find.fill('Dino')
  await expect(found).toHaveAttribute('aria-label', /DinoDance/)
  await find.fill('nothing-here')
  await expect(found).toHaveCount(0)
  await expect(emotes.locator('.hv5-em-fmsg[role="status"]')).toContainText('No emote matches “nothing-here”')
  await find.fill('KEKW')
  await expect(found).toHaveAttribute('aria-label', /KEKW/)
  await find.press('Escape')
  await expect(find).toHaveValue('')
  await expect(found).toHaveCount(0)
  await expect(emotes.locator('.hv5-em-zr')).toHaveText('1.0×')
})

test('Busiest now ranks by chat, pages with the buttons and moves focus with the arrow keys', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openV5Hub(page)
  const busiest = page.locator('#busiest')
  const tiles = busiest.locator('.hv5-bzc-it')
  // 13 channels have a full window; Busiest shows the top 12 by chat/min.
  await expect(tiles).toHaveCount(12)
  await expect(tiles.first()).toHaveAttribute('data-login', 'xqc')
  await expect(tiles.first().locator('.hv5-bzt-fig')).toContainText('400')
  const track = busiest.locator('.hv5-bzc-track')
  const prev = busiest.getByRole('button', { name: 'Previous channels' })
  const next = busiest.getByRole('button', { name: 'Next channels' })
  await expect(prev).toHaveAttribute('aria-disabled', 'true')
  const before = await track.evaluate(el => el.scrollLeft)
  await next.click()
  await expect.poll(() => track.evaluate(el => el.scrollLeft)).toBeGreaterThan(before)
  await expect(prev).not.toHaveAttribute('aria-disabled', 'true')
  await tiles.first().locator('a').focus()
  await page.keyboard.press('ArrowRight')
  await expect(tiles.nth(1).locator('a')).toBeFocused()
  await page.keyboard.press('End')
  await expect(tiles.last().locator('a')).toBeFocused()
  await noSideScroll(page)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(tiles).toHaveCount(12)
  await noSideScroll(page)
})

// Twitch's live pictures (mockup §5, 10-31): previews-ttv answers a channel that isn't live with Twitch's offline
// picture, so the page compares each live picture with it. Here only xQc is live on Twitch; both answers carry
// CORS headers, as Twitch's do. Two 1x1 pictures that draw different pixels.
const LIVE_PICTURE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const OFFLINE_PICTURE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNISUkBAAJcAS1bGyRYAAAAAElFTkSuQmCC', 'base64')

test('Busiest now shows Twitch’s live picture and keeps the face for a channel Twitch shows offline', async ({ page }) => {
  await page.route(/^https:\/\/static-cdn\.jtvnw\.net\/(previews-ttv\/|ttv-static\/404_preview-)/, (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    headers: { 'access-control-allow-origin': '*' },
    body: route.request().url().includes('/previews-ttv/live_user_xqc-') ? LIVE_PICTURE : OFFLINE_PICTURE,
  }))
  await page.setViewportSize({ width: 1440, height: 900 })
  await openV5Hub(page)
  const tiles = page.locator('#busiest .hv5-bzc-it')
  await expect(tiles.first()).toHaveAttribute('data-login', 'xqc')
  await expect(tiles.first().locator('img.hv5-bzv-prev[data-shown]')).toBeVisible()
  await expect(tiles.first().locator('img.hv5-bzv-prev')).toHaveAttribute('src', /\/previews-ttv\/live_user_xqc-440x248\.jpg\?t=\d+$/)
  await expect(tiles.first().locator('a')).toHaveAccessibleName(/\. Twitch’s live picture, can be a few minutes old\.$/)
  // the second channel's picture is Twitch's offline one: its face stays
  await expect(tiles.nth(1).locator('img.hv5-bzv-prev')).toHaveCount(0)
  await expect(tiles.nth(1).locator('a')).toHaveAccessibleName(/\. Profile picture\.$/)
  await noSideScroll(page)
})

test('Where chat is filters Channels to one game and the chip clears it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openV5Hub(page)
  const games = page.locator('#games')
  await expect(games.locator('.hv5-gr')).toHaveCount(3)
  await expect(games.locator('.hv5-gr').first()).toHaveAttribute('data-game', 'Just Chatting')
  const minecraft = games.locator('[data-game="Minecraft"]')
  await minecraft.click()
  await expect(minecraft).toHaveAttribute('aria-pressed', 'true')
  const channels = page.locator('#channels')
  await expect(channels.locator('[data-chip="game"]')).toContainText('Minecraft')
  await expect(channels.locator('[data-hv5-channel-count]')).toHaveText('4 channels')
  await expect(channels.locator('tbody tr')).toHaveCount(4)
  await channels.getByRole('button', { name: 'Remove the Minecraft filter' }).click()
  await expect(channels.locator('[data-chip="game"]')).toHaveCount(0)
  await expect(minecraft).toHaveAttribute('aria-pressed', 'false')
  await expect(channels.locator('[data-hv5-channel-count]')).toHaveText('Showing 14 of 96 live')
  await expect(channels.getByRole('textbox', { name: 'Filter channels or games' })).toBeFocused()
})

test('Channels sorts, filters, shows more and marks what is not measured', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openV5Hub(page)
  const channels = page.locator('#channels')
  const rows = channels.locator('tbody tr')
  await expect(rows).toHaveCount(10)
  await expect(rows.first()).toHaveAttribute('data-login', 'xqc')
  await channels.getByRole('button', { name: 'Show 4 more' }).click()
  await expect(rows).toHaveCount(14)
  await expect(channels.getByRole('button', { name: 'Show fewer' })).toBeFocused()
  // Viewers only, and an average under 10 measured minutes: a dash with its reason.
  await expect(channels.locator('tr[data-login="channel13"] .hv5-na')).toHaveCount(2)
  await expect(channels.locator('tr[data-login="channel12"] td').nth(4).locator('.hv5-na')).toHaveCount(1)
  await channels.getByRole('button', { name: 'Show fewer' }).click()
  await expect(rows).toHaveCount(10)

  const vs = channels.locator('[data-sort="vs"]')
  // Its name starts with the words it shows, then says what "avg" is.
  await expect(vs).toHaveAccessibleName('vs avg (the channel’s own average)')
  await vs.click()
  await expect(vs).toBeFocused()
  await expect(channels.locator('th.c-vs')).toHaveAttribute('aria-sort', 'descending')
  await expect(rows.first()).toHaveAttribute('data-login', 'channel2')
  await vs.click()
  await expect(channels.locator('th.c-vs')).toHaveAttribute('aria-sort', 'ascending')

  await channels.getByRole('textbox', { name: 'Filter channels or games' }).fill('valorant')
  await expect(channels.locator('[data-hv5-channel-count]')).toHaveText('3 channels')
  await channels.getByRole('textbox', { name: 'Filter channels or games' }).fill('nobody-here')
  await expect(channels.getByText('No channels match.')).toBeVisible()
})

test('Top moments today is five still rows under the chart, and the rail is only what is picking up now, strongest × first', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await openV5Hub(page, TOP_MOMENT)
  const top = page.locator('#top-moments')
  await expect(top.getByRole('heading', { name: 'Top moments today' })).toBeVisible()
  await expect(top.getByRole('link', { name: 'All moments →' })).toHaveAttribute('href', '/analytics/moments')
  const rows = top.locator('.hv5-tm-list > .hv5-tm-it')
  await expect(rows.first()).toContainText('xQc')
  expect(await rows.count()).toBeLessThanOrEqual(5)
  // the carousel is retired (H1): nothing turns on its own
  await expect(page.locator('#big-moments, .hv5-bm-card')).toHaveCount(0)
  const rail = page.locator('#latest')
  await expect(rail.getByRole('heading', { name: 'Picking up now' })).toBeVisible()
  await expect(rail.locator('.hv5-tm-it')).toHaveCount(0)
  const xs = (await rail.locator('.hv5-fd-list .hv5-f2-x b').allTextContents()).map(t => Number.parseFloat(t))
  expect(xs).toEqual([...xs].sort((p, q) => q - p))
  // every row in the rail from 1100 px, none behind a button
  await expect(rail.getByRole('button', { name: /^Show all/ })).toHaveCount(0)
  await rows.first().getByRole('link').click()
  await expect(page).toHaveURL(/\/analytics\/moments\?login=xqc&stream=s1&offset=3600$/)
})

// Board 2A (11-02): here the mock's two moments are 2 and 4 minutes into their streams, so
// they show their rate and no ×. Inside a stream's first 5 minutes they carry pulse-core's
// 'Stream start' tag rather than 'Early in the stream' (E1, 11-13). The locks' warm-up reads
// hub/moments on its own; another channel's busiest minute from those reads fills a
// row while the hub has fewer than five, and a channel already shown (xQc) never gets a second one.
test('Top moments today keeps early moments with no × and fills with busiest minutes from the chart’s own reads', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await installHubUxMock(page, { featuredSession: READY_FEATURED_SESSION, momentOffsets: [120, 240] })
  const now = Date.now()
  const busy = (login: string, displayName: string, chatPerMin: number) => ({
    login, displayName, streamId: `hist-${login}`, offsetSeconds: 1800, score: 80, label: 'Corpus peak', source: 'corpus',
    confidence: 90, vodState: 'vod_ready', chatPerMin, at: now - 3 * 60 * 60 * 1000,
    topEmotes: [{ name: 'KEKW', provider: '7tv', count: 12, sharePct: 18 }],
  })
  await page.route(/\/v1\/public\/hub\/moments(\?.*)?$/, route => route.fulfill({
    json: { status: 'ready', moments: [busy('kaicenat', 'KaiCenat', 1204), busy('xqc', 'xQc', 9000)] },
  }))
  await page.goto('/analytics')
  const top = page.locator('#top-moments')
  const rows = top.locator('.hv5-tm-list > .hv5-tm-it')
  await expect(rows.filter({ has: page.locator('.hv5-f2-why', { hasText: 'Stream start' }) })).toHaveCount(2)
  const fill = rows.filter({ has: page.locator('.hv5-f2-why', { hasText: 'Busiest minute' }) })
  await expect(fill).toHaveCount(1, { timeout: 15_000 })
  await expect(fill).toContainText('KaiCenat')
  await expect(fill.locator('.hv5-f2-rt')).toHaveText('1,204 chat/min')
  await expect(rows.filter({ hasText: 'xQc' })).toHaveCount(1)
  await expect(top.locator('.hv5-f2-x b', { hasText: '×' })).toHaveCount(0)
})

test('the chart (i) opens How this is measured with the served-window facts', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openV5Hub(page)
  const measured = page.locator('details#measured')
  await expect(measured).not.toHaveAttribute('open', /.*/)
  await page.locator('.figma-global-activity__hub-chart .hub-act-info button').click()
  await page.locator('[data-hub-toggletip-pop]').getByRole('link', { name: 'How this is measured' }).click()
  await expect(measured).toHaveAttribute('open', '')
  await expect(measured.locator('summary')).toBeFocused()
  await expect(measured.locator('.hv5-dis-body li').first()).toBeVisible()
})

// The buckets rule (board pick 5): below 95% of the chart's buckets, one grey line directly under the
// chart; 95% or more, nothing; and never an amber "Activity coverage ... buckets" row in the banner.
async function openHubKeepingBuckets(page: Page, keep: (index: number) => boolean) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installHubUxMock(page, { keepActivityBucket: keep })
  await page.goto('/analytics')
  await expect(page.locator('.figma-global-activity__hub-chart h2')).toHaveText('Activity · last 24 h')
  await expect(page.getByTestId('hub-data-age')).toBeVisible()
}

test("below 95% of the chart's buckets, one grey line sits directly under the chart and nothing amber says buckets", async ({ page }) => {
  await openHubKeepingBuckets(page, index => index % 10 !== 5)
  const note = page.getByTestId('hub-minutes-missing-note')
  await expect(note).toHaveText('A few minutes are missing from this chart.')
  const chart = (await box(page, '.figma-global-activity__hub-chart'))
  const noteBox = (await note.boundingBox())!
  // Directly under the chart card (the caption style tucks its top 3 px up under the card's edge),
  // above the data age line, in the grey caption colour.
  expect(noteBox.y).toBeGreaterThanOrEqual(chart.y + chart.height - 4)
  expect(noteBox.y - (chart.y + chart.height)).toBeLessThan(24)
  expect((await box(page, '[data-testid="hub-data-age"]')).y).toBeGreaterThan(noteBox.y)
  expect(await note.evaluate(element => getComputedStyle(element).color)).toBe('rgba(255, 255, 255, 0.62)')
  await expect(page.locator('.hx-health-banner').getByText(/Activity coverage|buckets|rollups/)).toHaveCount(0)
  await expect(page.getByText(/Activity coverage/)).toHaveCount(0)
})

test("at 95% or more of the chart's buckets, the page says nothing about buckets", async ({ page }) => {
  await openHubKeepingBuckets(page, index => index % 48 !== 5)
  await expect(page.getByTestId('hub-minutes-missing-note')).toHaveCount(0)
  await expect(page.getByText(/Activity coverage|buckets missing|A few minutes/)).toHaveCount(0)
})

test('with every bucket there, the page says nothing about buckets either', async ({ page }) => {
  await openHubKeepingBuckets(page, () => true)
  await expect(page.getByTestId('hub-minutes-missing-note')).toHaveCount(0)
  await expect(page.getByText(/Activity coverage|buckets missing|A few minutes/)).toHaveCount(0)
})

// Phone round (11-02): on a phone the promo is a compact card (title, the desktop line, See how it works) that opens to
// the scene and the line under it (A); Find emote has a × that clears it (X1); the hero search says what it finds (Q1).
test('on a phone the promo opens on See how it works, and Find emote clears with its ×', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 390, height: 844 })
  await openV5Hub(page, { bucketEmoteDetail: true })
  const promo = page.locator('.hv5-mast .hv5-promo')
  const more = promo.getByRole('button', { name: 'See how it works' })
  await expect(promo.locator('.hv5-pr-h')).toBeVisible()
  await expect(promo.locator('.hv5-pr-sub')).toHaveText('Desktop extension for Chrome, Edge and Firefox · Free')
  await expect(more).toHaveAttribute('aria-expanded', 'false')
  for (const selector of ['.hv5-pr-stage', '.hv5-pr-p', '.hv5-hero-install', '.hv5-pr-desk', '.hv5-pr-free']) await expect(promo.locator(selector)).toBeHidden()
  expect((await more.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  expect((await promo.boundingBox())!.height).toBeLessThanOrEqual(120)
  await more.click()
  await expect(more).toHaveAttribute('aria-expanded', 'true')
  await expect(promo).toHaveAttribute('data-open', '')
  await expect(promo.locator('.hv5-pr-stage')).toBeVisible()
  await expect(promo.locator('.hv5-pr-p')).toBeVisible()
  await noSideScroll(page)
  await more.click()
  await expect(more).toHaveAttribute('aria-expanded', 'false')
  await expect(promo.locator('.hv5-pr-stage')).toBeHidden()

  const input = page.getByRole('combobox', { name: 'Search streamers or games' })
  await expect(input).toHaveAttribute('placeholder', 'Streamers or games')

  const emotes = page.locator('#emotes')
  await expect(emotes.locator('.hv5-em-t').first()).toBeVisible()
  const find = emotes.getByRole('searchbox', { name: 'Find emote on the map' })
  const clear = emotes.getByRole('button', { name: 'Clear emote search' })
  await expect(clear).toHaveCount(0)
  await find.fill('KEKW')
  await expect(emotes.locator('.hv5-em-ly:not([data-out]) > .hv5-em-t[data-found]')).toHaveAttribute('aria-label', /KEKW/)
  await clear.click()
  await expect(find).toHaveValue('')
  await expect(find).toBeFocused()
  await expect(clear).toHaveCount(0)
  await expect(emotes.locator('.hv5-em-ly:not([data-out]) > .hv5-em-t[data-found]')).toHaveCount(0)
  await noSideScroll(page)

  // a desktop gets the original card again (O1, 11-16): the panel's pictures beside the title, the line and the same
  // install button; no scene, no phone line or button. Reduced motion keeps the first picture and shows no dots.
  await page.setViewportSize({ width: 1440, height: 900 })
  const frames = promo.locator('.hv5-pr-frames')
  await expect(frames).toBeVisible()
  await expect(frames.locator('img')).toHaveCount(3)
  await expect(frames.locator('img.on')).toHaveCount(1)
  await expect(frames.locator('img').first()).toHaveClass('on')
  await expect(frames.locator('.hv5-pr-frame-dots')).toHaveCount(0)
  await expect(promo.locator('.hv5-pr-h')).toBeVisible()
  await expect(promo.locator('.hv5-pr-p')).toBeVisible()
  await expect(promo.locator('.hv5-hero-install')).toBeVisible()
  await expect(promo.locator('.hv5-hero-install')).toHaveAttribute('data-cta', 'chrome-install-hub-hero')
  for (const selector of ['.hv5-pr-stage', '.hv5-pr-sub']) await expect(promo.locator(selector)).toBeHidden()
  await expect(more).toBeHidden()
  expect((await promo.boundingBox())!.height).toBeLessThanOrEqual(216)
  await noSideScroll(page)
})

test('a Top moments row on a phone keeps its time whole; the game and the reason give way first (11-14)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openV5Hub(page, TOP_MOMENT)
  const row = page.locator('#top-moments .hv5-tm-list > .hv5-tm-it').first()
  await expect(row.locator('.hv5-tm-t')).toHaveText(/\S/)
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    await expect.poll(() => row.evaluate(el => {
      const time = el.querySelector<HTMLElement>('.hv5-tm-t')!, at = time.getBoundingClientRect(), box = el.getBoundingClientRect()
      return at.width > 0 && at.left >= box.left - 0.5 && at.right <= box.right + 0.5 && time.scrollWidth <= time.clientWidth + 1
    }), { message: `the time is whole at ${width}px` }).toBe(true)
  }
})
