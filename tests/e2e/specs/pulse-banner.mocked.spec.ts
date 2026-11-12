import { test, expect } from '../helpers/testFixtures.ts'
import { openTwitchChannel } from '../helpers/mockTwitch.ts'
import { waitForPulseRoot } from '../helpers/assertions.ts'
import { linkDevice, serveMembership, supporterBody, type MembershipStatus } from '../helpers/supporterMembership.ts'

test('a Supporter banner: preferences persist, rain pauses, and narrow layout stays contained', async ({ extension, prepare }, info) => {
  await prepare({ storage: { overlayPlacement: 'sidebar', sidebarTab: 'pulse', overlayMode: 'expanded' } })
  // Emote rain is a Supporter perk.
  await linkDevice(extension.serviceWorker)
  await serveMembership(extension.context, () => supporterBody('active', 2))
  await extension.context.route('https://api.streampulse.stream/v1/channels/*/clips?*', async route => {
    const start = new URL(route.request().url()).searchParams.get('startedAt')!
    await route.fulfill({ json: { items: [1, 2, 3].map(i => ({ id: `clip-${i}`, title: `Stream clip ${i}`, url: `https://clips.twitch.tv/Fixture${i}`, createdAt: start, viewCount: i * 10 })) } })
  })
  await openTwitchChannel(extension.page)
  await waitForPulseRoot(extension.page)
  const page = extension.page
  const root = page.locator('#streamclone-pulse-root')
  // A Supporter's quick settings strip wears their saved rain, with no "try free" chip.
  await root.getByRole('button', { name: 'Open settings', exact: true }).click()
  await expect(root.locator('.pulse-quick-look .pulse-banner-art')).toHaveAttribute('data-mode', 'off')
  await expect(root.locator('.pulse-quick-chip')).toHaveCount(0)
  // The background editor (the free panel title) lives under Pulse in all settings.
  const settings = await extension.context.newPage()
  await settings.goto(`chrome-extension://${extension.extensionId}/options/index.html#pulse-background`)
  // It lands on Pulse with Background & motion already open and in view.
  expect(settings.url()).toContain('#pulse-background')
  await expect(settings.locator('.pulse-banner-customize')).toHaveJSProperty('open', true)
  await expect(settings.locator('.pulse-banner-customize summary')).toBeInViewport()
  await settings.getByLabel('Panel title').fill('Aron\'s Pulse')
  await settings.getByRole('button', { name: 'Rain', exact: true }).click()
  await settings.getByRole('button', { name: 'Save background', exact: true }).click()
  await expect(settings.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
  await settings.close()
  await root.getByRole('button', { name: 'Back to Pulse' }).click()
  await expect(root.getByRole('heading', { name: 'Aron\'s Pulse', exact: true })).toBeVisible()
  const carousel = root.getByLabel('Stream clips carousel', { exact: true })
  await expect(carousel.getByRole('link')).toHaveCount(3)
  await expect(carousel.getByRole('link').first()).toContainText('Stream clip 3')
  await root.getByRole('button', { name: 'Next clips', exact: true }).click()
  await expect.poll(() => carousel.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
  await expect(root.getByRole('button', { name: /Pause rain|Resume rain/ })).toHaveCount(0)
  await expect(root.locator('.pulse-personal-panel > .pulse-banner-art')).toHaveAttribute('data-running', 'true')
  await expect.poll(() => root.locator('.pulse-personal-panel > .pulse-banner-art img').evaluateAll(images => images.filter(image => (image as HTMLImageElement).naturalWidth > 0).length)).toBe(6)
  const backdrop = await root.locator('.pulse-personal-panel > .pulse-banner-art').boundingBox()
  expect(backdrop!.height).toBeGreaterThan(500)
  await expect(root.locator('header.pulse-personal-banner')).toHaveCSS('border-top-width', '0px')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(root.locator('.pulse-personal-panel > .pulse-banner-art img').first()).toHaveCSS('animation-name', 'none')
  await page.reload()
  await expect(root.getByRole('heading', { name: 'Aron\'s Pulse', exact: true })).toBeVisible()
  for (const width of [1440, 1000]) {
    await page.setViewportSize({ width, height: 900 })
    const banner = root.locator('header.pulse-personal-banner')
    await expect(banner).toBeVisible()
    expect(await banner.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`banner-${width}.png`), animations: 'disabled' })
  }
})

test('emote rain is a Supporter perk: a saved Rain draws nothing without one, stays saved, and returns in grace', async ({ extension, prepare }, info) => {
  await prepare({ storage: { overlayPlacement: 'sidebar', sidebarTab: 'pulse', overlayMode: 'expanded' } })
  // Saved earlier, for instance while this profile was a Supporter.
  const saved = { mode: 'rain', intensity: 45, title: 'Lapsed Pulse' }
  await extension.serviceWorker.evaluate(value => chrome.storage.sync.set({ pulseBanner: value }), saved)
  let status: MembershipStatus = 'expired'
  await linkDevice(extension.serviceWorker)
  // The same paid period stays fixed across fresh reads. A newly generated end
  // time would signal a membership change on every read and keep re-checking.
  const period = supporterBody(status, 3)
  await serveMembership(extension.context, () => ({ ...supporterBody(status, 3), accessFrom: period.accessFrom, accessUntil: period.accessUntil, checkoutEnabled: false }))

  await openTwitchChannel(extension.page)
  await waitForPulseRoot(extension.page)
  const page = extension.page
  const root = page.locator('#streamclone-pulse-root')
  const backdrop = root.locator('.pulse-personal-panel > .pulse-banner-art')
  await expect(root.getByRole('heading', { name: 'Lapsed Pulse', exact: true })).toBeVisible()
  await expect(backdrop).toHaveAttribute('data-mode', 'off')
  await expect(backdrop.locator('img')).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('rain-locked-overlay.png'), animations: 'disabled' })

  // Quick settings' Your look strip starts on what the overlay draws, not the stored choice.
  await root.getByRole('button', { name: 'Open settings', exact: true }).click()
  const preview = root.locator('.pulse-quick-look')
  await expect(preview.locator('.pulse-banner-art')).toHaveAttribute('data-mode', 'off')
  await expect(preview.locator('img')).toHaveCount(0)
  // Trying Rain there draws it in the strip only: the overlay and the saved choice stay as they were.
  await root.getByRole('group', { name: 'Emote rain' }).getByRole('button', { name: 'Rain', exact: true }).click()
  await expect(preview.locator('.pulse-banner-art')).toHaveAttribute('data-mode', 'rain')
  expect(await extension.serviceWorker.evaluate(() => chrome.storage.sync.get('pulseBanner'))).toEqual({ pulseBanner: saved })
  // A lapsed member is pitched the lab's Your Line · Anatomy card, not a Supporter's Tenure Climb.
  await expect(root.locator('[data-settings-host-cta="supporter"] .pulse-supporter-stage')).toHaveAttribute('data-mode', 'anatomy')

  // Full settings: the title stays free, Still and Rain are locked with a way to the offer.
  // The strip's link opens the Your look studio; the background editor lives under Pulse.
  const opened = extension.context.waitForEvent('page')
  await root.getByRole('button', { name: 'Wave, sheen and crest in all settings ↗' }).click()
  const settings = await opened
  await settings.waitForLoadState('domcontentloaded')
  await expect(settings).toHaveURL(/#supporter$/)
  await settings.goto(settings.url().replace(/#supporter$/, '#pulse-background'))
  // Background & motion opens by itself (#pulse-background); a click on its summary would close it.
  await expect(settings.locator('.pulse-banner-customize')).toHaveJSProperty('open', true)
  const modes = settings.getByRole('group', { name: '7TV backdrop' })
  await expect(modes.getByRole('button')).toHaveCount(3)
  await expect(modes.getByRole('button', { name: 'Off', exact: true })).toBeEnabled()
  await expect(modes.getByRole('button', { name: 'Still', exact: true })).toBeDisabled()
  await expect(modes.getByRole('button', { name: 'Rain', exact: true })).toBeDisabled()
  const perk = settings.locator('[data-supporter-perk="emote-rain"]')
  await expect(perk).toContainText('Supporter perk')
  await expect(perk).toHaveText("Emote rain is a Supporter perk. Only you see it. Supporter isn't on sale yet. See Supporter →")
  await expect(perk).not.toContainText('moved from free')
  await settings.getByLabel('Panel title').fill('Renamed Pulse')
  await settings.getByRole('button', { name: 'Save background', exact: true }).click()
  await expect(settings.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
  // Saving the free title leaves the Supporter choice exactly as it was.
  expect(await extension.serviceWorker.evaluate(() => chrome.storage.sync.get('pulseBanner'))).toEqual({ pulseBanner: { ...saved, title: 'Renamed Pulse' } })
  await settings.screenshot({ path: info.outputPath('rain-locked-settings.png'), fullPage: true, animations: 'disabled' })
  await perk.getByRole('link', { name: 'See Supporter →', exact: true }).click()
  await expect(settings).toHaveURL(/#supporter$/)
  await settings.close()

  // A payment retry window still counts: grace brings the saved rain back.
  // Twitch tabs share the worker's read, and one without perks is re-checked at
  // the server's cacheUntil; a settings read is always fresh and refreshes it.
  status = 'grace'
  const fresh = await extension.context.newPage()
  await fresh.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
  expect(await fresh.evaluate(() => chrome.runtime.sendMessage({ type: 'SUPPORTER_ENTITLEMENT' }))).toMatchObject({ entitlement: { state: 'ready', status: 'grace' } })
  await fresh.close()
  await page.reload()
  await waitForPulseRoot(page)
  await expect(root.getByRole('heading', { name: 'Renamed Pulse', exact: true })).toBeVisible()
  await expect(backdrop).toHaveAttribute('data-mode', 'rain')
  await expect(backdrop).toHaveAttribute('data-running', 'true')
  await expect(backdrop.locator('img')).toHaveCount(6)
  await page.screenshot({ path: info.outputPath('rain-grace-overlay.png'), animations: 'disabled' })
})


for (const state of ['checking', 'failed'] as const) {
  test(`background rain keeps the offer line absent while Supporter is ${state}`, async ({ extension, prepare }) => {
    await prepare()
    await linkDevice(extension.serviceWorker)
    let reads = 0
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    await extension.context.route('https://api.streampulse.stream/v1/billing/supporter', async route => {
      reads++
      if (state === 'checking') await gate
      await route.fulfill({ status: 503, json: { error: 'temporarily_unavailable' } })
    })
    const settings = extension.page
    try {
      await settings.goto(`chrome-extension://${extension.extensionId}/options/index.html#pulse-background`)
      await expect.poll(() => reads).toBeGreaterThan(0)
      const background = settings.locator('.pulse-banner-customize')
      await expect(background).toHaveJSProperty('open', true)
      await expect(background.getByLabel('Panel title')).toBeEnabled()
      const modes = background.getByRole('group', { name: '7TV backdrop' })
      await expect(modes.getByRole('button', { name: 'Still', exact: true })).toBeDisabled()
      await expect(modes.getByRole('button', { name: 'Rain', exact: true })).toBeDisabled()
      if (state === 'failed') {
        const response = await settings.evaluate(() => chrome.runtime.sendMessage({ type: 'SUPPORTER_ENTITLEMENT' }))
        expect(response).toMatchObject({ type: 'SUPPORTER_ENTITLEMENT', entitlement: { state: 'unavailable' } })
      }
      await expect(background.locator('[data-supporter-perk="emote-rain"]')).toHaveCount(0)
      await expect(background.getByText("Supporter isn't on sale yet", { exact: false })).toHaveCount(0)
      await expect(background.getByRole('link', { name: 'See Supporter →', exact: true })).toHaveCount(0)
    } finally { release() }
  })
}
