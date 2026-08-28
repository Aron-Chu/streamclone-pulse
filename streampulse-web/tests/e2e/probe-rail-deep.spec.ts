import { test, expect } from '@playwright/test'
test('deep dive: is the rail rendered?', async ({ page }) => {
  await page.goto('http://localhost:5173/analytics', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForTimeout(12_000)
  const info = await page.evaluate(() => {
    const railSection = document.querySelector('.hub-live-rail-section')
    const sibs = railSection ? Array.from(railSection.children).map(c => `${c.tagName}.${c.className.toString().slice(0,60)}`) : []
    // is there a hub-live-wire anywhere?
    const wire = document.querySelectorAll('[class*="hub-live-wire"]').length
    const rightRailSlot = document.querySelector('[class*="right-rail"], [class*="RightRail"]')?.className ?? 'none'
    const allRails = document.querySelectorAll('[class*="rail"]').length
    return { railSection: !!railSection, sibs, wire, rightRailSlot, allRails }
  })
  console.log(JSON.stringify(info, null, 2))
  expect(true).toBe(true)
})
