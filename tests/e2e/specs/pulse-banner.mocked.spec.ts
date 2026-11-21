import { test, expect } from '../helpers/testFixtures.ts'
import { openTwitchChannel } from '../helpers/mockTwitch.ts'
import { waitForPulseRoot } from '../helpers/assertions.ts'
import { linkDevice, serveMembership, supporterBody, type MembershipStatus } from '../helpers/supporterMembership.ts'

test('a Supporter banner: preferences persist, the backdrop pauses, and narrow layout stays contained', async ({ extension, prepare }, info) => {
  await prepare({ storage: { overlayPlacement: 'sidebar', sidebarTab: 'pulse', overlayMode: 'expanded' } })
  // The backdrop is a Supporter perk.
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
  // A Supporter's quick settings strip wears their saved backdrop, with no "try free" chip.
  await root.getByRole('button', { name: 'Open settings', exact: true }).click()
  await expect(root.locator('.pulse-quick-look .pulse-banner-art')).toHaveAttribute('data-mode', 'off')
  await expect(root.locator('.pulse-quick-chip')).toHaveCount(0)
  // The panel title (free) lives under Pulse in all settings; the backdrop is part of Your look.
  const settings = await extension.context.newPage()
  await settings.goto(`chrome-extension://${extension.extensionId}/options/index.html#pulse-background`)
  // It lands on Pulse with Panel title already open and in view.
  expect(settings.url()).toContain('#pulse-background')
  await expect(settings.locator('.pulse-banner-customize')).toHaveJSProperty('open', true)
  await expect(settings.locator('.pulse-banner-customize summary')).toBeInViewport()
  await expect(settings.locator('.pulse-banner-customize').getByRole('button', { name: /^(Still|Rain)$/ })).toHaveCount(0)
  await settings.getByLabel('Panel title').fill('Aron\'s Pulse')
  await settings.getByRole('button', { name: 'Save title', exact: true }).click()
  await expect(settings.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
  // The backdrop is turned on in Your look and saved with Equip look.
  await settings.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
  const backdropRow = settings.locator('[data-supporter-perks="on"]')
  await backdropRow.getByRole('button', { name: 'On', exact: true }).click()
  await settings.getByRole('button', { name: 'Equip look', exact: true }).click()
  await expect(settings.locator('.pulse-supporter-save-status')).toContainText('Equipped:')
  expect((await extension.serviceWorker.evaluate(() => chrome.storage.sync.get('pulseBanner'))).pulseBanner).toMatchObject({ mode: 'rain', title: 'Aron\'s Pulse' })
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
  // Original inline marks: six drawn in place, and no image of any kind requested.
  await expect(root.locator('.pulse-personal-panel > .pulse-banner-art svg')).toHaveCount(6)
  await expect(root.locator('.pulse-personal-panel > .pulse-banner-art img')).toHaveCount(0)
  const backdrop = await root.locator('.pulse-personal-panel > .pulse-banner-art').boundingBox()
  expect(backdrop!.height).toBeGreaterThan(500)
  await expect(root.locator('header.pulse-personal-banner')).toHaveCSS('border-top-width', '0px')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(root.locator('.pulse-personal-panel > .pulse-banner-art svg').first()).toHaveCSS('animation-name', 'none')
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

test('the backdrop is a Supporter perk: a saved backdrop draws nothing without one, stays saved, and returns in grace', async ({ extension, prepare }, info) => {
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
  await expect(backdrop.locator('img, svg')).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('rain-locked-overlay.png'), animations: 'disabled' })

  // Quick settings' Your look strip starts on what the overlay draws, not the stored choice.
  await root.getByRole('button', { name: 'Open settings', exact: true }).click()
  const preview = root.locator('.pulse-quick-look')
  await expect(preview.locator('.pulse-banner-art')).toHaveAttribute('data-mode', 'off')
  await expect(preview.locator('img, svg')).toHaveCount(0)
  // Trying the backdrop there draws it in the strip only: the overlay and the saved choice stay as they were.
  await root.getByRole('group', { name: 'Backdrop' }).getByRole('button', { name: 'On', exact: true }).click()
  await expect(preview.locator('.pulse-banner-art')).toHaveAttribute('data-mode', 'rain')
  await expect(preview.locator('.pulse-banner-art img')).toHaveCount(0)
  expect(await extension.serviceWorker.evaluate(() => chrome.storage.sync.get('pulseBanner'))).toEqual({ pulseBanner: saved })
  // A lapsed member is pitched the lab's Your Line · Anatomy card, not a Supporter's Tenure Climb.
  await expect(root.locator('[data-settings-host-cta="supporter"] .pulse-supporter-stage')).toHaveAttribute('data-mode', 'anatomy')

  // Full settings: the strip's link opens the Your look studio, where the backdrop is tried but not saved.
  const opened = extension.context.waitForEvent('page')
  await root.getByRole('button', { name: 'Motion and saved looks in all settings ↗' }).click()
  const settings = await opened
  await settings.waitForLoadState('domcontentloaded')
  await expect(settings).toHaveURL(/#supporter$/)
  const perk = settings.locator('[data-supporter-perk="backdrop"]')
  await expect(perk).toContainText('Supporter perk')
  await expect(perk).toHaveText("The backdrop is a Supporter perk. Only you see it. Supporter isn't on sale yet. See Supporter →")
  await expect(perk).not.toContainText('moved from free')
  // A non-member's studio sits in the preview disclosure, closed until chosen.
  await settings.getByText('Preview Supporter looks', { exact: true }).click()
  const studioBackdrop = settings.locator('[data-supporter-perks="locked"]')
  await expect(studioBackdrop.getByRole('button', { name: 'On', exact: true })).toBeEnabled()
  await studioBackdrop.getByRole('button', { name: 'Off', exact: true }).click()
  await studioBackdrop.getByRole('button', { name: 'On', exact: true }).click()
  // Trying it saves nothing: the stored choice is exactly as it was.
  expect(await extension.serviceWorker.evaluate(() => chrome.storage.sync.get('pulseBanner'))).toEqual({ pulseBanner: saved })
  // The title stays free under Pulse, and saving it leaves the Supporter choice as it was.
  await settings.goto(settings.url().replace(/#supporter$/, '#pulse-background'))
  // Panel title opens by itself (#pulse-background); a click on its summary would close it.
  await expect(settings.locator('.pulse-banner-customize')).toHaveJSProperty('open', true)
  await settings.getByLabel('Panel title').fill('Renamed Pulse')
  await settings.getByRole('button', { name: 'Save title', exact: true }).click()
  await expect(settings.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
  expect(await extension.serviceWorker.evaluate(() => chrome.storage.sync.get('pulseBanner'))).toEqual({ pulseBanner: { ...saved, title: 'Renamed Pulse' } })
  await settings.screenshot({ path: info.outputPath('rain-locked-settings.png'), fullPage: true, animations: 'disabled' })
  await settings.getByRole('link', { name: 'Your look', exact: true }).click()
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
  await expect(backdrop.locator('svg')).toHaveCount(6)
  await expect(backdrop.locator('img')).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('rain-grace-overlay.png'), animations: 'disabled' })
})


for (const state of ['checking', 'failed'] as const) {
  test(`the backdrop keeps the offer line absent while Supporter is ${state}`, async ({ extension, prepare }) => {
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
      // The free title stays editable whatever the membership read says.
      const background = settings.locator('.pulse-banner-customize')
      await expect(background).toHaveJSProperty('open', true)
      await expect(background.getByLabel('Panel title')).toBeEnabled()
      // The backdrop lives in Your look, which pauses until the membership is known.
      await settings.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
      await settings.getByText('Preview Supporter looks', { exact: true }).click()
      const studioBackdrop = settings.locator('[data-supporter-perks="pending"]')
      await expect(studioBackdrop).toHaveJSProperty('disabled', true)
      await expect(studioBackdrop.getByRole('button', { name: 'On', exact: true })).toBeDisabled()
      if (state === 'failed') {
        const response = await settings.evaluate(() => chrome.runtime.sendMessage({ type: 'SUPPORTER_ENTITLEMENT' }))
        expect(response).toMatchObject({ type: 'SUPPORTER_ENTITLEMENT', entitlement: { state: 'unavailable' } })
        await expect(settings.locator('.pulse-supporter-studio').getByText('Supporter status unavailable', { exact: true })).toBeVisible()
      }
      const studio = settings.locator('.pulse-supporter-studio')
      await expect(studio.locator('[data-supporter-perk="backdrop"]')).toHaveCount(0)
      await expect(studio.getByText("Supporter isn't on sale yet", { exact: false })).toHaveCount(0)
      await expect(studio.getByRole('link', { name: 'See Supporter →', exact: true })).toHaveCount(0)
    } finally { release() }
  })
}
