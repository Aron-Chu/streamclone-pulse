import { test, expect } from '@playwright/test'

for (const width of [390, 1440]) {
  test(`restored homepage at ${width}px retains visible demos and static access`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.route('**/v1/**', route => route.fulfill({ status: 503, body: '{}' }))
    await page.goto('/')
    await expect(page.locator('.sl-fx')).toHaveCount(1)
    // landing.css hides the chat backdrop at 960px and below, so it is not mounted there.
    await expect(page.locator('.sl-chatbg')).toHaveCount(width >= 961 ? 1 : 0)
    await expect(page.locator('.sl-fx')).toBeHidden()
    await expect(page.locator('.sl-optional-demo')).toHaveCount(0)
    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('#landing-main')).toBeFocused()
    await page.locator('#demo').scrollIntoViewIfNeeded()
    await expect(page.locator('.sl-xtour')).toBeVisible()
    await expect(page.locator('.lsg')).toHaveCount(0)
    expect(await page.locator('.sl-header').evaluate(element => Math.abs(element.getBoundingClientRect().top))).toBeLessThanOrEqual(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    await page.evaluate(() => scrollTo(0, 0))
    await page.screenshot({ path: testInfo.outputPath(`home-${width}.png`) })
    if (width === 390) {
      await page.getByRole('button', { name: 'Menu', exact: true }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeFocused()
    }
  })
}

test('the animated homepage shows the rain, the chat backdrop and the Pulse tab tour', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/')
  await expect(page.locator('.sl-fx')).toBeVisible()
  await expect(page.locator('.sl-chatbg')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('home-animated.png') })
  await page.locator('#demo').scrollIntoViewIfNeeded()
  await expect(page.locator('.sl-xtour')).toBeVisible()
})

test('the prerendered homepage stays readable with JavaScript disabled', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto(baseURL ?? 'http://127.0.0.1:4173')
  await expect(page.locator('#demo')).toContainText('JavaScript is available')
  // The chat backdrop mounts after load on wide screens; it is not in the prerendered HTML.
  await expect(page.locator('.sl-chatbg')).toHaveCount(0)
  await expect(page.locator('#roadmap, #analysis, .lsg')).toHaveCount(0)
  await context.close()
})
