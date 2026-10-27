import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  PORTAL_STARTED_AT,
  PORTAL_VOD_ID,
  buildDetail,
  buildMinutes,
  buildRecap,
  buildStatus,
  buildStreamRecord,
  installPortalAcceptanceHarness,
  openAnalyticsSession,
} from './helpers/portalAcceptanceHarness'

// U11 (plan §1.8, "U11 Moment rows"): the session page's Moments list is the
// d3-v2 session-original row list (moment-rows.js), not prod's old #N cards.
// Rows: rank, offset, reason pill, reaction score, game + emote line, rate and
// a ±8 min spark, blurred game box art behind (F6: never a live frame).
// Since 2026-10-16 the top three are the highlight reel (recap-r1 C1, MomentReel.tsx):
// #1 a large card, #2 and #3 side by side, each the moment's VOD preview frame or
// the game's blurred box art; rows start at #4, behind "Show N more moments".
const LIST = '[data-moment-list]'
const ROW = '[data-moment-row]'
const REEL = '[data-moment-reel]'
const CARD = '[data-moment-card]'
const LIST_ROW = `${ROW}:not([data-moment-card])`
const MORE = '[data-moment-list-more]'
const CLEAR = 'button[aria-label="Clear selected moment"]'
const MINUTES = 60
const OFFSETS = [240, 600, 900, 1200, 1500, 1800, 2100, 2400]
// The 240 s moment is the best scored, but it is in the stream's first 5 minutes, a hello spike:
// it ranks after every real moment, so the reel starts at 0:10:00 and 0:04:00 is the last row.

function recap(extra: Record<string, unknown> = {}) {
  return buildRecap({
    ...extra,
    durationSeconds: MINUTES * 60,
    topMoments: OFFSETS.map((offsetSeconds, index) => ({
      offsetSeconds,
      score: 92 - index * 3,
      reasons: [index % 2 === 0 ? 'emote_spike' : 'chat_spike'],
      chatCount: 120,
      emoteCount: 60,
      viewerCount: 11_000,
      peakObservation: {
        state: 'measured',
        observedAt: new Date(Date.parse(PORTAL_STARTED_AT) + offsetSeconds * 1000).toISOString(),
        confirmed: true,
        detector: 'fixture:confirmed_peak',
        value: 92 - index * 3,
        source: 'fixture',
        coveragePct: 100,
      },
    })),
  })
}

// The harness installs a fake clock: let React commit, then run frames and timers.
async function settle(page: Page, ms = 600) {
  await page.waitForTimeout(50)
  const clock = page.clock as { runFor?: (ms: number) => Promise<void> }
  if (typeof clock.runFor === 'function') await clock.runFor(ms)
}

// 120 s verified alignment (as the bar-strip spec): moment 1 at 600 s asks the tile under VOD 750 s.
const VERIFIED_VOD = {
  vodId: PORTAL_VOD_ID,
  vodAlignSeconds: 120,
  vodDurationSeconds: MINUTES * 60,
  vodTiming: { state: 'verified' },
  availability: { liveDvrState: 'ended', vodState: 'linked', vodId: PORTAL_VOD_ID, chartState: 'usable', chartUsable: true },
}
const TILE_SEC = 249
const SHEET_HOST = 'https://d2vi6trrdongqn.cloudfront.net'
const SHEET_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/** The storyboard-thumb route in its post-F6 shape (5×10 tiles of 220×124, one every 249 s); sheets are a 1 px PNG. */
async function stubStoryboard(page: Page) {
  const asked: number[] = []
  await page.route(/\/v1\/analytics\/vods\/\d+\/storyboard-thumb\?/, async (route) => {
    const offsetSec = Number(new URL(route.request().url()).searchParams.get('offsetSec'))
    asked.push(offsetSec)
    if (!(offsetSec >= 0 && offsetSec < MINUTES * 60)) {
      await route.fulfill({ status: 404, json: { reason: 'offset_out_of_range' } })
      return
    }
    const index = Math.floor(offsetSec / TILE_SEC)
    const within = index % 50
    await route.fulfill({
      json: {
        sheetUrl: `${SHEET_HOST}/fixture_xqc/storyboards/${PORTAL_VOD_ID}-high-${Math.floor(index / 50)}.jpg`,
        sheetWidth: 1100,
        sheetHeight: 1240,
        cropX: (within % 5) * 220,
        cropY: Math.floor(within / 5) * 124,
        cropW: 220,
        cropH: 124,
        frameIndex: index,
        intervalMilliseconds: TILE_SEC * 1000,
      },
    })
  })
  await page.route(`${SHEET_HOST}/**`, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: SHEET_PNG }))
  return asked
}

// beforeOpen runs after the harness: a route added then wins over the harness's catch-all.
async function open(page: Page, recapExtra: Record<string, unknown> = {}, opts: { verifiedVod?: boolean; beforeOpen?: () => Promise<unknown> } = {}) {
  const harness = await installPortalAcceptanceHarness(page)
  harness.setMinutesPayload(buildMinutes({ count: MINUTES, withEmotes: true }))
  harness.setRecapPayload(recap(recapExtra))
  if (opts.verifiedVod) {
    harness.detail.setFallback({
      kind: 'json',
      body: buildDetail({
        state: 'ended',
        ...VERIFIED_VOD,
        stream: buildStreamRecord({ endedAt: '2026-07-26T04:00:00.000Z', vodId: PORTAL_VOD_ID }),
      }),
    })
    harness.status.setFallback({ kind: 'json', body: buildStatus({ state: 'ended', ...VERIFIED_VOD }) })
  }
  await opts.beforeOpen?.()
  await openAnalyticsSession(page)
  await expect(page.locator(ROW).first()).toBeVisible({ timeout: 30_000 })
  await settle(page)
  return harness
}

const row = (page: Page, rank: number) => page.locator(`${ROW}[data-moment-rank="${rank}"]`)
const showRest = async (page: Page) => {
  await page.locator(MORE).click()
  // Off the footer: once open, row 4 sits where the button was.
  await page.mouse.move(2, 2)
  await settle(page)
}
const pressed = (page: Page) => page.locator(ROW).evaluateAll(rows => rows.map(r => r.getAttribute('aria-pressed')))
const box = (loc: Locator) => loc.evaluate(el => {
  const r = el.getBoundingClientRect()
  return { w: r.width, h: r.height }
})

test.describe('session Moments rows (d3-v2) at 1440', () => {
  test.use({ viewport: { width: 1440, height: 900 }, contextOptions: { reducedMotion: 'reduce' } })

  test("the top three are the highlight reel: rank, time, reason, score, no prod #N cards", async ({ page }) => {
    await open(page)
    const region = page.getByRole('region', { name: 'Pulse moments recap' })
    await expect(region).toHaveCount(1)
    await expect(region).not.toContainText('#1')
    await expect(region).not.toContainText('Select a moment to review its minute')
    await expect(region).not.toContainText('usual')

    // The top 3 show collapsed (Aron 2026-10-15), as the reel; the footer counts the rest.
    await expect(page.locator(REEL)).toHaveCount(1)
    const cards = await page.locator(CARD).evaluateAll(els => els.map(el => [el.getAttribute('data-moment-card'), el.getAttribute('data-moment-rank')]))
    expect(cards).toEqual([['hero', '1'], ['small', '2'], ['small', '3']])
    await expect(page.locator(LIST_ROW)).toHaveCount(0)

    const first = row(page, 1)
    await expect(first.locator('.ssr-off')).toHaveText('0:10:00')
    await expect(first.locator('.ssr-why')).toHaveText('Chat spike')
    await expect(row(page, 2).locator('.ssr-why')).toHaveText('Emote spike')
    await expect(first.locator('.ssr-sc b')).toHaveText('89')
    await expect(row(page, 3).locator('.ssr-sc b')).toHaveText('83')
    await expect(first).toHaveAccessibleName(/^Moment 1 0:10:00 /)
    // F8: the backend label and score only; no rate or spark on a card.
    await expect(page.locator(`${CARD} .ssr-rt, ${CARD} svg.ssr-msp`)).toHaveCount(0)

    // 16:9 pictures, 8 px radius and weight 400 (the console's button reset would make them 6 px and 600);
    // #1 is the big one, #2 and #3 share the other column at 1440.
    const style = await first.evaluate(el => {
      const cs = getComputedStyle(el)
      return { radius: cs.borderTopLeftRadius, weight: cs.fontWeight }
    })
    expect(style).toEqual({ radius: '8px', weight: '400' })
    const hero = await box(first)
    const small = await box(row(page, 2))
    expect(Math.abs(hero.w / hero.h - 16 / 9)).toBeLessThan(0.05)
    expect(Math.abs(small.w / small.h - 16 / 9)).toBeLessThan(0.05)
    expect(hero.w).toBeGreaterThan(small.w * 1.5)

    // No reduced-motion glow, and no frame without a verified VOD: the picture is box art (F6).
    await expect(page.locator('[data-moment-row-pop]')).toHaveCount(0)
    await expect(page.locator('[data-moment-card-frame]')).toHaveCount(0)
    expect(await page.locator(CARD).evaluateAll(els => els.map(el => el.getAttribute('data-moment-frame')))).toEqual(['fallback', 'fallback', 'fallback'])
    const srcs = await page.locator(`${CARD} img.ssr-rc-art`).evaluateAll(els => els.map(el => el.getAttribute('src') ?? ''))
    for (const src of srcs) expect(src.startsWith('https://static-cdn.jtvnw.net/ttv-boxart/')).toBe(true)
    await expect(page.locator('[data-moment-reel-note]')).toHaveText("Pictures are the game's box art: no VOD preview frames for this stream.")
  })

  test('rows from #4 keep the rate and the ±8 min spark', async ({ page }) => {
    await open(page)
    await showRest(page)
    const fourth = row(page, 4)
    await expect(fourth).not.toHaveAttribute('data-moment-card')
    await expect(fourth.locator('.ssr-off')).toHaveText('0:25:00')
    await expect(fourth.locator('.ssr-rt')).toContainText('emotes/min')
    await expect(row(page, 5).locator('.ssr-rt')).toContainText('chat/min')
    // The hello spike, scored 92, comes last.
    await expect(row(page, OFFSETS.length).locator('.ssr-off')).toHaveText('0:04:00')
    await expect(row(page, OFFSETS.length).locator('.ssr-sc b')).toHaveText('92')

    // ±8 min spark: measured minutes around the moment, the moment bar highlighted.
    const bars = await fourth.locator('svg.ssr-msp rect').count()
    expect(bars).toBeGreaterThan(8)
    expect(bars).toBeLessThanOrEqual(17)
    await expect(fourth.locator('svg.ssr-msp rect.at')).toHaveCount(1)

    // The mockup's row box: 8 px radius, #0c0c0e, 72-84 px tall by column width.
    const style = await fourth.evaluate(el => {
      const cs = getComputedStyle(el)
      return { radius: cs.borderTopLeftRadius, bg: cs.backgroundColor }
    })
    expect(style).toEqual({ radius: '8px', bg: 'rgb(12, 12, 14)' })
    expect(await fourth.locator('.ssr-gm-n, .ssr-sc').first().evaluate(el => getComputedStyle(el).fontWeight)).toBe('400')
    const size = await box(fourth)
    expect(size.h).toBeGreaterThanOrEqual(70)
    expect(size.h).toBeLessThanOrEqual(86)
    const srcs = await page.locator(`${LIST_ROW} .ssr-fr img, ${LIST_ROW} .ssr-gm img`).evaluateAll(els => els.map(el => el.getAttribute('src') ?? ''))
    for (const src of srcs) expect(src.startsWith('https://static-cdn.jtvnw.net/ttv-boxart/')).toBe(true)
  })

  test('the footer shows the rest and folds them back', async ({ page }) => {
    await open(page)
    const shown = await page.locator(ROW).count()
    const more = page.locator(MORE)
    if (shown >= OFFSETS.length) {
      await expect(more).toHaveCount(0)
      return
    }
    const rest = OFFSETS.length - shown
    await expect(more).toHaveText(`Show ${rest} more moment${rest === 1 ? '' : 's'}`)
    await expect(more).toHaveAttribute('aria-expanded', 'false')
    await more.click()
    await settle(page)
    await expect(page.locator(ROW)).toHaveCount(OFFSETS.length)
    await expect(more).toHaveText('Show fewer moments')
    await more.click()
    await settle(page)
    await expect(page.locator(ROW)).toHaveCount(shown)
  })

  test('a row click locks the moment on the chart; clearing the chart drops the ring', async ({ page }) => {
    await open(page)
    expect((await pressed(page)).every(v => v === 'false')).toBe(true)
    await row(page, 2).click()
    await settle(page)
    const after = await pressed(page)
    expect(after[1]).toBe('true')
    expect(after.filter(v => v === 'true')).toHaveLength(1)
    await expect(row(page, 2)).toHaveClass(/\blk\b/)
    // Strip mode pins the moment on the chart (the readout's Clear appears).
    await expect(page.locator(CLEAR)).toBeVisible()
    await page.locator(CLEAR).click()
    await settle(page)
    expect((await pressed(page)).every(v => v === 'false')).toBe(true)
    // A second click on the locked row releases it.
    await row(page, 3).click()
    await settle(page)
    await expect(row(page, 3)).toHaveAttribute('aria-pressed', 'true')
    await row(page, 3).click()
    await settle(page)
    expect((await pressed(page)).every(v => v === 'false')).toBe(true)
    await expect(page.locator(CLEAR)).toHaveCount(0)
  })

  test('keyboard focus shows the ring and Enter locks', async ({ page }) => {
    await open(page)
    await row(page, 1).focus()
    const outline = await row(page, 1).evaluate(el => getComputedStyle(el).outlineStyle)
    expect(outline).not.toBe('none')
    await page.keyboard.press('Enter')
    await settle(page)
    await expect(row(page, 1)).toHaveAttribute('aria-pressed', 'true')
  })
})

// These need the page to pass the stream's games (and VOD) to the list: the
// game line, box-art backdrop, hover dwell and preview frames come from them.
test.describe('session Moments rows: game art and dwell', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('the reel shows the game and its blurred box art; a row hovered 350 ms lights up', async ({ page }) => {
    await open(page)
    const first = row(page, 1)
    await expect(first.locator('.ssr-rc-gm'), 'the page passes games= to SessionRecapMomentsStrip').toHaveText('Just Chatting')
    await expect(first).toHaveClass(/\bhas-art\b/)
    const art = first.locator('img.ssr-rc-art')
    await expect(art).toHaveAttribute('src', /^https:\/\/static-cdn\.jtvnw\.net\/ttv-boxart\//)
    expect(await art.evaluate(el => getComputedStyle(el).filter)).toContain('blur(16px)')

    await showRest(page)
    const fourth = row(page, 4)
    await expect(fourth.locator('.ssr-gm-n')).toHaveText('Just Chatting')
    await expect(fourth).toHaveClass(/\bhas-bd\b/)
    const rowArt = fourth.locator('img.ssr-fr-art')
    await expect(rowArt).toHaveAttribute('src', /^https:\/\/static-cdn\.jtvnw\.net\/ttv-boxart\//)
    expect(await rowArt.evaluate(el => getComputedStyle(el).filter)).toContain('blur(14px)')

    // Hold the fake clock so the 350 ms dwell is measured on it, not on wall time.
    const now = await page.evaluate(() => Date.now())
    await page.clock.pauseAt(now + 1000)
    await fourth.hover()
    await page.clock.runFor(340)
    await expect(fourth).not.toHaveClass(/\blit\b/)
    await page.clock.runFor(20)
    await expect(fourth).toHaveClass(/\blit\b/)
    await page.mouse.move(2, 2)
    await page.clock.runFor(20)
    await expect(fourth).not.toHaveClass(/\blit\b/)
    await page.clock.resume()
  })

  test('the play button shows only when the stream has a VOD', async ({ page }) => {
    await open(page)
    // The fixture stream has no VOD yet: no play affordance on any card or row.
    await expect(page.locator('[data-moment-row-play]')).toHaveCount(0)
  })

  test('with a VOD every card gets the round play button; pressing it locks the moment', async ({ page }) => {
    await open(page, { vodId: PORTAL_VOD_ID })
    const shown = await page.locator(ROW).count()
    await expect(page.locator(`${ROW} [data-moment-row-play]`)).toHaveCount(shown)
    expect((await box(row(page, 1).locator('[data-moment-row-play]'))).w).toBe(32)
    expect((await box(row(page, 2).locator('[data-moment-row-play]'))).w).toBe(26)
    await row(page, 2).locator('[data-moment-row-play]').click()
    await settle(page)
    await expect(row(page, 2)).toHaveAttribute('aria-pressed', 'true')
    await showRest(page)
    await expect(page.locator(`${ROW} [data-moment-row-play]`)).toHaveCount(OFFSETS.length)
  })

  test('with a verified VOD each card is its preview frame; moving across the big one steps through tiles', async ({ page }) => {
    let asked: number[] = []
    await open(page, {}, { verifiedVod: true, beforeOpen: async () => { asked = await stubStoryboard(page) } })
    const first = row(page, 1)
    await expect(first).toHaveAttribute('data-moment-frame', 'frame')
    await expect(row(page, 2)).toHaveAttribute('data-moment-frame', 'frame')
    await expect(row(page, 3)).toHaveAttribute('data-moment-frame', 'frame')
    // The tile under the middle of each moment's minute, on the VOD's clock (stream + 120 s).
    for (const offset of [750, 1050, 1350]) expect(asked).toContain(offset)
    const frame = first.locator('[data-moment-card-frame]')
    expect(await frame.evaluate(el => getComputedStyle(el).backgroundImage)).toContain(`${SHEET_HOST}/fixture_xqc/storyboards/${PORTAL_VOD_ID}-high-0.jpg`)
    // Tile 3 (747-996 s): the chip shows its start on the stream's clock.
    await expect(first.locator('.ssr-rc-at')).toHaveText('≈ 0:10:27')
    await expect(page.locator('[data-moment-reel-note]')).toHaveText(
      "Pictures are Twitch's VOD preview frames, one every 4 min 9 s. Move across one to step through them.",
    )

    // Hover prefetches the tiles either side; the right edge is three tiles on (VOD 1497 s, tile 6).
    const b = await first.boundingBox()
    if (!b) throw new Error('no layout box')
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await settle(page)
    for (const offset of [999, 501, 1248, 1497]) expect(asked).toContain(offset)
    await page.mouse.move(b.x + b.width - 2, b.y + b.height / 2)
    await settle(page)
    await expect(first).toHaveClass(/\bscrubbing\b/)
    await expect(first.locator('.ssr-rc-at')).toHaveText('≈ 0:22:54')
    await page.mouse.move(2, 2)
    await settle(page)
    await expect(first).not.toHaveClass(/\bscrubbing\b/)
    await expect(first.locator('.ssr-rc-at')).toHaveText('≈ 0:10:27')
  })
})

test.describe('session Moments rows at 390', () => {
  test.use({ viewport: { width: 390, height: 844 }, contextOptions: { reducedMotion: 'reduce' } })

  test('the reel and the rows fit the phone width: #2 and #3 side by side, no sideways scroll', async ({ page }) => {
    await open(page)
    const list = page.locator(LIST)
    await list.scrollIntoViewIfNeeded()
    const first = row(page, 1)
    await expect(first.locator('.ssr-off')).toHaveText('0:10:00')
    const [hero, two, three] = await Promise.all([1, 2, 3].map(rank => row(page, rank).boundingBox()))
    if (!hero || !two || !three) throw new Error('no layout box')
    expect(Math.abs(two.y - three.y)).toBeLessThan(1)
    expect(two.y).toBeGreaterThan(hero.y + hero.height - 1)
    expect(Math.abs(two.width - three.width)).toBeLessThan(1)
    expect(await list.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0)

    await showRest(page)
    const fourth = row(page, 4)
    const ev = await box(fourth.locator('.ssr-ev'))
    expect(ev.w).toBeLessThanOrEqual(1)
    const visibleTokens = await fourth.locator('.ssr-tok').evaluateAll(els => els.filter(el => getComputedStyle(el).display !== 'none').length)
    expect(visibleTokens).toBeLessThanOrEqual(1)
    expect(await list.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0)
    const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(pageOverflow).toBeLessThanOrEqual(0)
  })
})
