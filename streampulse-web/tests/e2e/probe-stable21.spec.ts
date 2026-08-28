import { test, expect } from '@playwright/test'
test('probe stableronaldo 2026-08-21', async ({ page }, testInfo) => {
  const consoleErrors: string[] = []
  const netFail: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)) })
  page.on('response', (r) => { if (r.status() >= 400) netFail.push(`${r.status()} ${r.url().slice(0, 140)}`) })
  await page.goto('http://localhost:5173/analytics/stableronaldo/2026-08-21', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForTimeout(14_000)
  const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 2500)
  console.log('=== BODY ===')
  console.log(body.replace(/\n{2,}/g, '\n'))
  await page.screenshot({ path: testInfo.outputPath('stable21.png'), fullPage: true })
  console.log('\nscreenshot:', testInfo.outputPath('stable21.png'))
  console.log('=== CONSOLE ERRORS ===')
  consoleErrors.slice(0, 10).forEach((e) => console.log('  ' + e))
  console.log('=== NET FAIL (all) ===')
  netFail.slice(0, 20).forEach((e) => console.log('  ' + e))
  expect(true).toBe(true)
})
