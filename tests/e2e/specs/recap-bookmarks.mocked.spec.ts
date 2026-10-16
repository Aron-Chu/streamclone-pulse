import { test, expect } from '../helpers/testFixtures.ts'
import { openTwitchChannel, openTwitchVod } from '../helpers/mockTwitch.ts'
import { waitForPulseRoot } from '../helpers/assertions.ts'

for (const surface of ['offline', 'vod'] as const) {
  test(`${surface} exposes the free bookmark and My Moments workflow`, async ({ extension, prepare }) => {
    await prepare({ scenario: surface === 'vod' ? 'vod-ready' : 'offline', twitchKind: surface,
      storage: { overlayPlacement: 'sidebar', sidebarTab: 'pulse', overlayMode: 'expanded' } })
    const page = extension.page
    if (surface === 'vod') await openTwitchVod(page)
    else await openTwitchChannel(page)
    await waitForPulseRoot(page)
    const root = page.locator('#streamclone-pulse-root')
    const library = root.getByRole('button', { name: 'Open My Moments', exact: true })
    await expect(library).toBeVisible()
    await expect(root.locator('[data-moment-action="bookmark"]')).toHaveCount(0)
    // A chart minute: the VOD's one moment is Catch me up's #1, which only
    // jumps. End previews the last minute with data and Enter selects it.
    await root.getByRole('application', { name: /^Chart plot/ }).focus()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    const save = root.locator('[data-moment-action="bookmark"]')
    await expect(save).toBeEnabled()
    await expect(root.getByText('Bookmarks stay on this device. No account needed.', { exact: true })).toBeVisible()
    await save.click()
    // Signed out, the save stays on this device: no account prompt, no request.
    await expect(save).toHaveAttribute('data-moment-save-state', 'saved')
    await expect(root.locator('.pulse-moment-action-feedback')).toContainText('Saved on this device at')
    await expect(root.getByRole('button', { name: 'Connect free account', exact: true })).toHaveCount(0)
    const opened = extension.context.waitForEvent('page')
    await library.click()
    const moments = await opened
    await expect(moments).toHaveURL(/options\/index\.html#moments$/)
    await expect(moments.getByRole('heading', { name: 'My Moments', exact: true })).toBeVisible()
  })
}
