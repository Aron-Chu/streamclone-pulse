import { test, expect } from '@playwright/test'

/**
 * TEMP probe — captures what the /analytics/jynxzi/2026-08-21 route really
 * renders on 5173 (main hub-ux build): console errors, network failures,
 * visible chart/games elements, and a screenshot. Delete after use.
 */
test('probe jynxzi session route', async ({ page }, testInfo) => {
  const consoleErrors: string[] = []
  const networkFailures: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300))
  })
  page.on('response', (res) => {
    if (res.status() >= 400) networkFailures.push(`${res.status()} ${res.url().slice(0, 200)}`)
  })

  await page.goto('http://localhost:5173/analytics/jynxzi/2026-08-21', {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  })

  // give the console time to mount + fetch hosted API
  await page.waitForTimeout(12_000)

  const bodyText = (await page.locator('body').innerText().catch(() => '')).slice(0, 4000)
  const visibleText = await page
    .locator('body')
    .locator('text=/jynxzi|games|viewers|chat|analytics|untitled|Syncing/i')
    .allInnerTexts()
    .catch(() => [])

  console.log('\n=== PAGE HEAD (body text) ===')
  console.log(bodyText.replace(/\n{2,}/g, '\n'))
  console.log('\n=== KEY TEXT HITS ===')
  console.log(visibleText.slice(0, 20).join(' | '))

  await page.screenshot({
    path: testInfo.outputPath('jynxzi-full.png'),
    fullPage: true,
  })
  console.log('\nScreenshot: ' + testInfo.outputPath('jynxzi-full.png'))

  console.log('\n=== CONSOLE ERRORS (' + consoleErrors.length + ') ===')
  consoleErrors.slice(0, 15).forEach((e) => console.log('  ' + e))
  console.log('\n=== NETWORK FAILURES (' + networkFailures.length + ') ===')
  networkFailures.slice(0, 20).forEach((e) => console.log('  ' + e))

  expect(true).toBe(true)
})