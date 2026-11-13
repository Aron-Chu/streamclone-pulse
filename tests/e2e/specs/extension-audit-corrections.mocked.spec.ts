import { readFileSync, writeFileSync } from 'node:fs'
import { test, expect } from '../helpers/testFixtures.ts'
import { openTwitchChannel, openTwitchVod } from '../helpers/mockTwitch.ts'
import { waitForPulseRoot } from '../helpers/assertions.ts'

// Real built extension on the existing intercepted Twitch/API fixtures only.
// No live Twitch, provider call or existing profile reload is used.
test('bottom dock stays inside video/chat/nav bounds, including a sub-280 interval and no video', async ({ extension, prepare }, info) => {
  await prepare({ scenario: 'live-ready', twitchKind: 'live', storage: { overlayPlacement: 'bottom', overlayMode: 'expanded', defaultChartWindowMigratedToRecentV2: true } })
  const page = extension.page
  await openTwitchChannel(page)
  await waitForPulseRoot(page)
  const shell = page.locator('#streamclone-pulse-root .placement-bottom')
  const matrix = [
    { width: 1024, left: 0, right: 684, chat: 684, nav: 0 },
    { width: 1280, left: 50, right: 940, chat: 940, nav: 50 },
    { width: 1440, left: 240, right: 1100, chat: 1100, nav: 240 },
    { width: 1920, left: 240, right: 1580, chat: 1580, nav: 240 },
    { width: 1440, left: 0, right: 1440, chat: 1100, nav: 0 },
    { width: 1280, left: 50, right: 1280, chat: null, nav: 50 },
    { width: 640, left: 50, right: 300, chat: 300, nav: 50 },
    { width: 1440, left: 240, right: 1100, chat: 1100, nav: 240, zeroVideo: true },
    { width: 640, left: 50, right: 300, chat: 300, nav: 50, noVideo: true },
  ]
  const measured = []
  for (const entry of matrix) {
    await page.setViewportSize({ width: entry.width, height: 1000 })
    await page.evaluate(entry => {
      const player = document.querySelector<HTMLElement>('#player')!
      player.style.cssText = `position:fixed;left:${entry.left}px;top:0;width:${entry.right-entry.left}px;height:600px;flex:none`
      if (entry.noVideo) player.querySelectorAll('video').forEach(video => video.remove())
      if (entry.zeroVideo) player.querySelectorAll('video').forEach(video => { video.style.display = 'none' })
      const chat = document.querySelector<HTMLElement>('.channel-root__right-column')!
      chat.style.cssText = entry.chat === null ? 'display:none' : `position:fixed;left:${entry.chat}px;top:0;width:${entry.width-entry.chat}px;min-width:0;height:100vh`
      const nav = document.querySelector<HTMLElement>('.side-nav') ?? document.body.appendChild(document.createElement('aside'))
      nav.className = 'side-nav'
      nav.style.cssText = `position:fixed;left:0;top:0;width:${entry.nav}px;height:100vh`
    }, entry)
    await expect.poll(async () => {
      const rect = await shell.boundingBox()
      return Boolean(rect && rect.x >= entry.left - 0.5 && rect.x + rect.width <= Math.min(entry.right, entry.chat ?? entry.right) + 0.5)
    }).toBe(true)
    const box = await shell.boundingBox()
    if (entry.zeroVideo) expect(box!.width).toBeGreaterThanOrEqual(827)
    measured.push({ ...entry, box })
  }
  await page.screenshot({ path: info.outputPath('dock-narrow-no-video.png'), animations: 'disabled' })
  const boundsPath = info.outputPath('dock-bounds.json')
  writeFileSync(boundsPath, JSON.stringify(measured, null, 2))
  await info.attach('dock-bounds', { path: boundsPath, contentType: 'application/json' })
})

async function expectSharedRing(locator: import('@playwright/test').Locator) {
  await locator.page().keyboard.press('Tab')
  await locator.focus()
  await expect.poll(() => locator.evaluate(el => {
    const style = getComputedStyle(el)
    const rgb = style.getPropertyValue('--pulse-accent-light-rgb').match(/\d+/g)?.join(', ') ?? '196, 181, 253'
    return { width: style.outlineWidth, style: style.outlineStyle, offset: style.outlineOffset, accent: style.outlineColor === `rgba(${rgb}, 0.95)` }
  })).toEqual({ width: '2px', style: 'solid', offset: '2px', accent: true })
}

test('one accent ring reaches shadow controls and owned settings/library roots; game cards keep their border exception', async ({ extension, prepare }, info) => {
  await prepare({ scenario: 'vod-ready', twitchKind: 'vod', storage: { overlayPlacement: 'sidebar', overlayMode: 'expanded', sidebarTab: 'pulse', defaultChartWindowMigratedToRecentV2: true } })
  const page = extension.page
  await openTwitchVod(page)
  await waitForPulseRoot(page)
  await expectSharedRing(page.locator('#streamclone-pulse-root .pulse-chart-expand-btn').first())
  const chart = page.locator('#streamclone-pulse-root [data-testid="pulse-overview-chart"]').first()
  await expect(chart).toBeVisible()
  expect(await chart.evaluate(svg => {
    const line = svg.querySelector('[data-chart-viewer-line]')!
    const tag = svg.querySelector('[data-chart-viewer-lane-label]')!
    return { after: Boolean(line.compareDocumentPosition(tag) & Node.DOCUMENT_POSITION_FOLLOWING), fill: getComputedStyle(tag.querySelector('rect')!).fill }
  })).toEqual({ after: true, fill: 'rgb(8, 15, 24)' })
  const game = page.locator('#streamclone-pulse-root .pulse-games-card').first()
  if (await game.count()) {
    await game.focus()
    await expect(game).toHaveClass(/pulse-games-card-active/)
    expect(await game.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('none')
    expect(await game.evaluate(el => getComputedStyle(el).borderColor)).toContain('0.95')
  }
  await page.goto(`chrome-extension://${extension.extensionId}/options/index.html`)
  await expectSharedRing(page.locator('.pulse-host-nav a').first())
  await page.getByRole('link', { name: 'My Moments', exact: true }).click()
  await expectSharedRing(page.locator('.pl-library button').first())
  await page.screenshot({ path: info.outputPath('library-focus.png'), animations: 'disabled' })
  const foreign = await page.evaluateHandle(() => {
    const button = document.body.appendChild(document.createElement('button'))
    button.textContent = 'Foreign fixture control'
    return button
  })
  await foreign.evaluate(button => button.focus())
  expect(await foreign.evaluate(button => getComputedStyle(button).outlineColor)).not.toMatch(/0\.95\)$/)
  await foreign.dispose()
})

test('narrow selected actions retain full names and keep the moment list steady', async ({ extension, prepare }, info) => {
  await prepare({ scenario: 'live-ready', storage: { overlayPlacement: 'sidebar', overlayMode: 'expanded', sidebarTab: 'pulse', defaultChartWindowMigratedToRecentV2: true } })
  const page = extension.page
  await page.setViewportSize({ width: 1000, height: 1800 })
  await openTwitchChannel(page)
  await waitForPulseRoot(page)
  const root = page.locator('#streamclone-pulse-root')
  const rows = root.locator('.pulse-moment-row-button')
  await rows.first().click()
  const card = root.locator('[data-top-moment-card="selected"]')
  await expect(card).toBeVisible()
  // A genuinely narrower native chat column drives the actual host layout;
  // no chart coordinates or application placement attributes are rewritten.
  await page.locator('.channel-root__right-column').evaluate(el => { (el as HTMLElement).style.cssText = 'width:260px;min-width:260px;position:fixed;right:0;top:0;height:100vh' })
  await page.locator('[data-test-selector="chat-room-component-layout"]').evaluate(el => { (el as HTMLElement).style.minWidth = '0' })
  const link = card.getByRole('button', { name: 'Open Analytics' })
  await expect.poll(() => link.evaluate(el => {
    const text = el.querySelector<HTMLElement>('.pulse-sel-link-text')!
    const range = document.createRange()
    range.selectNodeContents(text)
    const glyphs = range.getBoundingClientRect(), bounds = text.getBoundingClientRect()
    return text.scrollWidth <= text.clientWidth + 1 && glyphs.left >= bounds.left - 1 && glyphs.right <= bounds.right + 1
  })).toBe(true)
  await page.waitForTimeout(700)
  const before = await rows.first().boundingBox()
  if (await rows.count() > 1) {
    await rows.nth(1).click()
    await page.waitForTimeout(500)
    const after = await rows.first().boundingBox()
    expect(Math.abs(after!.y - before!.y)).toBeLessThanOrEqual(1)
  }
  await card.screenshot({ path: info.outputPath('narrow-action-card.png'), animations: 'disabled' })
})

// Read both widths in one animation frame: comparing rectangles obtained on
// different frames can mistake the unchanged entrance scale for partial width.
test('floating outage Retry spans its footer during and after the entrance animation', async ({ extension, prepare }, info) => {
  await prepare({ scenario: 'api-500', storage: { overlayPlacement: 'right' } })
  const page = extension.page
  await openTwitchChannel(page)
  await waitForPulseRoot(page)
  const footer = page.locator('#streamclone-pulse-root .pulse-error-block .pulse-footer-actions')
  await expect(footer.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
  const frames = await footer.evaluate(async el => {
    const shell = el.closest('.pulse-shell')!
    const button = el.querySelector('button')!
    const samples = []
    for (let i = 0; i < 25; i++) {
      samples.push({ row: el.getBoundingClientRect().width, button: button.getBoundingClientRect().width, transform: getComputedStyle(shell).transform, running: shell.getAnimations().some(animation => animation.playState === 'running') })
      await new Promise(requestAnimationFrame)
    }
    return samples
  })
  const framePath = info.outputPath('same-frame-widths.json')
  writeFileSync(framePath, JSON.stringify(frames, null, 2))
  await info.attach('same-frame-widths', { path: framePath, contentType: 'application/json' })
  for (const sample of frames) expect(Math.abs(sample.row - sample.button)).toBeLessThanOrEqual(1)
  await expect.poll(() => footer.evaluate(el => el.closest('.pulse-shell')!.getAnimations().every(animation => animation.playState !== 'running'))).toBe(true)
  const row = await footer.boundingBox(), button = await footer.getByRole('button', { name: 'Retry', exact: true }).boundingBox()
  expect(Math.abs(row!.width - button!.width)).toBeLessThanOrEqual(1)
})

for (const width of [260, 218]) for (const images of ['loaded', 'refused'] as const) {
  test(`action wrapping reserves the initial card height for 0/1/3 emotes at ${width}px (${images} images)`, async ({ extension, prepare }, info) => {
    await prepare({ scenario: 'live-ready', storage: { overlayPlacement: 'sidebar', overlayMode: 'expanded', sidebarTab: 'pulse', defaultChartWindowMigratedToRecentV2: true } })
    const live = JSON.parse(readFileSync(new URL('../fixtures/api/pulse-live-ready.json', import.meta.url), 'utf8'))
    const [three] = live.peaks
    const peaks = [
      { ...three, offsetSeconds: 3240, score: 95, topEmotes: [] },
      { ...three, offsetSeconds: 3420, score: 80, topEmotes: three.topEmotes.slice(0, 1) },
      three,
    ]
    const rollups = Array.from({ length: 12 }, (_, index) => ({ ...live.rollups[0], offsetSeconds: 2940 + index * 60 }))
    await extension.context.route('https://static-cdn.jtvnw.net/**', route => images === 'refused' ? route.abort() : route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="56"/>' }))
    await extension.context.route('https://api.streampulse.stream/v1/extension/pulse/channels/fixturechan*', route => new URL(route.request().url()).pathname.endsWith('/fixturechan')
      ? route.fulfill({ json: { ...live, peaks, rollups, games: live.games.map((game: { gameName: string }) => game.gameName === 'League of Legends' ? { ...game, categoryId: '21779' } : game) } })
      : route.fallback())
    const page = extension.page
    await page.setViewportSize({ width: 1000, height: 2200 })
    await openTwitchChannel(page)
    await waitForPulseRoot(page)
    await page.locator('.channel-root__right-column').evaluate((el, width) => { (el as HTMLElement).style.cssText = `width:${width}px;min-width:${width}px;position:fixed;right:0;top:0;height:100vh` }, width)
    await page.locator('[data-test-selector="chat-room-component-layout"]').evaluate(el => { (el as HTMLElement).style.minWidth = '0' })
    const root = page.locator('#streamclone-pulse-root'), rows = root.locator('.pulse-moment-row-button'), card = root.locator('[data-top-moment-card="selected"]')
    await expect(root.locator('.placement-sidebar')).toHaveCSS('width', `${width}px`)
    await rows.first().click()
    await expect(card.locator('[data-moment-inspector-emote-row]')).toHaveCount(0)
    await expect.poll(() => card.evaluate(el => el.getAnimations({ subtree: true }).every(animation => animation.playState !== 'running'))).toBe(true)
    const layouts: unknown[] = []
    const recordLayout = async (count: number) => {
      for (const label of ['Jump in player', 'Save', 'Open Analytics']) {
        const action = card.getByRole('button', { name: label, exact: label !== 'Save' })
        await expect(action).toBeVisible()
        expect(await action.evaluate(button => {
          const text = document.createRange(); text.selectNodeContents(button)
          const glyphs = text.getBoundingClientRect(), bounds = button.getBoundingClientRect()
          return glyphs.left >= bounds.left - 1 && glyphs.right <= bounds.right + 1 && glyphs.top >= bounds.top - 1 && glyphs.bottom <= bounds.bottom + 1
        })).toBe(true)
      }
      layouts.push(await card.evaluate((el, count) => ({ count, nodes: [el, ...el.querySelectorAll('[data-moment-reserve], .pulse-sel, .pulse-sel-header, .pulse-sel-detail, .pulse-sel-game, .pulse-sel-activity, .pulse-sel-list, .pulse-sel-actions, .pulse-sel-actions > *')].map(node => {
        const r = node.getBoundingClientRect(), s = getComputedStyle(node)
        return { cls: node.className, width:r.width, height:r.height, y:r.y, font:s.font, lineHeight:s.lineHeight, gap:s.gap, padding:s.padding, margin:s.margin, text:node.classList.contains('pulse-sel-actions') ? node.textContent : undefined }
      }) }), count))
      writeFileSync(info.outputPath('card-layouts.json'), JSON.stringify(layouts, null, 2))
    }
    await recordLayout(0)
    const before = await card.boundingBox(), firstRow = await rows.first().boundingBox()
    for (const [index, count] of [[1, 3], [2, 1], [0, 0]] as const) {
      await rows.nth(index).click()
      await expect(card.locator('[data-moment-inspector-emote-row]')).toHaveCount(count)
      await recordLayout(count)
      const after = await card.boundingBox(), nextRow = await rows.first().boundingBox()
      expect(Math.abs(after!.height - before!.height)).toBeLessThanOrEqual(1)
      expect(Math.abs(nextRow!.y - firstRow!.y)).toBeLessThanOrEqual(1)
    }
    await card.screenshot({ path: info.outputPath('reserved-card.png'), animations: 'disabled' })
  })
}

for (const size of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }]) {
  test(`expanded bottom dock gives useful chart room and keeps Games above Settings at ${size.width}x${size.height}`, async ({ extension, prepare }, info) => {
    await prepare({ scenario: 'live-ready', storage: { overlayPlacement: 'bottom', overlayMode: 'expanded', defaultChartWindowMigratedToRecentV2: true } })
    const page = extension.page
    await page.setViewportSize(size)
    await openTwitchChannel(page)
    await waitForPulseRoot(page)
    const root = page.locator('#streamclone-pulse-root'), chart = root.locator('[data-testid="pulse-overview-chart"]').first(), games = root.locator('.pulse-games-card')
    await expect(root).toHaveAttribute('data-streampulse-styles', 'loaded')
    await expect(chart).toBeVisible()
    await expect(games.first()).toBeVisible()
    await expect.poll(() => root.locator('.pulse-shell').evaluate(el => el.getAnimations().every(animation => animation.playState !== 'running'))).toBe(true)
    const measure = () => root.evaluate(host => {
      const doc = host.shadowRoot!, body = doc.querySelector('.pulse-panel-body')!, shell = doc.querySelector('.pulse-shell')!, chart = doc.querySelector('[data-testid="pulse-overview-chart"]')!, footer = doc.querySelector('.pulse-settings-bottom-bar')!
      const box = (el: Element) => { const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, top:r.top, bottom:r.bottom, left:r.left, right:r.right } }
      const bodyBox=box(body), chartBox=box(chart), settings=box(footer)
      return { shell:box(shell), body:bodyBox, chart:chartBox, settings, visibleChartHeight:Math.max(0,Math.min(chartBox.bottom,bodyBox.bottom,settings.top)-Math.max(chartBox.top,bodyBox.top)), games:[...doc.querySelectorAll('.pulse-games-card')].map(box), scrollHeight:body.scrollHeight, clientHeight:body.clientHeight, sections:[...doc.querySelectorAll('.pulse-workspace > *, .pulse-section-card > *')].slice(0,24).map(el => ({ tag:el.tagName, cls:el.className, text:el.textContent?.slice(0,45), rect:box(el), gap:getComputedStyle(el).gap, padding:getComputedStyle(el).padding, margin:getComputedStyle(el).margin, flex:getComputedStyle(el).flex })) }
    })
    const before = await measure()
    const path = info.outputPath('bottom-height-before-focus.json')
    writeFileSync(path, JSON.stringify(before,null,2))
    await page.screenshot({ path:info.outputPath('expanded-bottom.png'),animations:'disabled' })
    expect(before.chart.height).toBeGreaterThanOrEqual(160)
    // Initial plot space is bounded by the unchanged content order; the full
    // plot and bottom axis remain reachable by real scrolling and keyboard.
    expect(before.visibleChartHeight).toBeGreaterThanOrEqual(90)
    for (const game of before.games) {
      expect(game.top).toBeGreaterThanOrEqual(before.body.top-1)
      expect(game.bottom).toBeLessThanOrEqual(before.settings.top+1)
    }
    await page.keyboard.press('Tab')
    await games.first().focus()
    await expect(games.first()).toBeFocused()
    const after = await measure()
    writeFileSync(info.outputPath('bottom-height-after-focus.json'),JSON.stringify(after,null,2))
    expect(after.games[0].bottom).toBeLessThanOrEqual(after.settings.top+1)
    await expect(games.first()).toHaveClass(/pulse-games-card-active/)
    const plot = chart.getByRole('application')
    for (let i=0; i<30 && !(await plot.evaluate(el => el === (el.getRootNode() as ShadowRoot).activeElement)); i++) await page.keyboard.press('Tab')
    await expect(plot).toBeFocused()
    // Down remains native vertical scrolling; Left/Right are chart inspection.
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(150)
    const keyboard = await measure()
    writeFileSync(info.outputPath('bottom-height-keyboard-chart.json'),JSON.stringify(keyboard,null,2))
    expect(keyboard.visibleChartHeight).toBeGreaterThanOrEqual(keyboard.chart.height-1)
    const body = root.locator('.pulse-panel-body')
    await body.hover()
    await page.mouse.wheel(0, -900)
    await page.waitForTimeout(150)
    await page.mouse.wheel(0, 180)
    await page.waitForTimeout(150)
    // Actual wheel input must reach the complete unmodified SVG and bottom axis.
    const scrolled = await measure()
    expect(scrolled.visibleChartHeight).toBeGreaterThanOrEqual(scrolled.chart.height-1)
    await page.screenshot({path:info.outputPath('bottom-full-chart-scrolled.png'),animations:'disabled'})
    writeFileSync(info.outputPath('bottom-height-scrolled.json'),JSON.stringify(scrolled,null,2))
  })
}
