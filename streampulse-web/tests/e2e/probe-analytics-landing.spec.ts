import { test, expect } from '@playwright/test'
test('probe analytics landing for live wire rail', async ({ page }, testInfo) => {
  const consoleErrors: string[] = []
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 200)) })
  await page.goto('http://localhost:5173/analytics', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForTimeout(12_000)
  const rail = await page.locator('.hub-live-wire--rail, .hub-live-rail-section, [class*="rail"]').count().catch(() => 0)
  const railText = await page.locator('.hub-live-rail-section, .hub-live-wire--rail').innerText().catch(() => '')
  console.log('\n=== analytics landing rail ===')
  console.log('rail-ish elements:', rail)
  console.log('rail text head:', railText.slice(0, 300))
  await page.screenshot({ path: testInfo.outputPath('analytics-landing.png'), fullPage: true })
  console.log('screenshot:', testInfo.outputPath('analytics-landing.png'))
  console.log('\n=== console errors ===')
  consoleErrors.slice(0, 10).forEach((e) => console.log('  ' + e))
  expect(true).toBe(true)
})
