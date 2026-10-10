import { readFileSync } from 'node:fs'
import type { BrowserContext, Locator, Page, Route } from '@playwright/test'
import { test, expect } from '../helpers/testFixtures.ts'
import { openTwitchChannel } from '../helpers/mockTwitch.ts'
import { waitForPulseRoot } from '../helpers/assertions.ts'

/**
 * Top Moments shows nothing above its list until a moment is picked. A pick
 * opens one card right above the list; later picks swap its contents in place,
 * and ×, Escape or the picked row again close it. While the card opens or
 * closes, the panel scrolls by its height, so the picked row stays under the
 * pointer; near the top of the panel the card stays in view instead. A minute
 * picked on the chart keeps its card under the chart; a ranked moment picked
 * on the chart shows in the Top Moments card. One selection, one card.
 */

const SIDEBAR = { overlayPlacement: 'sidebar', sidebarTab: 'pulse', overlayMode: 'expanded' } as const

interface Box { x: number; y: number; width: number; height: number }

const box = async (element: Locator): Promise<Box> => (await element.boundingBox())!

async function isFocused(element: Locator): Promise<boolean> {
  return element.evaluate(el => (el.getRootNode() as ShadowRoot | Document).activeElement === el)
}

/** The kicker and time the Top Moments card shows, e.g. "Selected moment at 00:04". */
async function cardLabel(card: Locator): Promise<string | null> {
  return card.locator('[data-selected-moment-card="true"]').getAttribute('aria-label')
}

/**
 * Record how far the row at `index` moves on every frame for the next 900 ms.
 * Each sample is taken in a task right after the frame's animation callbacks,
 * the panel's scroll correction among them, so it sees what that frame paints.
 */
async function recordDrift(body: Locator, index: number): Promise<void> {
  await body.evaluate((el, index) => {
    const row = el.querySelectorAll('.pulse-moment-row-button')[index]!
    const rowTop = row.getBoundingClientRect().top
    const drift: number[] = []
    ;(window as unknown as { __drift: number[] }).__drift = drift
    const until = performance.now() + 900
    const frame = () => {
      setTimeout(() => drift.push(row.getBoundingClientRect().top - rowTop))
      if (performance.now() < until) requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  }, index)
}

async function expectRecordedDriftWithin(page: Page, px: number): Promise<void> {
  await page.waitForTimeout(1000)
  const drift = await page.evaluate(() => (window as unknown as { __drift: number[] }).__drift)
  expect(drift.length).toBeGreaterThan(9)
  expect(Math.max(...drift.map(Math.abs))).toBeLessThanOrEqual(px)
}

/** Scroll the panel so the element's top sits at `at` of the panel's height. */
async function placeInPanel(body: Locator, element: Locator, at: number): Promise<void> {
  await element.scrollIntoViewIfNeeded()
  const [bodyBox, elementBox] = [await box(body), await box(element)]
  await body.evaluate((el, dy) => { el.scrollTop += dy }, elementBox.y - (bodyBox.y + bodyBox.height * at))
}

/** A raw mouse click on the element's centre: Playwright's locator.click would scroll it first. */
async function clickInPlace(page: Page, element: Locator): Promise<void> {
  const { x, y, width, height } = await box(element)
  await page.mouse.click(x + width / 2, y + height / 2)
}

/** The card's slot animations have finished. */
async function settled(card: Locator): Promise<void> {
  await expect.poll(() => card.evaluate(el => el.getAnimations({ subtree: true }).every(animation => animation.playState !== 'running'))).toBe(true)
}

async function openPanel(page: Page, height: number) {
  await page.setViewportSize({ width: 1440, height })
  await openTwitchChannel(page)
  await waitForPulseRoot(page)
  const root = page.locator('#streamclone-pulse-root')
  return {
    root,
    body: root.locator('.pulse-panel-body'),
    rows: root.locator('.pulse-moment-row-button'),
    /** The Top Moments card while it shows a pick (not while it collapses out). */
    card: root.locator('[data-top-moment-card="selected"]'),
    anyCard: root.locator('[data-top-moment-card]'),
  }
}

/**
 * Nothing is picked for the viewer: the strongest moment is not auto-selected,
 * highlighted or locked on the chart, live or on a VOD, until a pick.
 */
for (const surface of [
  { name: 'live', scenario: 'live-ready', twitchKind: 'live' },
  { name: 'VOD recap', scenario: 'vod-ready', twitchKind: 'vod' },
] as const) {
  test(`${surface.name}: on load no moment is selected, highlighted or locked until a pick`, async ({ extension, prepare }) => {
    await prepare({ scenario: surface.scenario, twitchKind: surface.twitchKind, storage: SIDEBAR })
    const { root, rows, card, anyCard } = await openPanel(extension.page, 1000)
    const chart = root.locator('svg[data-testid="pulse-overview-chart"]')
    await expect(chart).toBeVisible()
    await expect(rows.first()).toBeVisible()
    const expectNothingPicked = async () => {
      await expect(anyCard).toHaveCount(0)
      await expect(root.locator('.pulse-moment-row-button[aria-pressed="true"]')).toHaveCount(0)
      await expect(root.locator('.pulse-moment-row-selected')).toHaveCount(0)
      await expect(chart).not.toHaveAttribute('data-chart-locked-index')
      await expect(root.locator('[data-chart-readout-state="selected"]')).toHaveCount(0)
      await expect(root.locator('[data-chart-moment-marker-state="active"]')).toHaveCount(0)
      await expect(root.locator('.pulse-recap-highlight-btn[aria-pressed="true"]')).toHaveCount(0)
      await expect(root.locator('.pulse-moment-slot')).toHaveCount(0)
    }
    await expectNothingPicked()
    // Still nothing a few seconds in, after the panel has settled.
    await extension.page.waitForTimeout(2_000)
    await expectNothingPicked()
    if (surface.name === 'live') await expect(root.locator('[data-featured-moment="true"]')).toContainText('Strongest loaded moment')

    // A pick selects, highlights and locks; picking the row again releases all of it.
    await rows.first().click()
    await expect(rows.first()).toHaveAttribute('aria-pressed', 'true')
    await expect(card).toHaveCount(1)
    await expect(chart).toHaveAttribute('data-chart-locked-index', /\d+/)
    await rows.first().click()
    await expect(rows.first()).toHaveAttribute('aria-pressed', 'false')
    await expectNothingPicked()
  })
}

test('nothing shows above Top Moments until a pick; later picks swap the card in place and move nothing', async ({ extension, prepare }) => {
  await prepare({ scenario: 'vod-ready', twitchKind: 'vod', storage: SIDEBAR })
  const { root, rows, card, anyCard } = await openPanel(extension.page, 2200)
  await expect(rows).toHaveCount(3)
  await expect(anyCard).toHaveCount(0)
  await expect(root.getByText('Strongest moment', { exact: true })).toHaveCount(0)
  for (let index = 0; index < 3; index += 1) await expect(rows.nth(index)).not.toHaveAttribute('aria-controls', /.+/)

  await rows.nth(1).click()
  await expect(card).toHaveCount(1)
  await settled(card)
  const cardId = await card.getAttribute('id')
  for (let index = 0; index < 3; index += 1) await expect(rows.nth(index)).toHaveAttribute('aria-controls', cardId!)
  // Right above the list.
  expect((await box(card)).y + (await box(card)).height).toBeLessThanOrEqual((await box(rows.nth(0))).y)
  const layout = () => Promise.all([card, rows.nth(0), rows.nth(1), rows.nth(2)].map(async element => {
    const { y, height } = await box(element)
    return { y, height }
  }))
  const before = await layout()

  for (const index of [2, 0, 1]) {
    await rows.nth(index).click()
    await expect(rows.nth(index)).toHaveAttribute('aria-pressed', 'true')
    const time = (await rows.nth(index).getAttribute('aria-label'))!.match(/bucket (\S+),/)![1]
    expect(await cardLabel(card)).toMatch(new RegExp(`^Selected moment at ${time}`))
    // The card, every row and the gaps between them stay exactly where they were.
    const after = await layout()
    after.forEach((now, item) => {
      expect(Math.abs(now.y - before[item].y)).toBeLessThanOrEqual(1)
      expect(Math.abs(now.height - before[item].height)).toBeLessThanOrEqual(1)
    })
    // Nothing opens in the list or under the chart.
    await expect(root.locator('.pulse-moment-slot')).toHaveCount(1)
    await expect(root.locator('.pulse-moment-row-button[aria-pressed="true"]')).toHaveCount(1)
  }
})

test('live: the card opens to one height for moments with no, one or three top emotes', async ({ extension, prepare }) => {
  await prepare({ scenario: 'live-ready', twitchKind: 'live', storage: SIDEBAR })
  const live = JSON.parse(readFileSync(new URL('../fixtures/api/pulse-live-ready.json', import.meta.url), 'utf8'))
  const [three] = live.peaks
  // Twelve completed minutes, so a live panel lists more than one moment.
  const rollups = Array.from({ length: 12 }, (_, index) => ({ ...live.rollups[0], offsetSeconds: 2940 + index * 60 }))
  // The strongest moment has no emotes, so the first pick is the shortest card.
  const peaks = [
    { ...three, offsetSeconds: 3240, score: 95, topEmotes: [] },
    { ...three, offsetSeconds: 3420, score: 80, topEmotes: three.topEmotes.slice(0, 1) },
    three,
  ]
  await extension.context.route('https://api.streampulse.stream/v1/extension/pulse/channels/fixturechan*', async route => {
    if (new URL(route.request().url()).pathname.endsWith('/fixturechan')) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...live, rollups, peaks }) })
    } else {
      await route.fallback()
    }
  })
  const { rows, card } = await openPanel(extension.page, 2200)
  await expect(rows).toHaveCount(3)
  await rows.nth(0).click()
  await expect(card.locator('[data-moment-inspector-emote-row]')).toHaveCount(0)
  await settled(card)
  const layout = () => Promise.all([card, rows.nth(0), rows.nth(1), rows.nth(2)].map(async element => {
    const { y, height } = await box(element)
    return { y, height }
  }))
  const before = await layout()

  for (const [index, emotes] of [[1, 3], [2, 1], [0, 0], [1, 3]] as const) {
    await rows.nth(index).click()
    await expect(card.locator('[data-moment-inspector-emote-row]')).toHaveCount(emotes)
    const after = await layout()
    after.forEach((now, item) => {
      expect(Math.abs(now.y - before[item].y)).toBeLessThanOrEqual(1)
      expect(Math.abs(now.height - before[item].height)).toBeLessThanOrEqual(1)
    })
  }
})

/**
 * The first click: the card opens above the list and the panel scrolls by its
 * height, so the picked row stays under the pointer on every frame. ×, the row
 * again and Escape each close it the same way, and focus stays on the row.
 */
for (const surface of [
  { name: 'VOD recap', scenario: 'vod-ready', twitchKind: 'vod', row: 1, height: 900 },
  { name: 'live', scenario: 'live-ready', twitchKind: 'live', row: 0, height: 1000 },
] as const) {
  for (const at of [0.5, 0.85]) {
    test(`a Top Moments pick opens the card above the list and leaves the row under the pointer (${surface.name}, row at ${at})`, async ({ extension, prepare }) => {
      await prepare({ scenario: surface.scenario, twitchKind: surface.twitchKind, storage: SIDEBAR })
      const page = extension.page
      const { root, body, rows, card, anyCard } = await openPanel(page, surface.height)
      const row = rows.nth(surface.row)
      await placeInPanel(body, row, at)
      expect(await body.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
      const scrollTop = await body.evaluate(el => el.scrollTop)
      const rowTop = (await box(row)).y

      await recordDrift(body, surface.row)
      await clickInPlace(page, row)
      await expect(row).toHaveAttribute('aria-pressed', 'true')
      await expect(card).toHaveCount(1)
      // The row stays put on every frame while the card opens above it.
      await expectRecordedDriftWithin(page, 1)
      expect(Math.abs((await box(row)).y - rowTop)).toBeLessThanOrEqual(1)
      // The panel scrolled by the card's height, and the whole card is in view.
      const [bodyBox, cardBox] = [await box(body), await box(card)]
      expect(Math.abs(await body.evaluate(el => el.scrollTop) - scrollTop - cardBox.height)).toBeLessThanOrEqual(2)
      expect(cardBox.y).toBeGreaterThanOrEqual(bodyBox.y)
      expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(bodyBox.y + bodyBox.height)
      // A list pick opens no card under the chart or in the list.
      await expect(root.locator('.pulse-moment-slot')).toHaveCount(1)
      expect(await isFocused(row)).toBe(true)

      // ×: the row stays put and gets focus back.
      await recordDrift(body, surface.row)
      await card.locator('[aria-label="Clear selected moment"]').click()
      await expect(card).toHaveCount(0)
      await expect(row).toHaveAttribute('aria-pressed', 'false')
      await expectRecordedDriftWithin(page, 1)
      await expect(anyCard).toHaveCount(0)
      expect(Math.abs((await box(row)).y - rowTop)).toBeLessThanOrEqual(1)
      expect(Math.abs(await body.evaluate(el => el.scrollTop) - scrollTop)).toBeLessThanOrEqual(2)
      expect(await isFocused(row)).toBe(true)

      // The row again: opens, then closes, without moving.
      await clickInPlace(page, row)
      await expect(card).toHaveCount(1)
      await settled(card)
      await recordDrift(body, surface.row)
      await clickInPlace(page, row)
      await expect(card).toHaveCount(0)
      await expect(row).toHaveAttribute('aria-pressed', 'false')
      await expectRecordedDriftWithin(page, 1)
      expect(Math.abs((await box(row)).y - rowTop)).toBeLessThanOrEqual(1)
      expect(await isFocused(row)).toBe(true)

      // Escape on the focused row: the same.
      await page.keyboard.press('Enter')
      await expect(card).toHaveCount(1)
      await settled(card)
      expect(Math.abs((await box(row)).y - rowTop)).toBeLessThanOrEqual(1)
      await recordDrift(body, surface.row)
      await page.keyboard.press('Escape')
      await expect(card).toHaveCount(0)
      await expectRecordedDriftWithin(page, 1)
      expect(Math.abs((await box(row)).y - rowTop)).toBeLessThanOrEqual(1)
      expect(await isFocused(row)).toBe(true)
    })
  }
}

/**
 * The edge case: with the list just under the panel's top edge there is not
 * the card's height to scroll away above it. The card wins: it opens fully in
 * view, 8 px below the edge, and the row moves down only by what could not be
 * scrolled. Closing it then leaves the row where it is.
 */
test('with Top Moments at the top of the panel, the card opens in view and the row moves as little as possible', async ({ extension, prepare }) => {
  await prepare({ scenario: 'vod-ready', twitchKind: 'vod', storage: SIDEBAR })
  const page = extension.page
  // Short enough that the panel can scroll the list up to its top edge.
  const { body, rows, card } = await openPanel(page, 520)
  const row = rows.nth(0)
  // The list starts 40 px below the panel's top edge.
  await row.scrollIntoViewIfNeeded()
  const bodyBox = await box(body)
  await body.evaluate((el, dy) => { el.scrollTop += dy }, (await box(row)).y - (bodyBox.y + 40))
  const before = await box(row)
  expect(Math.abs(before.y - (bodyBox.y + 40))).toBeLessThanOrEqual(1)

  await clickInPlace(page, row)
  await expect(card).toHaveCount(1)
  await settled(card)
  const [cardBox, after] = [await box(card), await box(row)]
  expect(Math.abs(cardBox.y - (bodyBox.y + 8))).toBeLessThanOrEqual(2)
  const moved = after.y - before.y
  expect(moved).toBeGreaterThan(0)
  expect(moved).toBeLessThan(cardBox.height)
  await recordDrift(body, 0)
  await clickInPlace(page, row)
  await expect(card).toHaveCount(0)
  await expectRecordedDriftWithin(page, 1)
})

test('a wheel right after a low Top Moments pick keeps the scroll the user made', async ({ extension, prepare }) => {
  await prepare({ scenario: 'vod-ready', twitchKind: 'vod', storage: SIDEBAR })
  const { body, rows, card } = await openPanel(extension.page, 900)
  const row = rows.nth(1)
  await placeInPanel(body, row, 0.85)
  const rowBox = await box(row)
  await extension.page.mouse.click(rowBox.x + rowBox.width / 2, rowBox.y + rowBox.height / 2)
  await extension.page.mouse.wheel(0, -250)
  await expect(card).toHaveCount(1)
  // Let the wheel's own scrolling finish, then give any correction every chance.
  let settledTop = -1
  await expect.poll(async () => {
    const now = await body.evaluate(el => el.scrollTop)
    const still = Math.abs(now - settledTop) < 0.5
    settledTop = now
    return still
  }, { intervals: [150] }).toBe(true)
  await extension.page.waitForTimeout(1000)
  expect(Math.abs(await body.evaluate(el => el.scrollTop) - settledTop)).toBeLessThanOrEqual(1)
})

test('live: ranked picks show in the Top Moments card, chart minutes keep the chart card, and a row pick locks the chart', async ({ extension, prepare }) => {
  await prepare({ scenario: 'live-ready', twitchKind: 'live', storage: SIDEBAR })
  const { root, body, rows, card } = await openPanel(extension.page, 1000)
  const chartCard = root.locator('[data-chart-inspector-owner="activity-chart"]:not(.pulse-moment-slot-exit)')
  const row = rows.first()
  const chart = root.locator('svg[data-testid="pulse-overview-chart"]')
  await expect(chart).toBeVisible()
  await expect(card).toHaveCount(0)

  // The strongest-moment shortcut sits with the chart, but a ranked moment
  // shows in the Top Moments card, not under the chart.
  await root.locator('[data-featured-moment="true"]').click()
  await expect(card).toHaveCount(1)
  await expect(row).toHaveAttribute('aria-pressed', 'true')
  await expect(chartCard).toHaveCount(0)
  await expect(chart).toHaveAttribute('data-chart-locked-index', /\d+/)

  // A minute picked on the chart opens under the chart; the Top Moments card
  // closes.
  await chart.scrollIntoViewIfNeeded()
  const plot = await box(chart)
  await extension.page.mouse.click(plot.x + plot.width * 0.5, plot.y + plot.height * 0.5)
  await expect(chartCard).toHaveAttribute('data-chart-inspector-kind', 'minute')
  await expect(card).toHaveCount(0)
  await expect(row).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => chartCard.evaluate(el => el.getAnimations().every(animation => animation.playState === 'finished'))).toBe(true)

  // A Top Moments pick closes the chart's card and opens the Top Moments card,
  // both above the row; the panel scrolls to keep the row under the pointer,
  // and the chart locks the pick.
  await placeInPanel(body, row, 0.6)
  await recordDrift(body, 0)
  await clickInPlace(extension.page, row)
  await expect(card).toHaveCount(1)
  await expect(root.locator('[data-chart-inspector-owner="activity-chart"]')).toHaveCount(0)
  await expectRecordedDriftWithin(extension.page, 1)
  await expect(root.locator('[data-chart-readout="true"][data-chart-readout-state="selected"]')).toBeAttached()
  await expect(chart).toHaveAttribute('data-chart-locked-index', /\d+/)
  expect(await isFocused(row)).toBe(true)

  // Escape closes the card and keeps focus on the row; Enter picks it again.
  await extension.page.keyboard.press('Escape')
  await expect(card).toHaveCount(0)
  await expect(row).toHaveAttribute('aria-pressed', 'false')
  expect(await isFocused(row)).toBe(true)
  await extension.page.keyboard.press('Enter')
  await expect(card).toHaveCount(1)
  expect(await isFocused(row)).toBe(true)

  // A chart click on another minute takes the selection back to the chart.
  await chart.scrollIntoViewIfNeeded()
  const again = await box(chart)
  await extension.page.mouse.click(again.x + again.width * 0.25, again.y + again.height * 0.5)
  await expect(chartCard).toHaveAttribute('data-chart-inspector-kind', 'minute')
  await expect(card).toHaveCount(0)
})

/**
 * A clip picked in the carousel below the list pins its minute, so the chart's
 * card opens above what was pressed. With too little room above, the card
 * stays fully in view and the clip moves only as far as that takes. The live
 * payload names its archive, so the clip pins its minute in the click itself
 * rather than after a worker round trip that, on a loaded machine, can land
 * after the press has been let go.
 */
test('live: a chart card opening above a pressed clip stays in view and moves the clip as little as possible', async ({ extension, prepare }) => {
  await prepare({ scenario: 'live-ready', twitchKind: 'live', storage: SIDEBAR })
  // Tall enough to keep the clips in view below the chart and Top Moments.
  await extension.page.setViewportSize({ width: 1440, height: 1100 })
  const live = JSON.parse(readFileSync(new URL('../fixtures/api/pulse-live-ready.json', import.meta.url), 'utf8'))
  await extension.context.route('https://api.streampulse.stream/v1/extension/pulse/channels/fixturechan*', async route => {
    if (new URL(route.request().url()).pathname.endsWith('/fixturechan')) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...live, vodId: '2806037629' }) })
    } else {
      await route.fallback()
    }
  })
  await extension.context.route('**/v1/channels/*/clips?*', route => route.fulfill({ json: { items: [
    { id: 'live-clip', title: 'Live archive clip', url: 'https://clips.twitch.tv/FixtureLive', videoId: '2806037629', vodOffsetSeconds: 305, viewCount: 20, createdAt: '2026-07-11T18:06:00.000Z' },
  ] } }))
  await extension.context.route('https://clips.twitch.tv/**', route => route.fulfill({ body: 'Clip fixture' }))
  await openTwitchChannel(extension.page)
  await waitForPulseRoot(extension.page)
  const root = extension.page.locator('#streamclone-pulse-root')
  const body = root.locator('.pulse-panel-body')
  const clip = root.getByRole('link', { name: 'Clip spike: Live archive clip' })
  await expect(clip).toBeVisible()

  // The chart's card opens where the chart surface ends: put that 40 px below
  // the panel's top edge, with the clip further down in view.
  const surface = root.locator('[data-chart-surface="true"]')
  await surface.scrollIntoViewIfNeeded()
  const [bodyBox, surfaceBox] = [(await body.boundingBox())!, (await surface.boundingBox())!]
  await body.evaluate((el, dy) => { el.scrollTop += dy }, surfaceBox.y + surfaceBox.height - (bodyBox.y + 40))
  const before = (await clip.boundingBox())!
  expect(before.y).toBeGreaterThan(bodyBox.y + 40)
  expect(before.y + before.height).toBeLessThan(bodyBox.y + bodyBox.height)

  const popup = extension.page.waitForEvent('popup')
  await extension.page.mouse.click(before.x + before.width / 2, before.y + before.height / 2)
  await (await popup).close()
  const chartCard = root.locator('[data-chart-inspector-owner="activity-chart"]')
  await expect(chartCard).toBeVisible()
  await expect.poll(() => chartCard.evaluate(el => el.getAnimations().every(animation => animation.playState === 'finished'))).toBe(true)
  const [card, after] = [(await chartCard.boundingBox())!, (await clip.boundingBox())!]
  // The card's top is inside the panel, 8 px below its edge.
  expect(Math.abs(card.y - (bodyBox.y + 8))).toBeLessThanOrEqual(2)
  const moved = after.y - before.y
  expect(moved).toBeGreaterThan(0)
  expect(moved).toBeLessThan(card.height)
})

/**
 * pulse-live-ready.json with three ranked spikes; `peaks` replaces them when
 * given, and `chatAt` overrides a minute's chat count (the ranking reads the
 * moment's own minute, not only the peak's score).
 */
function liveWithPeaks(peaks?: unknown[], chatAt: Record<number, number> = {}) {
  const live = JSON.parse(readFileSync(new URL('../fixtures/api/pulse-live-ready.json', import.meta.url), 'utf8'))
  const [strongest] = live.peaks
  live.fullRollups = live.fullRollups.map((rollup: { offsetSeconds: number; chatCount: number }) =>
    rollup.offsetSeconds in chatAt ? { ...rollup, chatCount: chatAt[rollup.offsetSeconds] } : rollup)
  return {
    ...live,
    // Live Top Moments lists more than one moment only after 5 completed
    // recent minutes (LIVE_HEAT_MIN_COMPLETED_ROLLUPS); the fixture's recent
    // window has 3, so serve its full minutes as the recent window too.
    rollups: live.fullRollups,
    peaks: peaks ?? [
      strongest,
      { ...strongest, offsetSeconds: 2400, score: 80, chatCount: 60, topEmotes: [] },
      { ...strongest, offsetSeconds: 1200, score: 70, chatCount: 40, topEmotes: [] },
    ],
  }
}

/** Serve the live channel (and its by-stream full request) from `current()`. */
async function serveLive(context: BrowserContext, current: () => unknown): Promise<{ count: () => number }> {
  let count = 0
  const serve = async (route: Route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/fixturechan') || url.pathname.startsWith('/v1/extension/pulse/streams/')) {
      count += 1
      // As in production, only a full-window request carries fullRollups; a
      // recent poll answers with the recent tail alone.
      const body = current() as Record<string, unknown>
      const full = url.searchParams.get('window') === 'full'
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(full ? body : { ...body, fullRollups: undefined }) })
    } else {
      await route.fallback()
    }
  }
  await context.route('https://api.streampulse.stream/v1/extension/pulse/channels/fixturechan*', serve)
  await context.route('https://api.streampulse.stream/v1/extension/pulse/streams/**', serve)
  return { count: () => count }
}

// Codex audit (#70): "The chart locks on that moment, and its own spike marker
// lights up. Clicking the locked column again releases the lock." Spike
// markers are off by default, so the test turns them on first.
test('live: a Top Moments row pick lights its own spike marker, and clicking the locked column releases it', async ({ extension, prepare }, info) => {
  await prepare({ scenario: 'live-ready', twitchKind: 'live', storage: SIDEBAR })
  await serveLive(extension.context, () => liveWithPeaks())
  const { root, rows, card } = await openPanel(extension.page, 1000)
  const chart = root.locator('svg[data-testid="pulse-overview-chart"]')
  const markers = chart.locator('[data-chart-moment-marker="true"]')
  const marker = (offset: number) => chart.locator(`[data-chart-moment-marker="true"][data-chart-moment-marker-offset="${offset}"]`)
  await expect(rows).toHaveCount(3)
  await expect(markers).toHaveCount(0)
  await root.getByRole('button', { name: 'Show spike markers' }).click()
  await expect(markers).toHaveCount(3)
  await expect(chart.locator('[data-chart-moment-marker-state="active"]')).toHaveCount(0)

  for (const [index, offset] of [[0, 3600], [1, 2400]] as const) {
    await rows.nth(index).click()
    await expect(card).toHaveAttribute('data-top-moment-card', 'selected')
    await expect(chart).toHaveAttribute('data-chart-locked-index', /\d+/)
    await expect(marker(offset)).toHaveAttribute('data-chart-moment-marker-state', 'active')
    // Only the picked moment lights; the other two rest.
    await expect(chart.locator('[data-chart-moment-marker-state="active"]')).toHaveCount(1)
    await expect(chart.locator('[data-chart-moment-marker-state="resting"]')).toHaveCount(2)
  }
  await chart.scrollIntoViewIfNeeded()
  await info.attach('spike-marker-active.png', { body: await chart.screenshot(), contentType: 'image/png' })

  // Click the locked column to release the lock: the lit marker's x, low in
  // the plot so the click lands on the column and not on the marker's own
  // diamond (which picks its moment instead).
  const lit = (await marker(2400).boundingBox())!
  const plot = (await chart.locator('[data-chart-scrubber="true"]').boundingBox())!
  const diamond = lit.y + lit.height / 2
  const y = plot.y + plot.height * 0.92
  expect(Math.abs(y - diamond)).toBeGreaterThan(12)
  await extension.page.mouse.click(lit.x + lit.width / 2, y)
  await expect(chart).not.toHaveAttribute('data-chart-locked-index')
  await expect(marker(2400)).toHaveAttribute('data-chart-moment-marker-state', 'resting')
  await expect(chart.locator('[data-chart-moment-marker-state="active"]')).toHaveCount(0)
  await info.attach('spike-marker-released.png', { body: await chart.screenshot(), contentType: 'image/png' })
})

// Codex audit (#70): "Jump and Open Analytics keep keyboard focus through a
// live refresh." The unit tests re-render with new data; this drives a real
// worker poll at the 15 s product minimum, so the test allows two poll waits.
test('live: Jump and Open Analytics keep keyboard focus through a real worker poll', async ({ extension, prepare }, info) => {
  test.setTimeout(120_000)
  await prepare({ scenario: 'live-ready', twitchKind: 'live', storage: { ...SIDEBAR, pollIntervalMs: 15_000, autoUpdateEnabled: true } })
  const base = liveWithPeaks()
  const [strongest, second, third] = base.peaks
  let current: unknown = base
  const served = await serveLive(extension.context, () => current)
  const { rows, card } = await openPanel(extension.page, 1000)
  await expect(rows).toHaveCount(3)
  // Nothing shows above the list until a pick (#80): pick the strongest moment.
  await expect(card).toHaveCount(0)
  await rows.filter({ hasText: '01:00' }).first().click()
  await expect(card).toHaveCount(1)
  expect(await cardLabel(card)).toMatch(/^Selected moment at 01:00/)
  const action = (name: string) => card.locator(`[data-moment-inspector-action="${name}"]`)
  const shadowActive = (name: string) => action(name).evaluate(el => (el.getRootNode() as ShadowRoot).activeElement === el)
  const nextPoll = async () => {
    const before = served.count()
    await expect.poll(served.count, { timeout: 25_000, intervals: [500] }).toBeGreaterThan(before)
  }

  // Jump, reached from the keyboard, on the picked moment. The next poll
  // ranks a new strongest moment at 00:40 first; the card keeps the pick on
  // the same nodes.
  const jump = action('jump')
  await jump.focus()
  await expect.poll(() => shadowActive('jump')).toBe(true)
  const jumpHandle = await jump.elementHandle()
  current = liveWithPeaks([{ ...second, score: 99, chatCount: 400 }, strongest, third], { 2400: 400 })
  await nextPoll()
  await expect.poll(() => rows.first().getAttribute('aria-label'), { timeout: 10_000 }).toContain('00:40')
  expect(await cardLabel(card)).toMatch(/^Selected moment at 01:00/)
  expect(await jumpHandle!.evaluate(el => el.isConnected)).toBe(true)
  expect(await jumpHandle!.evaluate(el => (el.getRootNode() as ShadowRoot).activeElement === el)).toBe(true)
  await info.attach('focus-jump-after-poll.png', { body: await card.screenshot(), contentType: 'image/png' })

  // Open Analytics on a picked moment, through a poll that refines it.
  await rows.filter({ hasText: '00:20' }).first().click()
  await expect(card).toHaveAttribute('data-top-moment-card', 'selected')
  expect(await cardLabel(card)).toMatch(/^Selected moment at 00:20/)
  const analytics = action('analytics')
  const activity = card.locator('[data-moment-inspector-activity="true"]')
  const activityBefore = await activity.textContent()
  expect(activityBefore).toContain('40 chat')
  await analytics.focus()
  await expect.poll(() => shadowActive('analytics')).toBe(true)
  const analyticsHandle = await analytics.elementHandle()
  // The refined payload also changes the picked moment's chat count, so the
  // card visibly takes the refresh; otherwise the checks below could pass
  // before (or without) the new payload ever rendering.
  current = liveWithPeaks(
    [{ ...second, score: 99, chatCount: 400 }, strongest, { ...third, chatCount: 77, reactionApexOffsetSeconds: 1231, refinementStatus: 'refined' }],
    { 2400: 400, 1200: 77 },
  )
  await nextPoll()
  await expect(activity).toContainText('77 chat', { timeout: 10_000 })
  expect(await cardLabel(card)).toMatch(/^Selected moment at 00:20/)
  expect(await analyticsHandle!.evaluate(el => el.isConnected)).toBe(true)
  expect(await analyticsHandle!.evaluate(el => (el.getRootNode() as ShadowRoot).activeElement === el)).toBe(true)
  await info.attach('focus-analytics-after-poll.png', { body: await card.screenshot(), contentType: 'image/png' })
})
