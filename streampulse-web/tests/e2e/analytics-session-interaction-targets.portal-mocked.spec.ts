import { writeFile } from 'node:fs/promises'
import { expect, test } from './helpers/portalMockedTest'
import { installPortalAcceptanceHarness, openAnalyticsSession, SIX_SESSION_EMOTE_KEYS, buildDetail, buildMinutes, buildSummary, PORTAL_STREAM_ID, assertNoUnexpected } from './helpers/portalAcceptanceHarness'

for (const width of [390, 768]) {
  test(`named emote controls retain current touch targets at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await installPortalAcceptanceHarness(page)
    await openAnalyticsSession(page)
    const add = page.locator('[data-session-emote-add]')
    await add.click()
    for (const key of SIX_SESSION_EMOTE_KEYS) {
      const currentCheckbox = page.locator(`[data-session-emote="${key}"]`)
      if (await currentCheckbox.count()) await currentCheckbox.check()
      else {
        const chip = page.locator(`[data-chart-overlay-chip="${key}"]`)
        if (await chip.getAttribute('aria-pressed') !== 'true') await chip.click()
      }
    }
    await add.click()
    const line = page.locator('[data-session-emotes-on-chart]')
    await line.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }))
    await expect(page.locator('[data-session-emote-remove]')).toHaveCount(6)
    const targets = await page.locator('[data-session-emote-remove], [data-session-emote-add]').evaluateAll(nodes => nodes.map(node => {
      const b = node.getBoundingClientRect()
      const after = getComputedStyle(node, '::after')
      const inset = (s: string) => Number.isFinite(parseFloat(s)) ? parseFloat(s) : 0
      const hasAfter = after.content !== 'none' && after.content !== 'normal' && after.position === 'absolute'
      const effective = hasAfter ? {
        x: b.x + Math.min(0, inset(after.left)), y: b.y + Math.min(0, inset(after.top)),
        width: b.width - Math.min(0, inset(after.left)) - Math.min(0, inset(after.right)),
        height: b.height - Math.min(0, inset(after.top)) - Math.min(0, inset(after.bottom)),
      } : { x: b.x, y: b.y, width: b.width, height: b.height }
      return { name: node.getAttribute('aria-label') || node.textContent?.trim(), remove: node.hasAttribute('data-session-emote-remove'), physical: { x:b.x,y:b.y,width:b.width,height:b.height }, effective }
    }))
    const targetPath = testInfo.outputPath('control-targets.json')
    await writeFile(targetPath, JSON.stringify({ width, targets }, null, 2))
    await testInfo.attach('control-targets', { path: targetPath, contentType: 'application/json' })
    await line.screenshot({ path: testInfo.outputPath('named-emote-controls.png'), animations: 'disabled' })
    for (const target of targets) {
      expect(target.effective.width, target.name).toBeGreaterThanOrEqual(target.remove ? 32 : 24)
      expect(target.effective.height, target.name).toBeGreaterThanOrEqual(target.remove ? 44 : 24)
    }
    for (let i = 0; i < targets.length; i++) for (let j = i + 1; j < targets.length; j++) {
      const a = targets[i].effective, b = targets[j].effective
      expect(a.x < b.x+b.width-.5 && a.x+a.width > b.x+.5 && a.y < b.y+b.height-.5 && a.y+a.height > b.y+.5, `overlap ${targets[i].name}/${targets[j].name}`).toBe(false)
    }
    const first = targets.find(t => t.remove)!
    // Press the retained expanded target above the visible20px icon, not just its centre.
    const hit = { x:first.physical.x+first.physical.width/2, y:first.effective.y+2 }
    expect(await page.evaluate(({x,y}) => Boolean(document.elementFromPoint(x,y)?.closest('[data-session-emote-remove]')),hit)).toBe(true)
    await page.mouse.click(hit.x, hit.y)
    await expect(page.locator('[data-session-emote-remove]')).toHaveCount(5)
    await expect(add).toBeFocused()
    await expect(line).toContainText('Emotes on chart')
    await expect(line).not.toContainText('Manage')
    await add.click()
    await expect(page.getByRole('group', { name:'Emotes on chart' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(add).toBeFocused()
    await expect(add).toHaveAttribute('aria-expanded','false')
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  })
}

// Compare the actual loading and loaded DOM, rather than duplicating Tailwind height values.
for (const { width, longName } of [
  ...[390, 610, 640, 720, 1440].map(width => ({ width, longName: false })),
  { width: 390, longName: true },
]) {
  test(`initial chart loading reserve at ${width}px${longName ? ' with a long emote name' : ''}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    const harness = await installPortalAcceptanceHarness(page, { clock: false })
    const name = longName ? 'ThisIsAVeryLongButValidNamedEmoteWithFortyLetters' : 'KEKW'
    const topEmotes = [{ key: `twitch:${name}:${name}`, name, provider: 'twitch', id: 'tw1', count: 900,
      imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/tw1/default/dark/1.0' }]
    harness.setSummaryPayload(buildSummary({ topEmotes }))
    harness.setMinutesPayload(JSON.parse(JSON.stringify(buildMinutes({ count: 24, withEmotes: true })).replace(/KEKW/g, name)))
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    await page.route(url => url.pathname.endsWith('/streams/' + PORTAL_STREAM_ID), async route => {
      await held
      await route.fulfill({ json: buildDetail({ topEmotes }) })
    })
    let loadingHeight = 0
    try {
      await page.goto('/analytics/xqc/' + PORTAL_STREAM_ID, { waitUntil: 'domcontentloaded' })
      const status = page.getByRole('status', { name: 'Loading analytics chart' })
      await expect(status).toBeVisible()
      const loading = await status.evaluate(el => {
        const card = el.getBoundingClientRect()
        const readout = el.querySelector('[data-console-skeleton-readout]')!
        const line = readout.getBoundingClientRect()
        return { height: card.height, readoutFits: line.x >= card.x && line.right <= card.right && line.bottom < card.bottom,
          ariaHidden: Boolean(readout.closest('[aria-hidden="true"]')) }
      })
      loadingHeight = loading.height
      expect(loading.readoutFits).toBe(true)
      expect(loading.ariaHidden).toBe(true)
      // Content has not arrived: the loading readout must not fabricate measured minutes.
      await expect(page.locator('[data-session-chart-stack]')).toHaveCount(0)
    } finally { release() }
    const chart = page.getByRole('region', { name: 'Session activity chart' })
    await expect(chart.locator('svg[aria-label="Analytics timeline chart"]')).toBeVisible()
    await expect(page.getByRole('status', { name: 'Loading analytics chart' })).toHaveCount(0)
    if (!longName) await expect.poll(async () => Math.abs((await chart.boundingBox())!.height - loadingHeight)).toBeLessThanOrEqual(1)
    const token = page.locator('[data-session-emote-token]')
    await expect(token).toHaveCount(1)
    await expect(token).toHaveAttribute('title', name)
    const loaded = await chart.boundingBox()
    await writeFile(testInfo.outputPath('loading-transition.json'), JSON.stringify({ width, longName, loadingHeight, loadedHeight: loaded!.height, delta: loaded!.height - loadingHeight }, null, 2))
    if (longName) {
      expect(loaded!.height - loadingHeight, 'one extra 44px touch row plus its 8px gap').toBeLessThanOrEqual(52)
      // A long initial token may wrap beyond the representative reserve; it must remain named and usable.
      await page.getByRole('button', { name: `Remove ${name} from the chart` }).click()
      await expect(token).toHaveCount(0)
      await expect(page.locator('[data-session-emote-add]')).toBeFocused()
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    await assertNoUnexpected(harness)
  })
}
