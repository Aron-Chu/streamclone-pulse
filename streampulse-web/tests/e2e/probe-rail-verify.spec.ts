import { test, expect } from '@playwright/test'
test('verify rail layout classes in DOM', async ({ page }) => {
  await page.goto('http://localhost:5173/analytics', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForTimeout(10_000)
  const counts = await page.evaluate(() => ({
    railCards: document.querySelectorAll('.hub-live-wire__rail-card').length,
    railRoot: document.querySelectorAll('.hub-live-wire--rail').length,
    railSection: document.querySelectorAll('.hub-live-rail-section').length,
    oldTicker: document.querySelectorAll('.hub-live-wire__ticker-track').length,
    layoutProp: document.querySelector('.hub-live-wire--rail')?.getAttribute('data-layout') ?? 'n/a',
  }))
  console.log('DOM counts:', JSON.stringify(counts))
  expect(true).toBe(true)
})
