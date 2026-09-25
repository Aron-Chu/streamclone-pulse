import { test, expect } from '@playwright/test'

for (const width of [390, 1440]) {
  test(`restored homepage at ${width}px retains visible demos and static access`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.route('**/v1/**', route => route.fulfill({ status: 503, body: '{}' }))
    await page.goto('/')
    await expect(page.locator('.sl-fx')).toHaveCount(1)
    await expect(page.locator('.sl-chatbg')).toHaveCount(1)
    await expect(page.locator('.sl-fx')).toBeHidden()
    await expect(page.locator('.sl-optional-demo')).toHaveCount(0)
    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('#landing-main')).toBeFocused()
    await page.locator('#demo').scrollIntoViewIfNeeded()
    await expect(page.locator('.sl-xtour')).toBeVisible()
    await expect(page.locator('.lsg')).toHaveAttribute('data-static', '')
    await page.locator('.lsg').scrollIntoViewIfNeeded()
    await expect(page.locator('.lsg__panel')).toBeVisible()
    expect(await page.locator('.sl-header').evaluate(element => Math.abs(element.getBoundingClientRect().top))).toBeLessThanOrEqual(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    const labels = await page.locator('.lsg__peak-chip').evaluateAll(elements => elements.map(element => {
      const { left, top, right, bottom } = element.getBoundingClientRect()
      return { left, top, right, bottom }
    }))
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i], b = labels[j]
      expect(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top).toBe(true)
    }
    await page.locator('.lsg').screenshot({ path: testInfo.outputPath(`replay-${width}.png`) })
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

test('scrolling reveals the original SVG beats without a click-to-load gate', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/')
  await expect(page.locator('.sl-fx')).toBeVisible()
  await expect(page.locator('.sl-chatbg')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('home-animated.png') })
  await page.locator('#demo').scrollIntoViewIfNeeded()
  await expect(page.locator('.sl-xtour')).toBeVisible()
  await expect(page.locator('.lsg')).not.toHaveAttribute('data-static', '')
  for (const [progress, beat] of [[0.2, '2'], [0.9, '5']] as const) {
    await page.locator('.lsg__scene').evaluate((element, progress) => {
      const top = element.getBoundingClientRect().top + scrollY
      scrollTo(0, top + (element.clientHeight - innerHeight) * progress)
    }, progress)
    await expect(page.locator('.lsg')).toHaveAttribute('data-beat', beat)
  }
  await page.screenshot({ path: testInfo.outputPath('replay-animated.png') })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(page.locator('.lsg')).toHaveAttribute('data-static', '')
  await expect.poll(() => page.locator('.lsg').evaluate(element => getComputedStyle(element).getPropertyValue('--wipe').trim())).toBe('1')
  await expect(page.locator('.lsg__sticky')).toHaveCSS('transform', 'none')
})

test('the prerendered SVG remains readable with JavaScript disabled', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto(baseURL ?? 'http://127.0.0.1:4173')
  await expect(page.locator('.lsg')).toHaveAttribute('data-static', '')
  await expect(page.locator('.lsg__panel')).toBeVisible()
  await expect(page.getByText('Highest sample chat rate', { exact: true })).toBeVisible()
  await expect(page.locator('#demo')).toContainText('JavaScript is available')
  await context.close()
})
