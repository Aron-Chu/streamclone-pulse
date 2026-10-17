import { test, expect } from '../helpers/testFixtures.ts'
import { openTwitchChannel } from '../helpers/mockTwitch.ts'
import { waitForPulseRoot } from '../helpers/assertions.ts'

test('quick settings opens on the channel, then Supporter and live controls, with Open all settings pinned below', async ({ extension, prepare }, info) => {
  await prepare({ scenario: 'live-ready', twitchKind: 'live', storage: { overlayPlacement: 'sidebar', sidebarTab: 'pulse', overlayMode: 'expanded' } })
  await openTwitchChannel(extension.page)
  await waitForPulseRoot(extension.page)
  const root = extension.page.locator('#streamclone-pulse-root')
  await root.getByRole('button', { name: 'Open settings', exact: true }).click()
  const panel = root.locator('[data-overlay-settings-panel]')
  await expect(panel.getByRole('heading', { name: 'Quick settings' })).toBeVisible()
  for (const width of [1280, 720]) {
    await extension.page.setViewportSize({ width, height: 1000 })
    const connection = panel.locator('[data-settings-connection="true"]')
    // Pinned outside the scrolling panel, in the same place as the Pulse view's Settings bar.
    const allSettings = root.getByRole('button', { name: 'Open all settings', exact: true })
    const autoUpdate = panel.getByRole('checkbox', { name: 'Refresh live data automatically' })
    const appearance = panel.getByRole('region', { name: 'Extension preferences' })
    const supporter = panel.locator('[data-settings-host-cta="supporter"]')
    const connectionBox = await connection.boundingBox()
    const allSettingsBox = await allSettings.boundingBox()
    const autoUpdateBox = await autoUpdate.boundingBox()
    const supporterBox = await supporter.boundingBox()
    const appearanceBox = await appearance.boundingBox()
    await expect(panel.locator('.pulse-settings-channel')).toBeVisible()
    expect(connectionBox!.y + connectionBox!.height).toBeLessThanOrEqual(supporterBox!.y)
    expect(supporterBox!.y + supporterBox!.height).toBeLessThanOrEqual(appearanceBox!.y)
    expect(supporterBox!.y).toBeLessThan(autoUpdateBox!.y)
    expect(allSettingsBox!.y).toBeGreaterThan(connectionBox!.y)
    await expect(panel.locator('[data-settings-host-cta="pulse"]')).toHaveCount(0)
    // Community, Your look and Moments sit between the Supporter card and the live controls.
    const community = panel.locator('.pulse-quick-community')
    const look = panel.locator('.pulse-quick-look')
    const pictures = panel.getByRole('checkbox', { name: 'Moment pictures' })
    for (const [above, below] of [[supporter, community], [community, look], [look, pictures], [pictures, autoUpdate]] as const) {
      expect((await above.boundingBox())!.y).toBeLessThan((await below.boundingBox())!.y)
    }
    await expect(community.getByRole('button')).toHaveText(['Join the Discord ↗', 'Send feedback ↗'])
    await expect(panel.locator('.pulse-banner-customize')).toHaveCount(0)
    await expect(panel.locator('[data-banner-editor-cta="true"]')).toHaveCount(0)
    expect(await panel.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)
    for (const name of ['Back to Pulse', 'Reset appearance and layout']) {
      const action = panel.getByRole('button', { name, exact: false })
      expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(32)
    }
    await panel.screenshot({ path: info.outputPath(`quick-settings-${width}.png`), animations: 'disabled' })
    await expect(allSettings).toBeInViewport()
    await autoUpdate.scrollIntoViewIfNeeded()
    await expect(autoUpdate).toBeInViewport()
    await expect(allSettings).toBeInViewport()
  }

  const openedAll = extension.context.waitForEvent('page')
  await root.getByRole('button', { name: 'Open all settings', exact: true }).click()
  const allPage = await openedAll
  await allPage.waitForLoadState('domcontentloaded')
  expect(allPage.url()).toContain('#pulse')
  await allPage.close()

  // Your look's link opens the studio in all settings, its preview in view.
  const opened = extension.context.waitForEvent('page')
  await panel.getByRole('button', { name: 'Wave, sheen and crest in all settings ↗' }).click()
  const settings = await opened
  await settings.waitForLoadState('domcontentloaded')
  expect(settings.url()).toContain('#supporter')
  await expect(settings.locator('[data-supporter-preview]')).toBeVisible()
  await expect(settings.getByRole('group', { name: 'Emote rain' }).getByRole('button')).toHaveCount(3)
})

test('density chosen in quick settings reaches the open panel without a reload', async ({ extension, prepare }) => {
  await prepare({ scenario: 'live-ready', twitchKind: 'live', storage: { overlayPlacement: 'sidebar', sidebarTab: 'pulse', overlayMode: 'expanded' } })
  await openTwitchChannel(extension.page)
  await waitForPulseRoot(extension.page)
  const root = extension.page.locator('#streamclone-pulse-root')
  const shell = root.locator('section[aria-label="StreamPulse overlay"]')
  await expect(shell).toHaveAttribute('data-pulse-density', 'comfortable')
  await root.getByRole('button', { name: 'Open settings', exact: true }).click()
  await root.getByRole('group', { name: 'Density' }).getByRole('button', { name: /Compact/ }).click()
  await root.getByRole('button', { name: 'Back to Pulse' }).click()
  await expect(shell).toHaveAttribute('data-pulse-density', 'compact')
})
