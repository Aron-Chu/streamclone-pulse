import { expect, test } from './helpers/portalMockedTest'
import { writeFile } from 'node:fs/promises'
import { installHubUxMock } from './helpers/hubUxMock'
import { buildMinutes, installPortalAcceptanceHarness, loadXqcGames, openAnalyticsSession } from './helpers/portalAcceptanceHarness'

test.use({ hasTouch: true })

for (const width of [320, 390]) {
  test(`the ${width}px phone menu receives taps and follows the visual tab order`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    await installHubUxMock(page)
    await page.goto('/analytics')
    await page.evaluate(() => document.fonts.ready)
    const bar = page.locator('.analytics-topnav')
    const search = bar.getByRole('button', { name: 'Search streamers or games' })
    await expect(bar.getByRole('button', { name: 'Navigation menu' })).toBeVisible()
    const discord = bar.locator('.analytics-topnav__discord')
    const hasDiscord = await discord.count() > 0
    if (process.env.PORTAL_EXPECT_DISCORD !== undefined) expect(hasDiscord).toBe(process.env.PORTAL_EXPECT_DISCORD === '1')
    testInfo.annotations.push({ type: 'real-build-Discord', description: hasDiscord ? 'configured' : 'unconfigured' })
    const trigger = bar.getByRole('button', { name: 'Navigation menu' })
    await expect(search).toBeVisible()
    const controls = [search, ...(hasDiscord ? [discord] : []), trigger]
    const boxes = await Promise.all(controls.map(control => control.boundingBox()))
    for (const box of boxes) {
      if (!box) throw new Error('missing analytics control')
      expect(box.width).toBeGreaterThanOrEqual(44)
      expect(box.height).toBeGreaterThanOrEqual(44)
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(width)
      expect(Math.abs(box.y - boxes[0]!.y)).toBeLessThanOrEqual(1)
    }
    expect((await bar.boundingBox())!.height).toBeLessThanOrEqual(54)
    await bar.locator('.analytics-topnav__brand').focus()
    for (const control of controls) { await page.keyboard.press('Tab'); await expect(control).toBeFocused() }
    await trigger.tap()
    const menu = bar.locator('.analytics-topnav__more-links')
    await expect(menu).toHaveCSS('opacity', '1')
    const hits = await menu.locator('a:visible').evaluateAll(links => links.map(link => {
      const b = link.getBoundingClientRect()
      const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)
      return { name: link.textContent, inViewport: b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight, receivesTap: !!hit && link.contains(hit) }
    }))
    expect(hits.length).toBeGreaterThanOrEqual(11)
    for (const hit of hits) expect(hit, hit.name ?? 'menu link').toMatchObject({ inViewport: true, receivesTap: true })
    await writeFile(testInfo.outputPath('menu-hit-targets.json'), JSON.stringify({ width, realDiscordConfigured: hasDiscord, controls: boxes, links: hits }, null, 2))
    await page.screenshot({ path: testInfo.outputPath(`menu-${width}-discord-${hasDiscord}.png`) })
    await menu.getByRole('link', { name: 'Analytics', exact: true }).tap()
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await trigger.tap()
    await menu.getByRole('link', { name: 'Home', exact: true }).focus()
    await page.keyboard.press('Escape')
    await expect(trigger).toBeFocused()
  })

  test(`phone search remains reachable after the bar scrolls away at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    await installHubUxMock(page)
    await page.goto('/analytics')
    const bar = page.locator('.analytics-topnav')
    const search = bar.getByRole('button', { name: 'Search streamers or games' })
    await expect(search).toBeVisible()
    await page.mouse.move(2, 700)
    await page.mouse.wheel(0, 650)
    await expect.poll(async () => { const box = (await bar.boundingBox())!; return box.y + box.height }).toBeLessThan(0)
    await expect(search).toHaveAttribute('data-docked', '')
    const box = await search.boundingBox()
    if (!box) throw new Error('no reachable search action')
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(844)
    expect(box.width).toBeGreaterThanOrEqual(44)
    expect(box.height).toBeGreaterThanOrEqual(44)
    const overlaps = await search.evaluate(button => {
      const target = button.getBoundingClientRect()
      return [...document.querySelectorAll<HTMLElement>('button, a, input')].filter(node => {
        if (node === button || button.contains(node)) return false
        const bounds = node.getBoundingClientRect()
        if (!bounds.width || !bounds.height || bounds.bottom <= 0 || bounds.right <= 0 || bounds.top >= innerHeight || bounds.left >= innerWidth) return false
        let parent: Element | null = node
        while (parent && getComputedStyle(parent).position !== 'fixed') parent = parent.parentElement
        return Boolean(parent) && bounds.left < target.right && bounds.right > target.left && bounds.top < target.bottom && bounds.bottom > target.top
      }).map(node => node.getAttribute('aria-label') || node.textContent)
    })
    expect(overlaps, 'the search action must not cover another fixed control').toEqual([])
    expect(await search.evaluate(button => { const b = button.getBoundingClientRect(); return button.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)) })).toBe(true)
    await writeFile(testInfo.outputPath('reachable-search-target.json'), JSON.stringify({ width, bar: await bar.boundingBox(), search: box, realTapTarget: true }, null, 2))
    await page.screenshot({ path: testInfo.outputPath(`floating-search-${width}.png`) })
    await search.tap()
    const heroInput = page.locator('.hv5-mast .hv5-field input')
    await expect(heroInput).toBeFocused()
    await expect(heroInput).toBeInViewport()
    await heroInput.fill('xqc')
    await expect(heroInput).toHaveValue('xqc')
    await page.screenshot({ path: testInfo.outputPath(`reachable-search-${width}.png`) })
  })
}

test('at 1440px the capped Top today and next existing section share a row', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installHubUxMock(page)
  await page.goto('/analytics')
  const peek = page.locator('.hv5-f3-peek')
  const busy = page.locator('.hv5-busiest')
  await expect(peek).toBeVisible()
  await expect(busy).toBeVisible()
  const left = (await peek.boundingBox())!, right = (await busy.boundingBox())!
  expect(left.width).toBeLessThanOrEqual(720)
  expect(right.width).toBeLessThanOrEqual(720)
  expect(Math.abs(left.y - right.y)).toBeLessThanOrEqual(1)
  expect(left.x + left.width).toBeLessThan(right.x)
  expect(await peek.evaluate((node, nextClass) => Boolean(node.compareDocumentPosition(document.querySelector(nextClass)!) & Node.DOCUMENT_POSITION_FOLLOWING), '.hv5-busiest')).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  await page.screenshot({ path: testInfo.outputPath('adjacent-existing-hub-sections.png') })
})

test('the narrow multi-game header shows the whole fixture title and every KPI', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const harness = await installPortalAcceptanceHarness(page)
  const games = loadXqcGames()
  const lastStart = Number(games[games.length - 1].offsetSeconds)
  const minutes = buildMinutes({ count: 2, withEmotes: false })
  minutes.minutes = [0, 60, 15437, 21617, 32237, lastStart, lastStart + 60].map((offsetSeconds, i) => ({
    offsetSeconds, viewerAvg: 10_000 + i, viewerMax: 10_100 + i, viewerLatest: 10_050 + i,
    viewerSamples: 2, chatCount: 30 + i, totalEmoteCount: 10, seventvEmoteCount: 4, topEmotes: [],
  }))
  harness.setMinutesPayload(minutes)
  harness.setGamesPayload(games)
  await openAnalyticsSession(page)
  await expect(page.getByLabel('Games played').first()).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await expect(page.locator('[data-session-title]')).toHaveText('Deterministic portal acceptance fixture')
  const visibleText = await page.locator('[data-session-title], [data-session-stat-row] .sc-stat-card__label, [data-session-stat-row] .sc-stat-card__value').evaluateAll(nodes => nodes.map(node => {
    const bounds = node.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(node)
    const text = range.getBoundingClientRect()
    return { text: node.textContent, positive: bounds.width > 0 && bounds.height > 0,
      inViewport: bounds.left >= 0 && bounds.right <= innerWidth,
      textFits: text.left >= bounds.left - 0.5 && text.right <= bounds.right + 0.5 && text.top >= bounds.top - 0.5 && text.bottom <= bounds.bottom + 0.5 }
  }))
  expect(visibleText).toHaveLength(13) // one title, six labels, six values
  for (const text of visibleText) expect(text, text.text ?? 'header text').toMatchObject({ positive: true, inViewport: true, textFits: true })
  const cards = await page.locator('[data-session-stat-row] .sc-stat-card').evaluateAll(nodes => nodes.map(node => {
    const box = node.getBoundingClientRect()
    return { left: box.left, right: box.right, fits: box.left >= 0 && box.right <= innerWidth && node.scrollWidth <= node.clientWidth }
  }))
  expect(cards).toHaveLength(6)
  expect(cards.every(card => card.fits)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('complete-narrow-multi-game-header.png') })
})
