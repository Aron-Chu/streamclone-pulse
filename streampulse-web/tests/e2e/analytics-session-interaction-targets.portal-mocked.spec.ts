import { writeFile } from 'node:fs/promises'
import { expect, test } from './helpers/portalMockedTest'
import { installPortalAcceptanceHarness, openAnalyticsSession, SIX_SESSION_EMOTE_KEYS } from './helpers/portalAcceptanceHarness'

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
