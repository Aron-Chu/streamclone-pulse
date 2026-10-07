import { readFileSync } from 'node:fs'
import type { Locator } from '@playwright/test'
import { test, expect } from '../helpers/testFixtures.ts'
import { openTwitchChannel } from '../helpers/mockTwitch.ts'
import { waitForPulseRoot } from '../helpers/assertions.ts'

/**
 * A moment picked in a Top Moments list opens its card directly under the
 * picked row, accordion style: the rows above never move, the picked row stays
 * under the pointer, and only the rows below slide down. A minute or marker
 * picked on the chart keeps its card under the chart. One card at a time.
 */

const SIDEBAR = { overlayPlacement: 'sidebar', sidebarTab: 'pulse', overlayMode: 'expanded' } as const

interface Box { x: number; y: number; width: number; height: number }

/**
 * The card a row opened, which sits in the slot right after the row button
 * (read in the page: XPath locators do not reach into the shadow root).
 */
function cardUnder(row: Locator) {
  return row.evaluate(el => {
    const slot = el.nextElementSibling
    const card = slot?.querySelector('[data-selected-moment-card="true"]')
    if (!slot?.classList.contains('pulse-moment-slot') || !card) return null
    const box = (node: Element) => {
      const rect = node.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    }
    const close = card.querySelector('[aria-label="Clear selected moment"]')
    return {
      open: !slot.classList.contains('pulse-moment-slot-exit'),
      settled: slot.getAnimations().every(animation => animation.playState === 'finished'),
      animation: getComputedStyle(slot).animationName,
      row: box(el),
      slot: box(slot),
      card: box(card),
      close: close ? box(close) : null,
    }
  })
}

async function isFocused(element: Locator): Promise<boolean> {
  return element.evaluate(el => (el.getRootNode() as ShadowRoot | Document).activeElement === el)
}

async function expectNoCardUnder(row: Locator): Promise<void> {
  await expect.poll(() => cardUnder(row)).toBeNull()
}

async function expectCardDirectlyBelow(row: Locator): Promise<{ close: Box | null; card: Box; slot: Box }> {
  await expect.poll(async () => {
    const card = await cardUnder(row)
    return Boolean(card?.open && card.settled)
  }).toBe(true)
  const { row: rowBox, slot: slotBox, card: cardBox, close } = (await cardUnder(row))!
  const rowBottom = rowBox.y + rowBox.height
  // The slot starts where the row ends; the card keeps the list's row gap.
  expect(Math.abs(slotBox.y - rowBottom)).toBeLessThanOrEqual(1)
  expect(cardBox.y - rowBottom).toBeGreaterThanOrEqual(0)
  expect(cardBox.y - rowBottom).toBeLessThanOrEqual(8)
  expect(Math.abs(cardBox.x - rowBox.x)).toBeLessThanOrEqual(1)
  return { close, card: cardBox, slot: slotBox }
}

/**
 * Record how far a Top Moments row drifts on every frame a card slot animates,
 * measured after layout and before paint (ResizeObserver), so a correction
 * applied in the same frame counts and a one-frame jump does not hide.
 */
async function recordRowDrift(body: Locator, index: number): Promise<void> {
  await body.evaluate((el, index) => {
    const target = el.querySelectorAll('.pulse-moment-row-button')[index]!
    const start = target.getBoundingClientRect().top
    const drift: number[] = []
    ;(window as unknown as { __rowDrift: number[] }).__rowDrift = drift
    const animating = () => [...el.querySelectorAll('.pulse-moment-slot')]
      .some(slot => slot.getAnimations().some(animation => animation.playState === 'running'))
    const resize = new ResizeObserver(() => { if (animating()) drift.push(target.getBoundingClientRect().top - start) })
    const watch = () => el.querySelectorAll('.pulse-moment-slot').forEach(slot => resize.observe(slot))
    watch()
    new MutationObserver(watch).observe(el, { childList: true, subtree: true })
  }, index)
}

async function expectRecordedDriftWithin(page: import('@playwright/test').Page, px: number): Promise<void> {
  const drift = await page.evaluate(() => (window as unknown as { __rowDrift: number[] }).__rowDrift)
  expect(drift.length).toBeGreaterThan(0)
  expect(Math.max(...drift.map(Math.abs))).toBeLessThanOrEqual(px)
}

/** Scroll the panel so the element's top sits at `at` of the panel's height. */
async function placeInPanel(body: Locator, element: Locator, at: number): Promise<void> {
  await element.scrollIntoViewIfNeeded()
  const [bodyBox, box] = [(await body.boundingBox())!, (await element.boundingBox())!]
  await body.evaluate((el, dy) => { el.scrollTop += dy }, box.y - (bodyBox.y + bodyBox.height * at))
}

test('in a panel too tall to scroll, each Top Moments card opens under its row and the rows above it never move', async ({ extension, prepare }) => {
  await prepare({ scenario: 'vod-ready', twitchKind: 'vod', storage: SIDEBAR })
  // Tall enough that the panel cannot scroll and no row sits under the pinned
  // Settings bar. Picking a row below an open card then moves that row up as
  // the card above it closes: there is nothing to scroll.
  await extension.page.setViewportSize({ width: 1440, height: 2200 })
  await openTwitchChannel(extension.page)
  await waitForPulseRoot(extension.page)
  const root = extension.page.locator('#streamclone-pulse-root')
  const rows = root.locator('.pulse-moment-row-button')
  await expect(rows).toHaveCount(3)
  const tops = () => Promise.all([0, 1, 2].map(async index => (await rows.nth(index).boundingBox())!.y))

  for (const index of [0, 1, 2, 0]) {
    const before = await tops()
    await rows.nth(index).click()
    await expect(rows.nth(index)).toHaveAttribute('aria-expanded', 'true')
    // The card grows open; it does not snap in.
    await expect.poll(async () => (await cardUnder(rows.nth(index)))?.animation).toBe('pulse-slot-open')
    await expectCardDirectlyBelow(rows.nth(index))
    const after = await tops()
    for (let above = 0; above < index; above += 1) {
      expect(Math.abs(after[above] - before[above])).toBeLessThanOrEqual(1)
    }
    // One card: the previous row's card has closed.
    await expect(root.locator('.pulse-moment-slot')).toHaveCount(1)
    await expect(root.locator('.pulse-moment-row-button[aria-expanded="true"]')).toHaveCount(1)
  }
})

test('in a scrollable panel, picking the row below an open card keeps that row under the pointer', async ({ extension, prepare }) => {
  await prepare({ scenario: 'vod-ready', twitchKind: 'vod', storage: SIDEBAR })
  await extension.page.setViewportSize({ width: 1440, height: 900 })
  await openTwitchChannel(extension.page)
  await waitForPulseRoot(extension.page)
  const root = extension.page.locator('#streamclone-pulse-root')
  const body = root.locator('.pulse-panel-body')
  const rows = root.locator('.pulse-moment-row-button')
  await placeInPanel(body, rows.nth(0), 0.3)
  const first = (await rows.nth(0).boundingBox())!
  await extension.page.mouse.click(first.x + first.width / 2, first.y + first.height / 2)
  const { slot } = await expectCardDirectlyBelow(rows.nth(0))
  // The panel can take the closing card's height back by scrolling.
  expect(await body.evaluate(el => el.scrollTop)).toBeGreaterThanOrEqual(slot.height)

  await recordRowDrift(body, 1)
  const before = (await rows.nth(1).boundingBox())!
  await extension.page.mouse.click(before.x + before.width / 2, before.y + before.height / 2)
  await expectCardDirectlyBelow(rows.nth(1))
  await expectNoCardUnder(rows.nth(0))
  expect(Math.abs((await rows.nth(1).boundingBox())!.y - before.y)).toBeLessThanOrEqual(1)
  await expectRecordedDriftWithin(extension.page, 1)
})

/**
 * The first click: the picked row does not move while the card opens, and the
 * card closes again with its × button without moving the row. Picked low in
 * the panel, the card is then scrolled fully into view, never past its row.
 */
for (const surface of [
  { name: 'VOD recap', scenario: 'vod-ready', twitchKind: 'vod', row: 1, height: 900 },
  { name: 'live', scenario: 'live-ready', twitchKind: 'live', row: 0, height: 1000 },
] as const) {
  for (const at of [0.4, 0.85]) {
    test(`a Top Moments click opens the card under the row and leaves the row under the pointer (${surface.name}, row at ${at})`, async ({ extension, prepare }) => {
      await prepare({ scenario: surface.scenario, twitchKind: surface.twitchKind, storage: SIDEBAR })
      await extension.page.setViewportSize({ width: 1440, height: surface.height })
      await openTwitchChannel(extension.page)
      await waitForPulseRoot(extension.page)
      const root = extension.page.locator('#streamclone-pulse-root')
      const body = root.locator('.pulse-panel-body')
      const row = root.locator('.pulse-moment-row-button').nth(surface.row)
      await placeInPanel(body, row, at)
      expect(await body.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
      const bodyBox = (await body.boundingBox())!

      await recordRowDrift(body, surface.row)
      const before = (await row.boundingBox())!
      // A raw mouse click: Playwright's locator.click would scroll the row itself.
      await extension.page.mouse.click(before.x + before.width / 2, before.y + before.height / 2)
      await expect(row).toHaveAttribute('aria-pressed', 'true')
      await expect(row).toHaveAttribute('aria-expanded', 'true')
      await expectCardDirectlyBelow(row)
      // The row stays under the pointer while the card opens.
      await expectRecordedDriftWithin(extension.page, 1)
      // A list pick opens no card under the chart: this is the only card.
      await expect(root.locator('[data-chart-inspector-owner="activity-chart"]')).toHaveCount(0)
      await expect(root.locator('.pulse-moment-slot')).toHaveCount(1)

      if (at < 0.5) {
        // There is room below: nothing scrolls.
        expect(Math.abs((await row.boundingBox())!.y - before.y)).toBeLessThanOrEqual(1)
      } else {
        // Low in the panel, the opened card is then scrolled fully into view,
        // and the row only as far up as that takes, never out of the panel.
        await expect.poll(async () => {
          const card = (await cardUnder(row))!.card
          return card.y + card.height <= bodyBox.y + bodyBox.height - 8 + 1
        }).toBe(true)
        await expect(root.locator('[data-moment-inspector-action="jump"]')).toBeInViewport({ ratio: 1 })
        const rowNow = (await row.boundingBox())!
        expect(rowNow.y).toBeLessThan(before.y)
        expect(rowNow.y).toBeGreaterThanOrEqual(bodyBox.y + 8 - 1)
      }

      const settled = (await row.boundingBox())!
      const { close: closeBox } = (await cardUnder(row))!
      await extension.page.mouse.click(closeBox!.x + closeBox!.width / 2, closeBox!.y + closeBox!.height / 2)
      await expect(root.locator('.pulse-moment-slot')).toHaveCount(0)
      await expect(row).toHaveAttribute('aria-expanded', 'false')
      expect(Math.abs((await row.boundingBox())!.y - settled.y)).toBeLessThanOrEqual(1)
      // Closing hands focus back to the row.
      expect(await isFocused(row)).toBe(true)
    })
  }
}

test('a wheel right after a low Top Moments pick keeps the scroll the user made', async ({ extension, prepare }) => {
  await prepare({ scenario: 'vod-ready', twitchKind: 'vod', storage: SIDEBAR })
  await extension.page.setViewportSize({ width: 1440, height: 900 })
  await openTwitchChannel(extension.page)
  await waitForPulseRoot(extension.page)
  const root = extension.page.locator('#streamclone-pulse-root')
  const body = root.locator('.pulse-panel-body')
  const row = root.locator('.pulse-moment-row-button').nth(1)
  await placeInPanel(body, row, 0.85)
  const box = (await row.boundingBox())!
  await extension.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await extension.page.mouse.wheel(0, -250)
  await expect(row).toHaveAttribute('aria-expanded', 'true')
  // Let the wheel's own scrolling finish, then give a reveal every chance.
  let settled = -1
  await expect.poll(async () => {
    const now = await body.evaluate(el => el.scrollTop)
    const still = Math.abs(now - settled) < 0.5
    settled = now
    return still
  }, { intervals: [150] }).toBe(true)
  await extension.page.waitForTimeout(1000)
  expect(Math.abs(await body.evaluate(el => el.scrollTop) - settled)).toBeLessThanOrEqual(1)
})

test('live: the chart keeps its own card, and a Top Moments pick moves the one card into the list', async ({ extension, prepare }) => {
  await prepare({ scenario: 'live-ready', twitchKind: 'live', storage: SIDEBAR })
  await extension.page.setViewportSize({ width: 1440, height: 1000 })
  await openTwitchChannel(extension.page)
  await waitForPulseRoot(extension.page)
  const root = extension.page.locator('#streamclone-pulse-root')
  const body = root.locator('.pulse-panel-body')
  const chartCard = root.locator('[data-chart-inspector-owner="activity-chart"]:not(.pulse-moment-slot-exit)')
  const row = root.locator('.pulse-moment-row-button').first()
  const chart = root.locator('svg[data-testid="pulse-overview-chart"]')
  await expect(chart).toBeVisible()

  // The strongest-moment shortcut sits with the chart: its moment card opens
  // under the chart, even though the same moment is listed in Top Moments.
  await root.locator('[data-featured-moment="true"]').click()
  await expect(chartCard).toHaveAttribute('data-chart-inspector-kind', 'moment')
  await expectNoCardUnder(row)
  await expect(row).toHaveAttribute('aria-pressed', 'true')
  await expect(row).toHaveAttribute('aria-expanded', 'false')
  await expect(root.locator('.pulse-moment-slot')).toHaveCount(1)

  // A minute picked on the chart opens under the chart, as before.
  await chart.scrollIntoViewIfNeeded()
  const plot = (await chart.boundingBox())!
  await extension.page.mouse.click(plot.x + plot.width * 0.5, plot.y + plot.height * 0.5)
  await expect(chartCard).toHaveAttribute('data-chart-inspector-kind', 'minute')
  await expectNoCardUnder(row)
  await expect(row).toHaveAttribute('aria-expanded', 'false')
  await expect.poll(() => chartCard.evaluate(el => el.getAnimations().every(animation => animation.playState === 'finished'))).toBe(true)

  // A Top Moments pick closes the chart's card and opens its own under the row.
  // The chart's card collapses above the row; the panel scrolls to keep the
  // row under the pointer.
  await placeInPanel(body, row, 0.5)
  const chartCardHeight = (await chartCard.boundingBox())!.height
  expect(await body.evaluate(el => el.scrollTop)).toBeGreaterThanOrEqual(chartCardHeight)
  await recordRowDrift(body, 0)
  const before = (await row.boundingBox())!
  await extension.page.mouse.click(before.x + before.width / 2, before.y + before.height / 2)
  await expect(row).toHaveAttribute('aria-expanded', 'true')
  await expectCardDirectlyBelow(row)
  await expect(root.locator('[data-chart-inspector-owner="activity-chart"]')).toHaveCount(0)
  expect(Math.abs((await row.boundingBox())!.y - before.y)).toBeLessThanOrEqual(1)
  await expectRecordedDriftWithin(extension.page, 1)
  // The chart still marks the picked minute.
  await expect(root.locator('[data-chart-readout="true"][data-chart-readout-state="selected"]')).toBeAttached()
  expect(await isFocused(row)).toBe(true)

  // Escape closes it and keeps focus on the row; Enter opens it again in place.
  await extension.page.keyboard.press('Escape')
  await expectNoCardUnder(row)
  await expect(row).toHaveAttribute('aria-expanded', 'false')
  expect(await isFocused(row)).toBe(true)
  await extension.page.keyboard.press('Enter')
  await expect(row).toHaveAttribute('aria-expanded', 'true')
  await expectCardDirectlyBelow(row)
  expect(await isFocused(row)).toBe(true)

  // A chart click on another minute takes the card back from the list.
  await chart.scrollIntoViewIfNeeded()
  const again = (await chart.boundingBox())!
  await extension.page.mouse.click(again.x + again.width * 0.25, again.y + again.height * 0.5)
  await expect(chartCard).toHaveAttribute('data-chart-inspector-kind', 'minute')
  await expectNoCardUnder(row)
  await expect(row).toHaveAttribute('aria-expanded', 'false')
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
  await extension.page.setViewportSize({ width: 1440, height: 900 })
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
