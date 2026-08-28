import { test, expect } from '@playwright/test'

test('probe stableronaldo session route', async ({ page }, testInfo) => {
  const consoleErrors: string[] = []
  const networkFailures: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300))
  })
  page.on('response', (res) => {
    if (res.status() >= 400 && !res.url().includes('api.streampulse.stream')) networkFailures.push(`${res.status()} ${res.url().slice(0, 200)}`)
  })

  await page.goto('http://localhost:5173/analytics/stableronaldo/2026-08-20', {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  })
  await page.waitForTimeout(15_000)

  const bodyText = (await page.locator('body').innerText().catch(() => '')).slice(0, 4000)
  console.log('\n=== PAGE HEAD (body text) ===')
  console.log(bodyText.replace(/\n{2,}/g, '\n'))

  // Look for gaps in the coverage: check if the chart canvas/SVG exists and is filled
  const svgCount = await page.locator('svg').count().catch(() => 0)
  const canvasCount = await page.locator('canvas').count().catch(() => 0)
  console.log(`\nSVG elements: ${svgCount}, Canvas: ${canvasCount}`)

  await page.screenshot({ path: testInfo.outputPath('stable-full.png'), fullPage: true })
  console.log('\nScreenshot: ' + testInfo.outputPath('stable-full.png'))

  console.log('\n=== CONSOLE ERRORS (' + consoleErrors.length + ') ===')
  consoleErrors.slice(0, 15).forEach((e) => console.log('  ' + e))
  console.log('\n=== NETWORK FAILURES (non-API) (' + networkFailures.length + ') ===')
  networkFailures.slice(0, 20).forEach((e) => console.log('  ' + e))

  expect(true).toBe(true)
})
