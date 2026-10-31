import { expect, test, type Page } from '@playwright/test'
import { installHubUxMock, READY_FEATURED_SESSION, type HubUxMockOptions } from './helpers/hubUxMock'

// The page around the chart (d3-v5 mockup, round 5): the search hero, Busiest
// now, the Featured stream under it, Top moments today beside or under the chart,
// Top emotes, Where chat is, Channels and How this is measured. The shared mock
// has no screener windows, so this spec serves the same reply with one per
// channel: three games, one channel with viewers only and one whose average is
// too short to compare. With the check working, the reply also names xQc as its
// featured stream, as production's replies do (picks I1 and I1b, 10-30).

const GAMES = ['Just Chatting', 'Just Chatting', 'Just Chatting', 'Minecraft', 'Just Chatting', 'Minecraft', 'Valorant', 'Just Chatting', 'Minecraft', 'Valorant', 'Just Chatting', 'Minecraft', 'Valorant', 'Just Chatting']

// Top moments today lists, from the hub, a moment from 20 minutes into its stream that rose
// 1.5x or more over that stream's own average. The mock's moments are 2 and 4 minutes in with
// no comparison, so a spec that needs a moment row serves the first one an hour in, compared.
const TOP_MOMENT: HubUxMockOptions = { withComparisons: true, momentOffsets: [3600, 3600] }

async function openV5Hub(page: Page, options: HubUxMockOptions = {}) {
  await installHubUxMock(page, { featuredSession: READY_FEATURED_SESSION, ...options })
  const first = page.waitForResponse(response => /\/v1\/public\/hub\?/.test(response.url()))
  await page.goto('/analytics')
  const payload = await (await first).json()
  const end = Math.floor(Date.now() / 60_000) * 60_000 - 60_000
  payload.liveChannels = payload.liveChannels.map((channel: Record<string, unknown>, index: number) => {
    const next = { ...channel, category: GAMES[index] }
    if (index === 13) return { ...next, coverageState: 'viewers_only' }
    const chat = 400 - index * 20
    const x = index === 2 ? 3.4 : 1 + (index % 4) * 0.4
    const baselineMinutes = index === 12 ? 8 : 60
    return {
      ...next,
      screener: {
        version: 1,
        baselineKind: 'current_stream_measured_average',
        state: 'ready',
        measuredAt: end,
        currentWindow: { start: end - 5 * 60_000, end, expectedMinutes: 5, measuredMinutes: 5, coveragePct: 100 },
        baselineWindow: { start: end - 65 * 60_000, end: end - 5 * 60_000, expectedMinutes: 60, measuredMinutes: baselineMinutes, coveragePct: 100 },
        chat: { state: 'ready', currentPerMin: chat, baselinePerMin: chat / x, multiplier: x, baselineMeasuredMinutes: baselineMinutes },
        emotes: null,
      },
    }
  })
  await page.route(/\/v1\/public\/hub(\?.*)?$/, route => route.fulfill({ json: payload }))
  await page.reload()
  await expect(page.locator('[data-hub-v5-page] .hv5-bzc-it').first()).toBeVisible()
  return payload
}

async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
}

const box = async (page: Page, selector: string) => (await page.locator(selector).boundingBox())!

// After a resize the chart re-measures and, a frame later, the search hero grows; every row
// below moves (about 36 px at 1440), so each layout check retries until the boxes agree.
const SETTLED = { timeout: 10_000 }

// The page has two sets of grid templates, with and without the Featured stream card (an answer with no ready featured
// stream, a saved copy or totals only), so the order and columns are checked both ways.
for (const [label, featuredSession] of [['with', READY_FEATURED_SESSION], ['without', undefined]] as const) {
  test(`sections stack in the mockup order on a phone and sit in their columns on desktop, ${label} the Featured stream`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width: 390, height: 844 })
    await openV5Hub(page, { featuredSession })
    await expect(page.getByRole('heading', { level: 1, name: 'Find your streamer' })).toBeVisible()
    await expect(page.locator('.hv5-most')).toHaveCount(featuredSession ? 1 : 0)
    const order = ['.hv5-mast', '#busiest', ...(featuredSession ? ['.hv5-most'] : []), '#activity', '#latest', '#emotes', '#games', '#channels', '#measured']
    await expect(async () => {
      const tops: number[] = []
      for (const selector of order) tops.push((await box(page, selector)).y)
      expect(tops).toEqual([...tops].sort((a, b) => a - b))
    }).toPass(SETTLED)
    await noSideScroll(page)

    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(async () => {
      const [latest, emotes, games] = [await box(page, '#latest'), await box(page, '#emotes'), await box(page, '#games')]
      expect(Math.abs(latest.y - emotes.y)).toBeLessThanOrEqual(1)
      expect(Math.abs(emotes.y - games.y)).toBeLessThanOrEqual(1)
      expect(latest.x + latest.width).toBeLessThanOrEqual(emotes.x + 1)
      expect(emotes.x + emotes.width).toBeLessThanOrEqual(games.x + 1)
    }).toPass(SETTLED)
    await noSideScroll(page)

    await page.setViewportSize({ width: 1920, height: 1000 })
    await expect(async () => {
      const [activity, rail] = [await box(page, '#activity'), await box(page, '#latest')]
      expect(rail.x).toBeGreaterThanOrEqual(activity.x + activity.width - 1)
      const [emotesWide, gamesWide] = [await box(page, '#emotes'), await box(page, '#games')]
      expect(Math.abs(emotesWide.y - gamesWide.y)).toBeLessThanOrEqual(1)
      expect(emotesWide.y).toBeGreaterThanOrEqual(activity.y + activity.height - 1)
    }).toPass(SETTLED)
    await noSideScroll(page)
  })
}

test('the Featured stream sits under Busiest now with its moments and no chat/min while the 5-minute check works', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 360, height: 780 })
  await openV5Hub(page)
  const card = page.locator('.hv5-most')
  await expect(card.getByRole('heading', { name: 'Featured stream' })).toBeVisible()
  // the live row's name and game, as Busiest now shows them (the stored record says XQC, Grand Theft Auto V)
  await expect(card.locator('.hv5-mst-l1')).toHaveText('xQc · Just Chatting · 12,000 watching')
  await expect(page.locator('#busiest li[data-rank="1"] .hv5-bzt-cat')).toHaveText('Just Chatting')
  // Busiest now names xQc's 5-minute count (400); the card's average (200) would be a second rate for one stream
  await expect(page.locator('#busiest li[data-rank="1"]')).toHaveAttribute('data-login', 'xqc')
  await expect(card.locator('.hv5-mst-l2')).toHaveCount(0)
  await expect(card).not.toContainText(/chat\/min|200/)
  await expect(card.locator('.hv5-mst-mo')).toHaveText(['0:13:54 YappingDuck 930', '1:35:54 NotLikeThis 1,286', '0:41:54 YappingDuck 319'])
  await expect(card.getByRole('link', { name: 'Open stream: xQc' })).toHaveAttribute('href', '/analytics/xqc/s1')

  // one column on a phone, then the main column on desktop, then beside the rail on a wide screen; each side of the
  // card's template breakpoints (720, 1100, 1536)
  for (const [width, height] of [[360, 780], [719, 900], [720, 900], [1099, 900], [1100, 900], [1535, 900], [1536, 900], [1920, 1000]]) {
    await page.setViewportSize({ width, height })
    await expect(async () => {
      const [busiest, most, activity] = [await box(page, '#busiest'), await box(page, '.hv5-most'), await box(page, '#activity')]
      expect(most.y).toBeGreaterThanOrEqual(busiest.y + busiest.height - 1)
      expect(activity.y).toBeGreaterThanOrEqual(most.y + most.height - 1)
      expect(Math.abs(most.x - activity.x)).toBeLessThanOrEqual(1)
      expect(Math.abs(most.width - activity.width)).toBeLessThanOrEqual(1)
      if (width >= 1536) expect(most.x + most.width).toBeLessThanOrEqual((await box(page, '#latest')).x + 1)
    }).toPass(SETTLED)
    await noSideScroll(page)
  }
})

test('the Featured stream holds its place while the hub loads, so nothing under it moves when it lands (pick K1, 10-30)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const payload = await openV5Hub(page)
  // a first visit (nothing saved) and a return visit (the saved copy while the read runs) at two templates; the reply
  // waits until the block is measured
  for (const [visit, width, height] of [['first', 1440, 900], ['return', 1440, 900], ['first', 1920, 1000]] as const) {
    await page.setViewportSize({ width, height })
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    await page.route(/\/v1\/public\/hub(\?.*)?$/, async (route) => { await held; await route.fulfill({ json: payload }) })
    if (visit === 'first') await page.evaluate(() => localStorage.clear())
    await page.reload()
    const wait = page.locator('.hv5-most.hv5-mst-wait')
    await expect(wait).toHaveAttribute('aria-hidden', 'true')
    await expect(page.locator('#busiest .hv5-bzs-wait')).toBeVisible()
    let before = { height: 0, gap: 0 }
    await expect(async () => {
      const [w, activity] = [await box(page, '.hv5-mst-wait'), await box(page, '#activity')]
      before = { height: w.height, gap: activity.y - w.y }
      expect(w.height).toBeGreaterThan(40)
    }).toPass(SETTLED)
    release()
    await expect(page.locator('.hv5-most .hv5-mst-nm')).toHaveText('xQc')
    await expect(wait).toHaveCount(0)
    await expect(async () => {
      const [card, activity] = [await box(page, '.hv5-most'), await box(page, '#activity')]
      expect([visit, width, Math.round(card.height), Math.round(activity.y - card.y)]).toEqual([visit, width, Math.round(before.height), Math.round(before.gap)])
    }).toPass(SETTLED)
  }
})

test('the hero search lists live channels, filters as you type and opens the pick', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openV5Hub(page)
  const input = page.getByRole('combobox', { name: /search/i })
  await page.keyboard.press('Control+k')
  await expect(input).toBeFocused()
  const list = page.getByRole('listbox', { name: 'Channels' })
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

test('Busiest now shows Twitch’s live picture while Live and keeps the face for a channel Twitch shows offline', async ({ page }) => {
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
  await expect(tiles.first().locator('a')).toHaveAttribute('aria-label', /\. Twitch’s live picture, can be a few minutes old\.$/)
  // the second channel's picture is Twitch's offline one: its face stays
  await expect(tiles.nth(1).locator('img.hv5-bzv-prev')).toHaveCount(0)
  await expect(tiles.nth(1).locator('a')).toHaveAttribute('aria-label', /\. Profile picture\.$/)
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
  await expect(channels.locator('[data-hv5-channel-count]')).toHaveText('14 of 96 live')
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

test('a Top moments row opens under itself, closes on a second click and Escape, and links to the minute', async ({ page }) => {
  // No drop-in, so the opened numbers are measured where they settle.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await openV5Hub(page, TOP_MOMENT)
  // The opened row's one stream-record read: a VOD with verified timing, so Watch lands on the minute.
  await page.route(/\/v1\/portal\/analytics\/streams\/s1(\?.*)?$/, route => route.fulfill({
    json: { channel: 'xqc', vodId: '2000000001', vodAlignSeconds: 30, vodDurationSeconds: 7200, vodTiming: { state: 'verified' }, stream: { streamId: 's1', login: 'xqc' } },
  }))
  const latest = page.locator('#latest')
  await expect(latest.getByRole('heading', { name: 'Top moments today' })).toBeVisible()
  const item = latest.locator('.hv5-tm-list > .hv5-tm-it').first()
  const row = item.locator('.hv5-tm-row')
  await row.scrollIntoViewIfNeeded()
  await expect(row).toContainText('xQc')
  await expect(row).toHaveAttribute('aria-expanded', 'false')
  const open = item.locator('.hv5-tm-det')
  await row.click()
  await expect(open).toBeVisible()
  await expect(row).toHaveAttribute('aria-expanded', 'true')
  // Under the row, never over it, so the row keeps the click.
  const rowBox = (await row.boundingBox())!
  expect((await open.boundingBox())!.y).toBeGreaterThanOrEqual(rowBox.y + rowBox.height - 1)
  // An hour in plus the VOD's 30 s, from 10 s before, as Moments plays it.
  await expect(open.getByRole('link', { name: /^Watch the moment/ })).toHaveAttribute('href', /\/videos\/2000000001\?t=1h0m20s$/)
  await row.click()
  await expect(open).toHaveCount(0)
  await row.click()
  await expect(open).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(open).toHaveCount(0)
  await row.click()
  await open.getByRole('link', { name: 'Open in Moments' }).click()
  await expect(page).toHaveURL(/\/analytics\/moments\?login=xqc&stream=s1&offset=3600$/)
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
