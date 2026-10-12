import { test, expect } from '../helpers/testFixtures.ts'
import { openTwitchChannel } from '../helpers/mockTwitch.ts'
import { waitForPulseRoot } from '../helpers/assertions.ts'
import { linkDevice, serveMembership, supporterBody } from '../helpers/supporterMembership.ts'

test('a Supporter banner: preferences persist, rain pauses, and narrow layout stays contained', async ({ extension, prepare }, info) => {
  await prepare({ storage: { overlayPlacement: 'sidebar', sidebarTab: 'pulse', overlayMode: 'expanded' } })
  // A Supporter: the backdrop stays theirs once it becomes a perk.
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
  await root.getByRole('button', { name: 'Open settings', exact: true }).click()
  const opened = extension.context.waitForEvent('page')
  await root.getByRole('button', { name: 'Edit background in all settings' }).click()
  const settings = await opened
  await settings.waitForLoadState('domcontentloaded')
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

test('the 7TV emote backdrop is free until sign-ups open: a saved Rain draws without Supporter, with one note', async ({ extension, prepare }, info) => {
  await prepare({ storage: { overlayPlacement: 'sidebar', sidebarTab: 'pulse', overlayMode: 'expanded' } })
  // Saved in 0.2.1, when the backdrop was free; this profile is not a Supporter (a lapsed one).
  const saved = { mode: 'rain', intensity: 45, title: 'Lapsed Pulse' }
  await extension.serviceWorker.evaluate(value => chrome.storage.sync.set({ pulseBanner: value }), saved)
  await linkDevice(extension.serviceWorker)
  await serveMembership(extension.context, () => supporterBody('expired', 3))

  await openTwitchChannel(extension.page)
  await waitForPulseRoot(extension.page)
  const page = extension.page
  const root = page.locator('#streamclone-pulse-root')
  const backdrop = root.locator('.pulse-personal-panel > .pulse-banner-art')
  await expect(root.getByRole('heading', { name: 'Lapsed Pulse', exact: true })).toBeVisible()
  await expect(backdrop).toHaveAttribute('data-mode', 'rain')
  await expect(backdrop).toHaveAttribute('data-running', 'true')
  await expect(backdrop.locator('img')).toHaveCount(6)
  await page.screenshot({ path: info.outputPath('backdrop-free-overlay.png'), animations: 'disabled' })

  // Quick settings previews what the overlay draws, and says once, in amber, that it becomes a perk.
  await root.getByRole('button', { name: 'Open settings', exact: true }).click()
  const preview = root.locator('.pulse-banner-quick-preview')
  await expect(preview).toHaveAttribute('data-preview-mode', 'rain')
  await expect(preview.locator('small')).toHaveText('7TV emote backdrop: Rain')
  const quickNote = root.locator('[data-backdrop-note="free"]')
  await expect(quickNote).toHaveText('Becomes a Supporter perk when sign-ups open.')
  await expect(quickNote).toHaveCSS('color', 'rgb(252, 211, 77)')
  // A lapsed member is pitched the lab's Your Line · Anatomy card, not a Supporter's Tenure Climb.
  await expect(root.locator('[data-settings-host-cta="supporter"] .pulse-supporter-stage')).toHaveAttribute('data-mode', 'anatomy')

  // Full settings: Off, Still, Rain and intensity work for everyone, with the same note.
  const opened = extension.context.waitForEvent('page')
  await root.getByRole('button', { name: 'Edit background in all settings' }).click()
  const settings = await opened
  await settings.waitForLoadState('domcontentloaded')
  // Background & motion opens by itself (#pulse-background); a click on its summary would close it.
  await expect(settings.locator('.pulse-banner-customize')).toHaveJSProperty('open', true)
  const modes = settings.getByRole('group', { name: '7TV emote backdrop' })
  await expect(modes.getByRole('button')).toHaveCount(3)
  for (const name of ['Off', 'Still', 'Rain']) await expect(modes.getByRole('button', { name, exact: true })).toBeEnabled()
  await expect(modes.getByRole('button', { name: 'Rain', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(settings.getByLabel(/Intensity/)).toBeEnabled()
  await expect(settings.locator('[data-supporter-perk="emote-rain"]')).toHaveCount(0)
  await expect(settings.locator('.pulse-banner-customize [data-backdrop-note="free"]')).toHaveText('Becomes a Supporter perk when sign-ups open.')
  await modes.getByRole('button', { name: 'Still', exact: true }).click()
  await settings.getByRole('button', { name: 'Save background', exact: true }).click()
  await expect(settings.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
  expect(await extension.serviceWorker.evaluate(() => chrome.storage.sync.get('pulseBanner'))).toEqual({ pulseBanner: { ...saved, mode: 'still' } })
  await settings.screenshot({ path: info.outputPath('backdrop-free-settings.png'), fullPage: true, animations: 'disabled' })
  await settings.close()

  // The open panel follows the saved choice.
  await root.getByRole('button', { name: 'Back to Pulse' }).click()
  await expect(backdrop).toHaveAttribute('data-mode', 'still')
  await expect(backdrop.locator('img')).toHaveCount(6)
})
