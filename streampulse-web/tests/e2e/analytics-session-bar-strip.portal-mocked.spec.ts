import { expect, test, type Locator, type Page } from './helpers/portalMockedTest'
import {
  assertNoUnexpected,
  buildDetail,
  buildMinutes,
  buildStatus,
  buildStreamRecord,
  installPortalAcceptanceHarness,
  openAnalyticsSession,
  PORTAL_VOD_ID,
} from './helpers/portalAcceptanceHarness'

// U14 (PORT-PLAN F22, d3-v2 session-original .bkc--below): a bar click opens
// the selected bar's strip in the page's flow under the chart, never over the
// plot. The picture is a VOD storyboard frame or, with no frame (today: the web
// client has none), the game's blurred art and the reason. Play loads Twitch's
// player only on click; every Twitch request here is intercepted, never live.
const MINUTES = 30
const PLOT = '[data-bench-plot]'
const PART = '[data-session-chart-part]'
const STRIP = '[data-selected-moment-card]'
const READOUT = '[data-session-readout]'
// 120 s verified alignment, the recap moment at 240 s, minus the 10 s lead-in
const PLAY_AT = '0:05:50'
const PLAYER_SRC = `https://player.twitch.tv/?video=v${PORTAL_VOD_ID}&time=5m50s&parent=127.0.0.1&autoplay=true`

const VERIFIED_VOD = {
  vodId: PORTAL_VOD_ID,
  vodAlignSeconds: 120,
  vodDurationSeconds: 3_600,
  vodTiming: { state: 'verified' },
  availability: { liveDvrState: 'ended', vodState: 'linked', vodId: PORTAL_VOD_ID, chartState: 'usable', chartUsable: true },
}

/** Intercept every Twitch host: the player gets a stub page, nothing reaches Twitch. */
async function stubTwitch(page: Page) {
  const hits: string[] = []
  await page.route(/^https?:\/\/([a-z0-9-]+\.)*twitch\.tv\//i, async (route) => {
    hits.push(route.request().url())
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>player stub</title><body style="background:#000"></body>' })
  })
  return hits
}

async function open(page: Page, opts: { verifiedVod?: boolean } = {}) {
  const harness = await installPortalAcceptanceHarness(page)
  harness.setMinutesPayload(buildMinutes({ count: MINUTES, withEmotes: true }))
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
  const twitch = await stubTwitch(page)
  await openAnalyticsSession(page)
  await expect(page.locator(PLOT)).toHaveCount(1, { timeout: 30_000 })
  await settle(page)
  return { harness, twitch }
}

// The harness installs a fake clock: let React commit, then run frames and timers.
async function settle(page: Page) {
  await page.waitForTimeout(50)
  const clock = page.clock as { runFor?: (ms: number) => Promise<void> }
  if (typeof clock.runFor === 'function') await clock.runFor(600)
}

const box = async (loc: Locator) => {
  const b = await loc.boundingBox()
  if (!b) throw new Error('no layout box')
  return b
}

/** "0:04:00" -> 240 */
const secondsOf = (text: string) => {
  const m = text.match(/^(\d+):(\d\d):(\d\d)/)
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null
}

/** The bottom of the site's sticky header (whatever is fixed/sticky at the window's top edge). */
const headerBottom = (page: Page) =>
  page.evaluate(() => {
    let inset = 0
    for (const el of document.elementsFromPoint(Math.round(window.innerWidth / 2), 1)) {
      const pos = getComputedStyle(el).position
      if (pos !== 'fixed' && pos !== 'sticky') continue
      const r = el.getBoundingClientRect()
      if (r.top <= 1 && r.bottom < window.innerHeight * 0.4) inset = Math.max(inset, r.bottom)
    }
    return inset
  })

/**
 * Find the bar the readout names `clock` and pin it. Mouse: hover across the
 * plot, then click. Touch (phones): the first tap reads a bar and a second tap
 * on the same bar pins it, so each read tap aims at a different bar (the 1-min
 * bars span the plot evenly) and only the matching one is tapped twice.
 */
async function clickMinute(page: Page, clock: string, input: 'mouse' | 'touch' = 'mouse') {
  // bring the plot on screen when it isn't (phones open on the page header; centred, clear of the sticky header)
  await page.locator(PLOT).evaluate((el) => {
    const r = el.getBoundingClientRect()
    if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior })
  })
  await settle(page)
  const plot = await box(page.locator(PLOT))
  const y = plot.y + plot.height * 0.45
  const seen: string[] = []
  const read = async () => (await page.locator(READOUT).textContent()) ?? ''
  if (input === 'touch') {
    const target = secondsOf(clock)!
    const barPx = plot.width / MINUTES
    let x = plot.x + barPx * (target / 60 + 0.5)
    for (let i = 0; i < 8; i += 1) {
      await page.touchscreen.tap(x, y)
      await settle(page)
      const text = await read()
      seen.push(text.slice(0, 16))
      if (text.startsWith(`${clock} `)) {
        await page.touchscreen.tap(x, y)
        await settle(page)
        return
      }
      const at = secondsOf(text)
      if (at == null) break
      x += ((target - at) / 60) * barPx
    }
  } else {
    for (let f = 0.02; f < 0.98; f += 0.005) {
      const x = plot.x + plot.width * f
      await page.mouse.move(x, y)
      await settle(page)
      const text = await read()
      if (text.startsWith(`${clock} `)) {
        await page.mouse.click(x, y)
        await settle(page)
        return
      }
      if (seen.length < 12 && !seen.includes(text.slice(0, 16))) seen.push(text.slice(0, 16))
    }
  }
  throw new Error(`no bar reads ${clock}; saw ${seen.join(' | ')}`)
}

test.describe('session bar strip at 1440', () => {
  test.use({ viewport: { width: 1440, height: 900 }, contextOptions: { reducedMotion: 'reduce' } })

  test('opens under the plot with the fallback picture; Play loads the player only on click; Esc clears', async ({ page }) => {
    const { harness, twitch } = await open(page, { verifiedVod: true })
    await clickMinute(page, '0:04:00')
    const strip = page.locator(STRIP)
    await expect(strip).toHaveCount(1)
    const region = strip.getByRole('region', { name: 'Bucket selected: 0:04:00' })
    await expect(region).toBeVisible()
    await expect(strip.locator('.bkc-s')).toHaveText('Bucket selected · 1 min')

    // in the page's flow under the chart part, never over the plot
    expect(await region.evaluate((el) => getComputedStyle(el).position)).toBe('relative')
    const part = await box(page.locator(PART))
    const plot = await box(page.locator(PLOT))
    const s = await box(region)
    expect(s.y).toBeGreaterThanOrEqual(part.y + part.height - 0.5)
    expect(s.y).toBeGreaterThanOrEqual(plot.y + plot.height)

    // two columns: the picture (at most 420 px) left of the figures
    const pic = await box(strip.locator('.mpl-box'))
    const body = await box(strip.locator('.bkc-body'))
    expect(pic.width).toBeLessThanOrEqual(420.5)
    expect(pic.x + pic.width).toBeLessThanOrEqual(body.x)
    expect(Math.abs(pic.width / pic.height - 16 / 9)).toBeLessThan(0.05)

    // no frame from the web client today: a dark box and its reason, never a stand-in frame or blurred art
    await expect(strip.locator('[data-preview-tile]')).toHaveAttribute('data-preview-tile', 'fallback')
    await expect(strip.locator('[data-preview-frame]')).toHaveCount(0)
    await expect(strip.locator('.mpl-box img')).toHaveCount(0)
    await expect(strip.locator('.mpl-note')).toContainText('No preview frame for this minute.')

    // the figures, and the bar's moment, locked
    await expect(strip.locator('.bkc-fl')).toHaveText(['viewers', 'chat/min', 'emotes/min'])
    await expect(strip.locator('[data-strip-moment="240"]')).toHaveClass(/\blk\b/)
    await expect(strip).not.toContainText('usual')

    // verified alignment: Play and the VOD link carry the 10 s lead-in
    const vod = strip.getByRole('link', { name: `Open VOD at ${PLAY_AT}` })
    await expect(vod).toHaveAttribute('href', `https://www.twitch.tv/videos/${PORTAL_VOD_ID}?t=5m50s`)
    await expect(vod).toHaveAttribute('target', '_blank')
    await expect(strip.locator('.mpl-cap')).toContainText("On the VOD's clock")

    // nothing from Twitch until Play
    await expect(strip.locator('iframe')).toHaveCount(0)
    expect(twitch).toEqual([])
    await strip.getByRole('button', { name: `Play VOD from ${PLAY_AT}` }).click()
    await settle(page)
    const player = strip.locator('iframe.mpl-if')
    await expect(player).toHaveAttribute('src', PLAYER_SRC)
    await expect(player).toHaveAttribute('title', `Twitch VOD from ${PLAY_AT}`)
    await expect.poll(() => twitch.filter((u) => u.startsWith('https://player.twitch.tv/')).length).toBe(1)
    expect(twitch[0]).toBe(PLAYER_SRC)

    await page.keyboard.press('Escape')
    await settle(page)
    await expect(page.locator(STRIP)).toHaveCount(0)
    await assertNoUnexpected(harness)
  })

  test('without a verified VOD: no Play, no player, the reason in its place', async ({ page }) => {
    const { harness, twitch } = await open(page)
    await clickMinute(page, '0:04:00')
    const strip = page.locator(STRIP)
    await expect(strip).toHaveCount(1)
    await expect(strip.getByRole('button', { name: /^Play/ })).toHaveCount(0)
    await expect(strip.locator('.mpl-msg')).toBeVisible()
    await expect(strip.getByRole('link', { name: /^Open VOD at/ })).toHaveCount(0)
    await expect(strip.locator('iframe')).toHaveCount(0)
    expect(twitch).toEqual([])
    await assertNoUnexpected(harness)
  })

  test('the first open scrolls to the strip but keeps the plot in view', async ({ page }) => {
    const { harness } = await open(page, { verifiedVod: true })
    // put the plot low in the window, so the strip would open below the fold
    await page.locator(PLOT).evaluate((el) => {
      const r = el.getBoundingClientRect()
      window.scrollBy({ top: r.top - 320, behavior: 'instant' as ScrollBehavior })
    })
    await settle(page)
    const before = await page.evaluate(() => window.scrollY)
    await clickMinute(page, '0:04:00')
    await expect(page.locator(STRIP)).toHaveCount(1)
    await settle(page)
    const after = await page.evaluate(() => window.scrollY)
    expect(after).toBeGreaterThan(before)
    // the plot's top stays in view, below the site's sticky header
    const plotTop = await page.locator(PLOT).evaluate((el) => el.getBoundingClientRect().top)
    expect(plotTop).toBeGreaterThanOrEqual((await headerBottom(page)) + 7)
    // the strip's head and figures are on screen
    const figs = await box(page.locator(`${STRIP} .bkc-figs`))
    expect(figs.y + figs.height).toBeLessThanOrEqual(900)
    await assertNoUnexpected(harness)
  })
})

test.describe('session bar strip at 390', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
    contextOptions: { reducedMotion: 'reduce' },
  })

  test('a 128 px thumbnail beside the time, icon-only Play, nothing wider than the screen', async ({ page }) => {
    const { harness, twitch } = await open(page, { verifiedVod: true })
    await clickMinute(page, '0:04:00', 'touch')
    const strip = page.locator(STRIP)
    await expect(strip).toHaveCount(1)
    const region = strip.getByRole('region', { name: 'Bucket selected: 0:04:00' })
    const s = await box(region)
    const plot = await box(page.locator(PLOT))
    expect(s.y).toBeGreaterThanOrEqual(plot.y + plot.height)
    expect(s.x + s.width).toBeLessThanOrEqual(390)
    // any scroll on open kept the plot's top clear of the sticky header
    expect(plot.y).toBeGreaterThanOrEqual((await headerBottom(page)) + 7)

    const pic = await box(strip.locator('.mpl-box'))
    expect(Math.abs(pic.width - 128)).toBeLessThanOrEqual(1)
    const id = await box(strip.locator('.bkc-id'))
    expect(id.x).toBeGreaterThanOrEqual(pic.x + pic.width)
    const play = strip.getByRole('button', { name: `Play VOD from ${PLAY_AT}` })
    const pb = await box(play)
    expect(pb.width).toBeLessThanOrEqual(40)
    // the note and the VOD clock line are read out, not shown; the title gets the cover's room
    expect(await strip.locator('.mpl-note').evaluate((el) => el.getBoundingClientRect().width)).toBeLessThanOrEqual(1)
    expect(await strip.locator('.mpl-cap').evaluate((el) => el.getBoundingClientRect().width)).toBeLessThanOrEqual(1)
    await expect(strip.locator('.bkc-art')).toBeHidden()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)

    expect(twitch).toEqual([])
    await play.tap()
    await settle(page)
    // the player takes the strip's full width
    const player = await box(strip.locator('iframe.mpl-if'))
    expect(player.width).toBeGreaterThan(300)
    await expect(strip.locator('iframe.mpl-if')).toHaveAttribute('src', PLAYER_SRC)
    // and the clock line shows under it
    expect(await strip.locator('.mpl-cap').evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(200)
    await assertNoUnexpected(harness)
  })
})
