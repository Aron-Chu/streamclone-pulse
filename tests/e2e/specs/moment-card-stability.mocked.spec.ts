import { test, expect } from '../helpers/testFixtures.ts'
import { openTwitchChannel } from '../helpers/mockTwitch.ts'
import { waitForPulseRoot } from '../helpers/assertions.ts'

/**
 * Clicking through moments must not move the list being clicked. The card's
 * slot opens once (growing, not snapping), then holds its height while the
 * next moments fade in place.
 */
test('clicking from one moment to the next keeps the moment list still', async ({ extension, prepare }) => {
  await prepare({ scenario: 'vod-ready', twitchKind: 'vod', storage: { overlayPlacement: 'sidebar', sidebarTab: 'pulse', overlayMode: 'expanded' } })
  // Tall enough that no row sits under the pinned Settings bar.
  await extension.page.setViewportSize({ width: 1440, height: 2200 })
  await openTwitchChannel(extension.page)
  await waitForPulseRoot(extension.page)
  const root = extension.page.locator('#streamclone-pulse-root')
  const rows = root.locator('.pulse-moment-row-button')
  await expect(rows).toHaveCount(3)
  const slot = root.locator('.pulse-moment-slot')
  const layout = async () => ({
    slot: Math.round((await slot.boundingBox())!.height),
    rows: await Promise.all([0, 1, 2].map(async index => Math.round((await rows.nth(index).boundingBox())!.y))),
  })

  await rows.nth(0).click()
  await expect(root.locator('[data-selected-moment-card="true"]')).toBeVisible()
  await expect(slot).toHaveCSS('animation-name', 'pulse-slot-open')
  // Let the opening finish before measuring the settled layout.
  await expect.poll(() => slot.evaluate(el => el.getAnimations().every(animation => animation.playState === 'finished'))).toBe(true)
  const settled = await layout()
  expect(settled.slot).toBeGreaterThan(80)

  for (const index of [1, 2, 0]) {
    await rows.nth(index).click()
    await expect(rows.nth(index)).toHaveAttribute('aria-pressed', 'true')
    expect(await layout()).toEqual(settled)
  }
})

/**
 * The first click opens the card above the list: in the recap, right above
 * it; live, under the chart, where a chart click opens it too. The panel
 * scrolls instead, so the card grows upward and the row stays under the
 * pointer, also while the card is closed again with its × button.
 */
for (const surface of [
  { name: 'VOD recap', scenario: 'vod-ready', twitchKind: 'vod', row: 1, at: 0.6, height: 900 },
  // Live, the card sits under the chart, further above the list, so the row
  // needs a lower spot for the whole card to fit above it.
  { name: 'live', scenario: 'live-ready', twitchKind: 'live', row: 0, at: 0.85, height: 1000 },
] as const) {
  test(`the first Top Moments click keeps the clicked row under the pointer (${surface.name})`, async ({ extension, prepare }) => {
    await prepare({ scenario: surface.scenario, twitchKind: surface.twitchKind, storage: { overlayPlacement: 'sidebar', sidebarTab: 'pulse', overlayMode: 'expanded' } })
    await extension.page.setViewportSize({ width: 1440, height: surface.height })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    const root = extension.page.locator('#streamclone-pulse-root')
    const body = root.locator('.pulse-panel-body')
    const row = root.locator('.pulse-moment-row-button').nth(surface.row)
    await row.scrollIntoViewIfNeeded()
    // Put the row low in the panel, the way people reach Top Moments.
    const [bodyBox, rowBox] = [await body.boundingBox(), await row.boundingBox()]
    await body.evaluate((el, dy) => { el.scrollTop += dy }, rowBox!.y - (bodyBox!.y + bodyBox!.height * surface.at))
    expect(await body.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)

    // Record the row's drift on every frame the card's slot changes size, before paint.
    await body.evaluate((el, index) => {
      const target = el.querySelectorAll('.pulse-moment-row-button')[index]!
      const start = target.getBoundingClientRect().top
      const drift: number[] = []
      ;(window as unknown as { __rowDrift: number[] }).__rowDrift = drift
      new MutationObserver((_, observer) => {
        const slot = el.querySelector('.pulse-moment-slot')
        if (!slot) return
        observer.disconnect()
        new ResizeObserver(() => drift.push(target.getBoundingClientRect().top - start)).observe(slot)
      }).observe(el, { childList: true, subtree: true })
    }, surface.row)

    const before = (await row.boundingBox())!
    // A raw mouse click: Playwright's locator.click would scroll the row itself.
    await extension.page.mouse.click(before.x + before.width / 2, before.y + before.height / 2)
    await expect(row).toHaveAttribute('aria-pressed', 'true')
    const slot = root.locator('.pulse-moment-slot')
    await expect.poll(() => slot.evaluate(el => el.getAnimations().every(animation => animation.playState === 'finished'))).toBe(true)
    expect(Math.abs((await row.boundingBox())!.y - before.y)).toBeLessThanOrEqual(2)
    const drift = await extension.page.evaluate(() => (window as unknown as { __rowDrift: number[] }).__rowDrift)
    expect(drift.length).toBeGreaterThan(0)
    expect(Math.max(...drift.map(Math.abs))).toBeLessThanOrEqual(2)
    await expect(root.locator('[data-selected-moment-card="true"]')).toBeInViewport()

    const close = root.getByRole('button', { name: 'Clear selected moment' })
    const closeBox = (await close.boundingBox())!
    await extension.page.mouse.click(closeBox.x + closeBox.width / 2, closeBox.y + closeBox.height / 2)
    await expect(slot).toHaveCount(0)
    expect(Math.abs((await row.boundingBox())!.y - before.y)).toBeLessThanOrEqual(2)
  })
}

/**
 * Live, with Top Moments high in the panel, the card under the chart cannot
 * fit above the row. The card then stays fully in view and the row moves
 * only as far as that takes, never the card's whole height.
 */
test('live: a card that cannot fit above the row stays in view and moves the row as little as possible', async ({ extension, prepare }) => {
  await prepare({ scenario: 'live-ready', twitchKind: 'live', storage: { overlayPlacement: 'sidebar', sidebarTab: 'pulse', overlayMode: 'expanded' } })
  await extension.page.setViewportSize({ width: 1440, height: 900 })
  await openTwitchChannel(extension.page)
  await waitForPulseRoot(extension.page)
  const root = extension.page.locator('#streamclone-pulse-root')
  const body = root.locator('.pulse-panel-body')
  const row = root.locator('.pulse-moment-row-button').first()
  await row.scrollIntoViewIfNeeded()
  const [bodyBox, rowBox] = [await body.boundingBox(), await row.boundingBox()]
  await body.evaluate((el, dy) => { el.scrollTop += dy }, rowBox!.y - (bodyBox!.y + bodyBox!.height * 0.4))
  const before = (await row.boundingBox())!
  await extension.page.mouse.click(before.x + before.width / 2, before.y + before.height / 2)
  await expect(row).toHaveAttribute('aria-pressed', 'true')
  const slot = root.locator('.pulse-moment-slot')
  await expect.poll(() => slot.evaluate(el => el.getAnimations().every(animation => animation.playState === 'finished'))).toBe(true)
  await expect(root.locator('[data-chart-inspector-kind="moment"]')).toBeVisible()
  const [card, after] = [(await slot.boundingBox())!, (await row.boundingBox())!]
  // The card's top is inside the panel, 8 px below its edge.
  expect(Math.abs(card.y - (bodyBox!.y + 8))).toBeLessThanOrEqual(2)
  const moved = after.y - before.y
  expect(moved).toBeGreaterThan(0)
  expect(moved).toBeLessThan(card.height)
})
