import { test, expect } from '../helpers/testFixtures.ts'
import { openTwitchChannel } from '../helpers/mockTwitch.ts'
import { waitForPulseRoot } from '../helpers/assertions.ts'

test('quick settings puts connection and live controls first, with the editor in full settings', async ({ extension, prepare }, info) => {
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
    const allSettings = panel.getByRole('button', { name: 'Open all settings', exact: true })
    const autoUpdate = panel.getByRole('checkbox', { name: 'Refresh live data automatically' })
    const appearance = panel.getByRole('region', { name: 'Extension preferences' })
    const supporter = panel.locator('[data-settings-host-cta="supporter"]')
    const connectionBox = await connection.boundingBox()
    const allSettingsBox = await allSettings.boundingBox()
    const autoUpdateBox = await autoUpdate.boundingBox()
    const supporterBox = await supporter.boundingBox()
    const appearanceBox = await appearance.boundingBox()
    expect(connectionBox!.y + connectionBox!.height).toBeLessThanOrEqual(allSettingsBox!.y)
    expect(allSettingsBox!.y + allSettingsBox!.height).toBeLessThanOrEqual(appearanceBox!.y)
    expect(autoUpdateBox!.y).toBeLessThan(supporterBox!.y)
    await expect(panel.locator('[data-appearance-preview="true"]')).toBeVisible()
    await expect(panel.locator('.pulse-banner-customize')).toHaveCount(0)
    await expect(panel.locator('[data-banner-editor-cta="true"]')).toBeVisible()
    expect(await panel.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)
    for (const name of ['Back to Pulse', 'Reset appearance and layout to defaults']) {
      const action = panel.getByRole('button', { name, exact: false })
      expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(32)
    }
    await panel.screenshot({ path: info.outputPath(`quick-settings-${width}.png`), animations: 'disabled' })
    await expect(allSettings).toBeInViewport()
    await autoUpdate.scrollIntoViewIfNeeded()
    await expect(autoUpdate).toBeInViewport()
  }

  const opened = extension.context.waitForEvent('page')
  await panel.locator('[data-banner-editor-cta="true"]').click()
  const settings = await opened
  await settings.waitForLoadState('domcontentloaded')
  expect(settings.url()).toContain('#pulse')
  await expect(settings.locator('.pulse-banner-customize')).toBeVisible()
  await settings.locator('.pulse-banner-customize summary').click()
  await expect(settings.getByRole('group', { name: '7TV backdrop' }).getByRole('button')).toHaveCount(3)
})
