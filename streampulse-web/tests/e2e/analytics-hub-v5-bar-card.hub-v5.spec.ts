import { expect, test, type Page, type Route } from '@playwright/test'
import { installHubUxMock, type HubUxMockOptions, type HubUxMockServed } from './helpers/hubUxMock'

// The bar lock (L1, bar-lock board 11-01): a bar click locks it, and the lock
// under the chart reads like the emote lock. One header row (the time, its day
// and bar size, ‹ ›, Zoom to bar and Clear), the bar's busiest chats from
// hub/moments in two columns of three, and its top emotes. The readout above
// the chart holds the locked bar at rest (R1). Every answer here is mocked.
const PLOT = '.figma-global-activity__hub-chart svg[data-bench-plot]'
const CARD = '[data-hub-bar-card]'
const READOUT = '[data-hub-readout]'
const MOMENTS = /\/v1\/public\/hub\/moments(\?.*)?$/

async function plotArea(page: Page) {
  const plot = page.locator(PLOT)
  await plot.scrollIntoViewIfNeeded()
  // The page's section-reveal entrance (a 12 px translate on an ancestor) runs after the scroll; measure at rest.
  let last = NaN
  await expect.poll(async () => {
    const y = (await plot.boundingBox())!.y
    const still = Math.abs(y - last) < 0.01
    last = y
    if (!still) await page.waitForTimeout(250)
    return still
  }).toBe(true)
  const box = (await plot.boundingBox())!
  const width = await page.locator('.figma-global-activity__hub-chart [data-hub-plot-box]').evaluate(el => el.getBoundingClientRect().width)
  return { plot, box, at: (fx: number, fy = .55) => ({ x: box.x + width * fx, y: box.y + box.height * fy }) }
}

type Read = { url: string; at: number }

async function openHub(page: Page, width: number, { reduced = true, mock = {}, routes, path = '/analytics' }: {
  reduced?: boolean
  mock?: HubUxMockOptions
  /** Routes added after the mock's, so they answer first. */
  routes?: () => Promise<unknown>
  path?: string
} = {}): Promise<{ reads: Read[]; served: HubUxMockServed }> {
  await page.setViewportSize({ width, height: 1000 })
  if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' })
  const served = await installHubUxMock(page, mock)
  await routes?.()
  const reads: Read[] = []
  page.on('request', request => { if (MOMENTS.test(request.url())) reads.push({ url: request.url(), at: Date.now() }) })
  await page.goto(path)
  await expect(page.locator(PLOT)).toBeVisible()
  return { reads, served }
}

/** Answers hub/moments before the mock does; `answer` returns false to pass the read on to the mock. */
const answerMoments = (page: Page, answer: (route: Route) => Promise<boolean>) =>
  page.route(MOMENTS, async route => {
    if (!(await answer(route))) await route.fallback()
  })

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
const barMinutes = async (page: Page) => Number((await page.locator(`${CARD} .hbk-day`).textContent())!.match(/(\d+)-min bar/)![1])
const titleText = async (page: Page) => (await page.locator(`${CARD} .hbk-t`).textContent())!.replace(/^Locked bar, /, '')

/** Locks the newest bar from the keyboard: the plot cursor, Enter, then right until the lock stops moving. */
async function lockNewest(page: Page) {
  const plot = page.locator(PLOT)
  // The arrows start from the bar under a resting mouse, so a keyboard walk moves the mouse off the plot first.
  await page.mouse.move(0, 0)
  await plot.focus()
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('Enter')
  await expect(page.locator(CARD)).toHaveAttribute('data-hub-bar-card', 'open')
  for (let i = 0; i < 8; i += 1) {
    const before = await titleText(page)
    await page.keyboard.press('ArrowRight')
    // A step lands within a frame; no change in a while means this is the newest bar.
    const moved = await expect.poll(() => titleText(page), { timeout: 1_000 }).not.toBe(before).then(() => true, () => false)
    if (!moved) return
  }
  throw new Error('the lock never reached the newest bar')
}

test('a bar click locks it: the lock lists its busiest chats and the readout holds the bar', async ({ page }) => {
  const { reads } = await openHub(page, 1440, { reduced: false })
  const { plot, box, at } = await plotArea(page)
  await expect(page.locator(CARD)).toHaveCount(0)
  await page.mouse.click(at(.5).x, at(.5).y)
  await expect(plot).toHaveAttribute('data-selection', '')
  const lock = page.getByRole('region', { name: /^Locked bar, / })
  await expect(lock).toHaveAttribute('data-hub-bar-card', 'open')
  await expect(lock).toBeInViewport()
  await expect(lock.locator('.hbk-day')).toHaveText(/^[A-Z][a-z]{2} \d{1,2} · \d+-min bar$/)
  await expect(lock.getByRole('button', { name: 'Clear' })).toBeVisible()
  await expect(lock.locator('.hbk-chats .hbk-sub')).toHaveText('Busiest chats · in this bar, by chat a minute')
  const row = lock.locator('.hbk-rows .hbk-r')
  await expect(row).toHaveCount(1)
  await expect(row.locator('.hbk-n > span')).toHaveText('xQc')
  await expect(row.locator('.hbk-n small')).toHaveText('No category')
  await expect(row.locator('.hbk-te')).toHaveText('DinoDance ×45')
  await expect(row.locator('.hbk-v')).toHaveText('220/min')
  await expect(row.locator('.hbk-at')).toHaveText(/^▶ \d{1,2}:\d{2}/)
  await expect(row).toHaveAttribute('href', '/analytics/moments?login=xqc&stream=hist-1&offset=600')
  // The mock's buckets count emotes but send no names: the lock says so instead of inventing a list (pick 12A, 10-30).
  await expect(lock.locator('.hbk-emo .hbk-sub')).toHaveText('Top emotes · names not in this update')
  // One hub/moments read per server bucket in the bar, at most five, on the window's grid.
  const buckets = Math.min(5, Math.ceil((await barMinutes(page)) / 6))
  await expect.poll(() => reads.length).toBe(buckets)
  for (const read of reads) expect(new URL(read.url).searchParams.get('activityWindow')).toBe('24h')
  // Under the plot, never over it; the band is the same selection, drawn by the chart.
  expect((await lock.boundingBox())!.y).toBeGreaterThanOrEqual((await plot.boundingBox())!.y + box.height - 1)
  await expect(plot.locator('.spc-selband')).toHaveCount(1)
  expect(await noSideScroll(page)).toBe(true)

  // R1: the numbers row holds the locked bar at rest with its mark; hover still previews other bars.
  const readout = page.locator(READOUT)
  await page.mouse.move(0, 0)
  await expect(readout).toHaveAttribute('data-hub-readout-mode', 'lock')
  await expect(readout.locator('.tm .mk')).toBeVisible()
  await expect(readout.locator('.tm .l1')).toHaveText(await titleText(page))
  await expect(readout.locator('.tm .l2')).toHaveText(/^[A-Z][a-z]{2} \d{1,2} · locked$/)
  const now = await plotArea(page)
  await page.mouse.move(now.at(.25).x, now.at(.25).y)
  await expect(readout).toHaveAttribute('data-hub-readout-mode', 'hover')
  await expect(readout.locator('.tm .mk')).toHaveCount(0)
  await page.mouse.move(0, 0)
  await expect(readout).toHaveAttribute('data-hub-readout-mode', 'lock')
})

test('‹ › and the plot arrows step bars; Zoom to bar zooms the chart and keeps the lock', async ({ page }) => {
  await openHub(page, 1262)
  const { plot, at } = await plotArea(page)
  await page.mouse.click(at(.5).x, at(.5).y)
  const lock = page.locator(CARD)
  const title = lock.locator('.hbk-t')
  await expect(title).toHaveText(/\d/)
  const first = await title.textContent()
  await lock.getByRole('button', { name: 'Next bar' }).click()
  await expect(title).not.toHaveText(first!)
  const second = await title.textContent()
  await expect(page.locator(`${READOUT} .tm .l1`)).toHaveText(await titleText(page))
  await lock.getByRole('button', { name: 'Previous bar' }).click()
  await expect(title).toHaveText(first!)
  await plot.focus()
  await page.keyboard.press('ArrowRight')
  await expect(title).toHaveText(second!)
  await page.keyboard.press('ArrowLeft')
  await expect(title).toHaveText(first!)
  await expect(plot).toHaveAttribute('data-selection', '')
  await expect(lock).toHaveAttribute('data-hub-bar-chats', 'rows')

  const navigator = page.locator('[data-hub-chart-navigator]')
  const full = await navigator.getAttribute('data-hub-chart-navigator-window')
  await lock.locator('.hbk-h').getByRole('button', { name: 'Zoom to bar' }).click()
  await expect(navigator).not.toHaveAttribute('data-hub-chart-navigator-window', full!)
  await expect(navigator.getByRole('status')).not.toContainText('240 of 240')
  await expect(plot).toHaveAttribute('data-selection', '')
  await expect(lock).toHaveAttribute('data-hub-bar-card', 'open')
  await page.mouse.move(0, 0)
  await expect(page.locator(READOUT)).toHaveAttribute('data-hub-readout-mode', 'lock')
})

test('Clear and Esc unlock, give focus back to the plot, and the readout goes back to Now', async ({ page }) => {
  await openHub(page, 1080)
  const { plot, at } = await plotArea(page)
  const lock = page.locator(CARD)
  const readout = page.locator(READOUT)

  await page.mouse.click(at(.5).x, at(.5).y)
  await expect(lock).toHaveAttribute('data-hub-bar-card', 'open')
  await lock.getByRole('button', { name: 'Clear' }).click()
  await expect(lock).toHaveCount(0)
  await expect(plot).not.toHaveAttribute('data-selection', /.*/)
  await expect(plot).toBeFocused()
  await expect(readout).toHaveAttribute('data-hub-readout-mode', 'now')

  // Locking may have scrolled the lock into view: measure the plot again.
  const again = await plotArea(page)
  await page.mouse.click(again.at(.4).x, again.at(.4).y)
  await expect(lock).toHaveAttribute('data-hub-bar-card', 'open')
  await lock.getByRole('button', { name: 'Next bar' }).focus()
  await page.keyboard.press('Escape')
  await expect(lock).toHaveCount(0)
  await expect(plot).not.toHaveAttribute('data-selection', /.*/)
  await expect(plot).toBeFocused()
  await page.mouse.move(0, 0)
  await expect(readout).toHaveAttribute('data-hub-readout-mode', 'now')
})

test('the bar holding a hub moment marks its row Top moment, and the row opens that minute in Moments', async ({ page }) => {
  await openHub(page, 1440)
  await plotArea(page)
  // The mock's xQc hub moment is in the second-to-last 6-min bucket: lock the newest bar, then step back.
  await lockNewest(page)
  const lock = page.locator(CARD)
  for (let i = 0; i < 4; i += 1) {
    await expect(lock).toHaveAttribute('data-hub-bar-chats', 'rows')
    if (await lock.locator('.hbk-mo').count()) break
    const before = await titleText(page)
    await lock.getByRole('button', { name: 'Previous bar' }).click()
    await expect.poll(() => titleText(page)).not.toBe(before)
  }
  await expect(lock.locator('.hbk-mo')).toHaveText('Top moment')
  const link = lock.getByRole('link', { name: /^xQc, No category, 220 chat a minute at .+, one of the hub’s top moments\. Opens that minute in Moments\.$/ })
  await expect(link).toHaveAttribute('href', '/analytics/moments?login=xqc&stream=hist-1&offset=600')
  await link.click()
  await expect(page).toHaveURL(/\/analytics\/moments\?login=xqc&stream=hist-1&offset=600$/)
})

test('the lock holds six quiet rows while it reads, then says what it listed', async ({ page }) => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await openHub(page, 1440, { routes: () => answerMoments(page, async () => { await gate; return false }) })
  const { at } = await plotArea(page)
  await page.mouse.click(at(.5).x, at(.5).y)
  const lock = page.locator(CARD)
  const live = page.locator('[data-hub-bar-card-live]')
  await expect(lock).toHaveAttribute('data-hub-bar-chats', 'loading')
  await expect(lock.locator('.hbk-ph')).toHaveCount(6)
  await expect(lock.locator('.hbk-chats')).toHaveAttribute('aria-busy', 'true')
  await expect(lock.locator('.hbk-emo')).toBeVisible()
  await expect(live).toHaveText(/ locked\. Loading the streams for this bar\.$/)
  const held = await lock.locator('.hbk-ph').first().evaluate(el => el.getBoundingClientRect().height)
  release()
  await expect(lock).toHaveAttribute('data-hub-bar-chats', 'rows')
  await expect(lock.locator('.hbk-ph')).toHaveCount(0)
  // A quiet row is as tall as the row it stands for, so nothing below moves when the rows come in.
  const listed = await lock.locator('.hbk-rows > li').first().evaluate(el => el.getBoundingClientRect().height)
  expect(Math.abs(listed - held)).toBeLessThanOrEqual(1)
  await expect(lock.locator('.hbk-chats')).not.toHaveAttribute('aria-busy', /.*/)
  await expect(live).toHaveText('1 busiest chat listed.')
})

test('an empty answer says no streams were listed; on the newest bar they aren’t in yet', async ({ page }) => {
  await openHub(page, 1440, {
    routes: () => answerMoments(page, async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ready', moments: [] }) })
      return true
    }),
  })
  const { at } = await plotArea(page)
  await page.mouse.click(at(.5).x, at(.5).y)
  const lock = page.locator(CARD)
  await expect(lock.locator('.hbk-none')).toHaveText('No streams were listed for this bar.')
  await expect(lock).toHaveAttribute('data-hub-bar-chats', 'note')
  await expect(lock.locator('.hbk-rows')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(lock).toHaveCount(0)
  await lockNewest(page)
  await expect(lock.locator('.hbk-none')).toHaveText('The streams for this bar aren’t in yet.')
  await expect(page.locator('[data-hub-bar-card-live]')).toHaveText(/ locked\. The streams for this bar aren’t in yet\.$/)
})

test('a failed read offers Retry, which waits out Retry-After before it reads again', async ({ page }) => {
  let failing = true
  const { reads } = await openHub(page, 1440, {
    routes: () => answerMoments(page, async route => {
      if (!failing) return false
      await route.fulfill({
        status: 429,
        headers: { 'Retry-After': '2', 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Retry-After' },
        contentType: 'application/json',
        body: JSON.stringify({ error: 'rate_limited' }),
      })
      return true
    }),
  })
  const { at } = await plotArea(page)
  await page.mouse.click(at(.5).x, at(.5).y)
  const lock = page.locator(CARD)
  await expect(lock.locator('.hbk-none')).toHaveText('Couldn’t load the streams for this bar.Retry')
  await expect(lock).toHaveAttribute('data-hub-bar-chats', 'note')
  // The top emotes come from the hub's own reply, so they stay.
  await expect(lock.locator('.hbk-emo')).toBeVisible()
  const failed = reads.length
  expect(failed).toBeGreaterThan(0)
  failing = false
  await lock.getByRole('button', { name: 'Retry' }).click()
  // Retry leaves with the note, and focus stays in the lock on the list's heading.
  await expect(lock.locator('.hbk-chats .hbk-sub')).toBeFocused()
  await expect(lock.locator('.hbk-ph')).toHaveCount(6)
  await expect(lock).toHaveAttribute('data-hub-bar-chats', 'rows', { timeout: 10_000 })
  expect(reads.length).toBeGreaterThan(failed)
  // Two seconds after the refused read, never sooner.
  expect(reads[failed]!.at - reads[failed - 1]!.at).toBeGreaterThanOrEqual(1_900)
})

test('a locked bar a later reply leaves unmeasured shows the hatch and Not measured; ‹ › still step', async ({ page }) => {
  await page.clock.install()
  const { served } = await openHub(page, 1440)
  const { at } = await plotArea(page)
  // The middle of 240 buckets is about 120 buckets ago.
  await page.mouse.click(at(.5).x, at(.5).y)
  const lock = page.locator(CARD)
  await expect(lock).toHaveAttribute('data-hub-bar-chats', 'rows')
  const title = await titleText(page)
  served.markUnmeasured(Array.from({ length: 61 }, (_, i) => 90 + i))
  // The 24h hub polls every 45 s (±15 %): run the page clock past the next poll.
  await page.clock.fastForward(60_000)
  await expect(lock).toHaveAttribute('data-gap', '')
  await expect(lock).toHaveAttribute('data-hub-bar-chats', 'gap')
  await expect(lock.locator('.hbk-hatch')).toBeVisible()
  await expect(lock.locator('.hbk-day')).toHaveText(/ · Not measured$/)
  await expect(lock.locator('.hbk-none')).toHaveText('No chat or emote counts for this bar.')
  await expect(lock.locator('.hbk-chats, .hbk-emo')).toHaveCount(0)
  expect(await titleText(page)).toBe(title)
  const readout = page.locator(READOUT)
  await page.mouse.move(0, 0)
  await expect(readout).toHaveAttribute('data-hub-readout-mode', 'lock')
  await expect(readout.locator('[data-k="chat"] .fig')).toHaveText('—')
  await expect(readout.locator('[data-k="viewers"] .l2')).toHaveText('Not measured')
  // ‹ › step on to the measured bar past the gap.
  await lock.getByRole('button', { name: 'Next bar' }).click()
  await expect(lock).not.toHaveAttribute('data-gap', /.*/)
  await expect(lock).toHaveAttribute('data-hub-bar-chats', 'rows')
})

// A bar wider than five server buckets ("Zoom in to list streams") needs a plot under about 205 px at 241 samples
// (5-px slots, 0.85 tolerance), so no page width reaches it; the view tests cover it. A long window does.
test('a window longer than 7 days asks for 7 days or less and reads nothing', async ({ page }) => {
  const { reads } = await openHub(page, 390, { mock: { matchActivityWindow: true }, path: '/analytics?window=1m' })
  const { at } = await plotArea(page)
  await page.mouse.click(at(.5).x, at(.5).y)
  const lock = page.locator(CARD)
  await expect(lock).toHaveAttribute('data-hub-bar-card', 'open')
  await expect(lock.locator('.hbk-none')).toHaveText('Set the time window to 7 days or less to see streams.')
  await expect(lock).toHaveAttribute('data-hub-bar-chats', 'note')
  await expect(lock.locator('.hbk-none button')).toHaveCount(0)
  // The emotes still show; nothing was read.
  await expect(lock.locator('.hbk-emo')).toBeVisible()
  const before = await titleText(page)
  await lock.getByRole('button', { name: 'Next bar' }).click()
  await expect.poll(() => titleText(page)).not.toBe(before)
  await expect(lock.locator('.hbk-none')).toHaveText('Set the time window to 7 days or less to see streams.')
  // A read would start within a frame of the step.
  await page.waitForTimeout(300)
  expect(reads).toHaveLength(0)
})

for (const width of [390, 768, 1080, 1440, 1920]) {
  test(`the lock fits its column and follows its container layout at ${width}px`, async ({ page }) => {
    await openHub(page, width, { mock: { bucketEmoteDetail: true } })
    const { plot, at } = await plotArea(page)
    await page.mouse.click(at(.5).x, at(.5).y)
    await expect(plot).toHaveAttribute('data-selection', '')
    const lock = page.locator(CARD)
    await expect(lock).toHaveAttribute('data-hub-bar-card', 'open')
    await expect(lock).toHaveAttribute('data-hub-bar-chats', /^(rows|note)$/)
    // A bar too wide to list zooms first, so every width lays out a row.
    const zoomNote = lock.locator('.hbk-none').getByRole('button', { name: 'Zoom to bar' })
    if (await zoomNote.count()) await zoomNote.click()
    await expect(lock).toHaveAttribute('data-hub-bar-chats', 'rows', { timeout: 10_000 })
    await expect(lock.locator('.hbk-e')).toHaveCount(3)
    const layout = await lock.evaluate(el => {
      const box = (sel: string) => el.querySelector(sel)!.getBoundingClientRect()
      const css = (sel: string) => {
        const node = el.querySelector(sel)
        return node ? getComputedStyle(node) : null
      }
      const tracks = (sel: string) => {
        const style = css(sel)!
        return style.display === 'grid' ? style.gridTemplateColumns.split(' ').length : 1
      }
      const shown = [...el.querySelectorAll<HTMLElement>('*')].filter(node =>
        !node.closest('.hv5-vh') && node.getClientRects().length > 0 && [...node.childNodes].some(c => c.nodeType === 3 && c.textContent!.trim()))
      const card = el.getBoundingClientRect()
      return {
        host: el.closest('.hv5-bk')!.getBoundingClientRect().width,
        left: card.left,
        right: card.right,
        grid: tracks('.hbk-g'),
        rows: tracks('.hbk-rows'),
        chips: tracks('.hbk-erows'),
        prov: css('.hbk-prov')?.display ?? null,
        rowFit: [...el.querySelectorAll<HTMLElement>('.hbk-r')].map(row => {
          const emote = row.querySelector('.hbk-te')
          return {
            width: row.getBoundingClientRect().width,
            over: row.scrollWidth - row.clientWidth,
            name: row.querySelector('.hbk-n')!.getBoundingClientRect().width,
            emote: emote ? getComputedStyle(emote).display : null,
          }
        }),
        header: css('.hbk-h')!.display,
        time: box('.hbk-t'),
        day: box('.hbk-day'),
        zoom: box('.hbk-zoom'),
        clear: box('.hbk-clear'),
        chats: box('.hbk-chats'),
        emotes: box('.hbk-emo'),
        smallest: Math.min(...shown.map(node => parseFloat(getComputedStyle(node).fontSize))),
      }
    })
    expect(layout.left).toBeGreaterThanOrEqual(0)
    expect(layout.right).toBeLessThanOrEqual(width)
    expect(await noSideScroll(page)).toBe(true)
    // Nothing under 12 px.
    expect(layout.smallest).toBeGreaterThanOrEqual(12)
    // The provider split shows wherever there is room for it.
    expect(layout.prov).not.toBeNull()
    expect(layout.prov === 'none').toBe(layout.host < 700)
    // Every row fits and its name keeps 64 px or more; a row's top emote gives way only where that row is under 340 px.
    expect(layout.rowFit.length).toBeGreaterThan(0)
    for (const row of layout.rowFit) {
      expect(row.over).toBeLessThanOrEqual(0)
      expect(row.name).toBeGreaterThanOrEqual(64)
      if (row.emote !== null) expect(row.emote === 'none').toBe(row.width <= 339)
    }
    if (layout.host >= 1000) {
      // Chats on the left in two columns of three, the top emotes on the right.
      expect(layout.grid).toBe(2)
      expect(layout.rows).toBe(2)
      expect(layout.chips).toBe(1)
      expect(layout.emotes.left).toBeGreaterThanOrEqual(layout.chats.right - 1)
    } else if (layout.host >= 700) {
      // Tablet: the emotes go under the chats as three chips.
      expect(layout.grid).toBe(1)
      expect(layout.rows).toBe(2)
      expect(layout.chips).toBe(3)
      expect(layout.emotes.top).toBeGreaterThanOrEqual(layout.chats.bottom - 1)
    } else {
      // Phone: one column, and a two-line header (Clear on the first line, the day and Zoom on the second).
      expect(layout.rows).toBe(1)
      expect(layout.chips).toBe(3)
      expect(layout.header).toBe('grid')
      expect(layout.day.top).toBeGreaterThanOrEqual(layout.time.bottom - 1)
      expect(layout.zoom.top).toBeGreaterThanOrEqual(layout.clear.bottom - 1)
    }
    // At rest the readout holds the lock (R1): the mark and the time fit the time column. A noon or
    // midnight bar names both periods and runs wider, so it is left out.
    await page.mouse.move(0, 0)
    const readout = page.locator(READOUT)
    await expect(readout).toHaveAttribute('data-hub-readout-mode', 'lock')
    const time = await readout.locator('.tm').evaluate(slot => {
      const held = slot.querySelector('.l1 > span')!
      return { text: held.textContent!, need: held.getBoundingClientRect().width, room: slot.clientWidth }
    })
    if (!/[AP]M.+[AP]M/.test(time.text)) expect(time.need).toBeLessThanOrEqual(time.room)
  })
}
