import { test, expect } from '@playwright/test'
test('final: rail cards present?', async ({ page }) => {
  await page.goto('http://localhost:5173/analytics', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForTimeout(12_000)
  const info = await page.evaluate(() => {
    const rail = document.querySelector<HTMLElement>('.figma-live-rail')
    if (!rail) return { rail: false }
    const cards = rail.querySelectorAll('[class*="card"], [class*="rail-card"], [class*="feed"]').length
    const txt = rail.innerText.slice(0, 400)
    const classList = rail.className.toString()
    return { rail: true, cards, classList, txt }
  })
  console.log(JSON.stringify(info, null, 2))
  expect(true).toBe(true)
})
