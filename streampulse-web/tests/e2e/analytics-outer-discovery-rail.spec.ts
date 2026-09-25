import { test, expect } from '@playwright/test'
import { installHubUxMock } from './helpers/hubUxMock'

for (const width of [390, 768, 1440, 1920]) {
  test('outer rail and explicit inspection at '+width+'px', async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1080 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await installHubUxMock(page)
    await page.goto('/analytics')
    const skip = page.getByRole('link', { name: 'Skip to analytics content' })
    await skip.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('#analytics-main')).toBeFocused()
    await page.keyboard.press('Tab')
    const wire = page.getByRole('region', { name: 'Live Wire' })
    await expect(wire.locator('[data-stream-id="s1"]')).toHaveCount(1)
    await expect(page.getByRole('table', { name: 'Pulse Moments', exact: true })).toHaveCount(1)
    await expect(page.locator('[aria-label="Moment Inspector"]')).toContainText('Select a moment')
    await expect(page.locator('.figma-activity-hub .hub-live-wire')).toHaveCount(0)
    const rail = page.locator('.figma-analytics__right-rail')
    const geometry = await page.evaluate(() => {
      const b = (s: string) => document.querySelector(s)!.getBoundingClientRect()
      const r=b('.figma-analytics__right-rail'), c=b('.figma-analytics__center'), n=b('#section-network'), e=b('#section-emote-signal')
      return { railLeft:r.left, railTop:r.top, railBottom:r.bottom, centerRight:c.right, networkBottom:n.bottom, emotesTop:e.top }
    })
    if (width >= 1440) {
      expect(geometry.railLeft).toBeGreaterThanOrEqual(geometry.centerRight)
      await expect(rail).toHaveCSS('position', 'sticky')
      expect((await rail.boundingBox())!.width).toBeCloseTo(380, 0)
    } else {
      expect(geometry.railTop).toBeGreaterThanOrEqual(geometry.networkBottom)
      expect(geometry.emotesTop).toBeGreaterThanOrEqual(geometry.railBottom)
    }
    const chart = page.locator('.hx-chart2').first()
    const before = await chart.boundingBox()
    await chart.hover({ position: { x: before!.width / 2, y: before!.height / 2 } })
    await expect(page.locator('[aria-label="Moment Inspector"]')).toContainText('Select a moment')
    expect(before!.height).toBe(width < 720 ? 320 : 400)
    const overflowingCells = await page.locator('.pulse-moments__table tbody td').evaluateAll((cells) =>
      cells.filter((cell) => {
        const box = cell.getBoundingClientRect()
        if (!box.width) return false
        const row = cell.parentElement!.getBoundingClientRect()
        if (box.left < row.left - 1 || box.right > row.right + 1 || cell.scrollWidth > cell.clientWidth + 1) return true
        return [...cell.children].some((child) => {
          const bounds = child.getBoundingClientRect()
          return bounds.left < box.left - 1 || bounds.right > box.right + 1
        })
      }).map((cell) => cell.getAttribute('data-label')),
    )
    expect(overflowingCells, 'moment cell contents must fit without overlapping adjacent columns').toEqual([])
    const listFits = await page.locator('.pulse-moments__table-wrap').evaluate((element) => element.scrollWidth <= element.clientWidth + 1)
    expect(listFits, 'all compact moment columns must be visible without horizontal scrolling').toBe(true)
    const after = await chart.boundingBox()
    expect(Math.abs(after!.width - before!.width)).toBeLessThan(2)
    await wire.locator('[data-stream-id="s1"]').getByRole('button', { name: /^Show .* on chart$/ }).click()
    await expect(page.locator('[aria-label="Moment Inspector"]')).toContainText('xQc')
    await expect(page.locator('[aria-label="Activity bucket inspector"]')).toContainText('Selected bucket')
    const emoteRows = page.locator('.activity-bucket-inspector .emote-rank-row')
    await expect(emoteRows.first()).toBeVisible()
    for (const row of await emoteRows.all()) {
      const fits = await row.evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        return [...element.children].every((child) => {
          const rect = child.getBoundingClientRect()
          return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 && rect.bottom <= bounds.bottom + 1
        })
      })
      expect(fits, 'bucket emote cells must fit their own row without overlapping the next row').toBe(true)
    }
    for (const label of await page.locator('.activity-bucket-inspector__stats small').all()) {
      await expect(label).toHaveCSS('white-space', 'normal')
      await expect(label).toHaveCSS('text-overflow', 'clip')
    }
    await expect(wire).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    await page.locator('#section-network').screenshot({ path: info.outputPath('network-'+width+'.png') })
    await page.screenshot({ path: info.outputPath('outer-rail-'+width+'.png'), fullPage: true })
  })
}
