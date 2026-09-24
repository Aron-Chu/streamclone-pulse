import { test, expect } from '../helpers/testFixtures.ts'

for (const scenario of ['live-ready', 'api-500'] as const) {
  test(`popup navigation stays available with ${scenario}`, async ({ extension, prepare }, info) => {
    await prepare({ scenario })
    await extension.context.route('https://streampulse.stream/**', route => route.fulfill({
      contentType: 'text/html',
      body: '<title>Mock portal destination</title>',
    }))
    const popup = extension.page
    await popup.setViewportSize({ width: 380, height: 600 })
    const popupUrl = `chrome-extension://${extension.extensionId}/popup/index.html`
    await popup.goto(popupUrl)
    const hub = popup.getByRole('button', { name: /Open analytics hub/ })
    await expect(hub).toBeInViewport()
    const openedHub = extension.context.waitForEvent('page')
    await hub.click()
    const analytics = await openedHub
    await expect(analytics).toHaveURL('https://streampulse.stream/analytics')
    expect(await analytics.evaluate(() => window.opener === null)).toBe(true)
    await analytics.close()

    for (const [name, section] of [['Open settings', 'pulse'], ['My Moments', 'moments']]) {
      await popup.bringToFront()
      const openedSettings = extension.context.waitForEvent('page')
      await popup.getByRole('button', { name, exact: true }).click()
      const settings = await openedSettings
      await expect(settings).toHaveURL(`chrome-extension://${extension.extensionId}/options/index.html#${section}`)
      await expect(settings.locator('.pulse-host')).toHaveAttribute('data-host-active-section', section)
      await expect(settings.locator('#settings-content')).toBeVisible()
      await expect(settings.locator('main')).toHaveCount(1)
      await settings.close()
    }
    await popup.bringToFront()
    await popup.screenshot({ path: info.outputPath(`popup-${scenario}.png`), animations: 'disabled' })
  })
}

test('Supporter leads settings and section navigation remains consistent at every width', async ({ extension, prepare }, info) => {
  await prepare()
  const page = extension.page
  await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#pulse`)
  const banner = page.locator('[data-settings-host-banner="supporter"]')
  const sections = [
    ['My Moments', 'moments'],
    ['Pulse on Twitch', 'pulse'],
    ['Account & Supporter', 'supporter'],
    ['Privacy & Data', 'privacy'],
    ['Updates & Changelog', 'updates'],
  ]

  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(banner).toBeInViewport()
    await expect(page.locator('.pulse-host-main > :first-child')).toHaveAttribute('data-settings-host-banner', 'supporter')
    const bannerBox = await banner.boundingBox()
    const contentBox = await page.locator('#settings-content').boundingBox()
    expect(bannerBox!.y + bannerBox!.height).toBeLessThanOrEqual(contentBox!.y)
    expect(await banner.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    for (const selector of ['strong', 'small', '.pulse-settings-supporter-banner-arrow']) {
      expect(await banner.locator(selector).evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(12)
    }

    await banner.focus()
    await banner.press('Enter')
    await expect(page).toHaveURL(/#supporter$/)
    await expect(page.getByRole('heading', { name: 'Account & Supporter', exact: true })).toBeVisible()
    await expect(banner).toHaveCount(0)
    for (const [name, section] of sections) {
      const link = page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name, exact: true })
      await link.click()
      await expect(link).toHaveAttribute('aria-current', 'page')
      await expect(page).toHaveURL(new RegExp(`#${section}$`))
      await expect(page.locator('.pulse-host')).toHaveAttribute('data-host-active-section', section)
      await expect(page.locator('#settings-content')).toBeVisible()
      await expect(page.locator('main')).toHaveCount(1)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    await page.screenshot({ path: info.outputPath(`settings-navigation-${width}.png`), fullPage: true, animations: 'disabled' })
  }
  await page.goBack()
  await expect(page).toHaveURL(/#privacy$/)
  await expect(page.locator('[data-settings-section-stage="privacy"]')).toBeVisible()
  await page.goForward()
  await expect(page.locator('[data-settings-section-stage="updates"]')).toBeVisible()

  const footer = page.locator('.pulse-host-footer')
  for (const [name, path] of [['Support', '/support'], ['Privacy', '/privacy'], ['Terms', '/terms']]) {
    const link = footer.getByRole('link', { name, exact: true })
    await expect(link).toHaveAttribute('href', `https://streampulse.stream${path}`)
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  }
})
