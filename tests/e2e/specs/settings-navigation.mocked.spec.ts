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

    // The Discord row opens the website's /discord page; the extension never holds an invite.
    await popup.bringToFront()
    const discord = popup.getByRole('button', { name: 'Join the StreamPulse Discord (opens in a new tab)', exact: true })
    await expect(discord).toBeInViewport()
    const openedDiscord = extension.context.waitForEvent('page')
    await discord.click()
    const discordPage = await openedDiscord
    await expect(discordPage).toHaveURL('https://streampulse.stream/discord')
    await discordPage.close()

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
  await extension.context.route('https://streampulse.stream/**', route => route.fulfill({
    contentType: 'text/html',
    body: '<title>Mock portal destination</title>',
  }))
  const page = extension.page
  await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#pulse`)
  const banner = page.locator('[data-settings-host-banner="supporter"]')
  const community = page.getByRole('complementary', { name: 'Community' })
  // No Help & Feedback section (removed 2026-10-11); the history checks below end on Privacy, then Updates.
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
    // The banner leads the main column, inside the frame its narrow layout queries.
    await expect(page.locator('.pulse-host-main > :first-child > [data-settings-host-banner="supporter"]')).toHaveCount(1)
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
      // The Community card sits under the section list on every section, with a
      // visible subline as each link's description. Feedback makes no privacy
      // promise until the private form opens (FEEDBACK_FORM_LIVE, D19).
      await expect(community).toBeVisible()
      await expect(community.getByRole('link', { name: 'Join the Discord (opens in a new tab)', exact: true })).toHaveAttribute('href', 'https://streampulse.stream/discord')
      await expect(community.getByRole('link', { name: 'Join the Discord (opens in a new tab)', exact: true })).toHaveAccessibleDescription('Public server')
      await expect(community.getByRole('link', { name: 'Send feedback (opens in a new tab)', exact: true })).toHaveAttribute('href', 'https://streampulse.stream/feedback')
      await expect(community.getByRole('link', { name: 'Send feedback (opens in a new tab)', exact: true })).toHaveAccessibleDescription('Ideas or problems')
      await expect(community.getByText('Public server', { exact: true })).toBeVisible()
      await expect(community.getByText('Ideas or problems', { exact: true })).toBeVisible()
      await expect(community).not.toContainText(/private/i)
      // Under the section list, never between it and the page it controls.
      const navBox = await page.getByRole('navigation', { name: 'Settings sections' }).boundingBox()
      const communityBox = await community.boundingBox()
      expect(communityBox!.y).toBeGreaterThanOrEqual(navBox!.y + navBox!.height)
      // No overflow, text may wrap: the card is never wider than the rail it sits in, and no
      // label or subline spills out of its link or runs into the new-tab arrow, at every width
      // and on every platform. Where they do not fit, they wrap inside the link: Linux CI has
      // neither Inter nor Segoe UI and falls back to the much wider DejaVu Sans (the unwrapped
      // card measured 202 px there, CI run 38211670969), and at 320 px "Join the Discord"
      // wraps even with Segoe UI.
      const railWidth = (await page.locator('.pulse-host-rail').boundingBox())!.width
      expect(communityBox!.width, `${width}px`).toBeLessThanOrEqual(railWidth + 0.5)
      for (const link of await community.getByRole('link').all()) {
        const fit = await link.evaluate(element => {
          const copy = element.querySelector<HTMLElement>('.pulse-host-community-copy')!
          const lines = [...copy.children].map(line => Math.round(line.getBoundingClientRect().height / parseFloat(getComputedStyle(line).lineHeight)))
          return { link: element.scrollWidth <= element.clientWidth, copy: copy.scrollWidth <= copy.clientWidth, lines }
        })
        expect(fit.link && fit.copy, `${width}px`).toBe(true)
        // With the UI fonts (Segoe UI here) nothing wraps from 390 px up: the 184 px rail and
        // the 390 px layout look as designed, one line each for the label and the subline.
        if (process.platform === 'win32' && width >= 390) expect(fit.lines, `${width}px`).toEqual([1, 1])
      }
      if (section !== 'supporter') await expect(banner).toBeVisible()
    }
    await page.screenshot({ path: info.outputPath(`settings-navigation-${width}.png`), fullPage: true, animations: 'disabled' })
  }
  await page.goBack()
  await expect(page).toHaveURL(/#privacy$/)
  await expect(page.locator('[data-settings-section-stage="privacy"]')).toBeVisible()
  await page.goForward()
  await expect(page.locator('[data-settings-section-stage="updates"]')).toBeVisible()

  // Updates has no Help link any more, and an old #help link lands on Updates & Changelog.
  await expect(page.getByRole('link', { name: 'Get help or send feedback →', exact: true })).toHaveCount(0)
  await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#help`)
  await expect(page).toHaveURL(/#updates$/)
  await expect(page.locator('[data-settings-section-stage="updates"]')).toBeVisible()
  await expect(page.locator('[data-settings-section="help"]')).toHaveCount(0)

  // Both Community links open the website in a new tab without an opener.
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Pulse on Twitch', exact: true }).click()
  for (const [name, url] of [['Join the Discord (opens in a new tab)', 'https://streampulse.stream/discord'], ['Send feedback (opens in a new tab)', 'https://streampulse.stream/feedback']]) {
    const opened = extension.context.waitForEvent('page')
    await community.getByRole('link', { name, exact: true }).click()
    const destination = await opened
    await expect(destination).toHaveURL(url)
    expect(await destination.evaluate(() => window.opener === null)).toBe(true)
    await destination.close()
  }

  const footer = page.locator('.pulse-host-footer')
  for (const [name, path] of [['Support', '/support'], ['Privacy', '/privacy'], ['Terms', '/terms']]) {
    const link = footer.getByRole('link', { name, exact: true })
    await expect(link).toHaveAttribute('href', `https://streampulse.stream${path}`)
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  }
})
