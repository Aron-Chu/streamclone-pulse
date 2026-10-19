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
    // My Moments sits in a moments heading: Top moments, or the recap's on a VOD.
    const library = root.locator('[data-moment-action="open-library"]:visible').first()
    await expect(library).toHaveText('My Moments')
    await expect(root.locator('[data-moment-action="bookmark"]')).toHaveCount(0)
    // A chart minute: the VOD's one moment is Catch me up's #1, which only
    // jumps. End previews the last minute with data and Enter selects it.
    await root.getByRole('application', { name: /^Chart plot/ }).focus()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    const save = root.locator('[data-moment-action="bookmark"]')
    await expect(save).toBeEnabled()
    await expect(save).toHaveAttribute('aria-pressed', 'false')
    await save.click()
    // Signed out, the save stays on this device: no account prompt, no request.
    await expect(save).toHaveAttribute('data-moment-save-state', 'saved')
    await expect(save).toHaveAttribute('aria-pressed', 'true')
    const toast = root.locator('.pulse-bookmark-toast')
    await expect(toast).toContainText('Saved on this device')
    await expect(root.locator('[data-moment-action="connect-account"]')).toHaveCount(0)
    // The same icon removes it, and Undo puts it back.
    await save.click()
    await expect(save).toHaveAttribute('data-moment-save-state', 'ready')
    await expect(toast).toContainText('Removed bookmark at')
    await toast.locator('[data-bookmark-toast-action="undo"]').click()
    await expect(save).toHaveAttribute('data-moment-save-state', 'saved')
    const opened = extension.context.waitForEvent('page')
    await library.click()
    const moments = await opened
    await expect(moments).toHaveURL(/options\/index\.html#moments$/)
    await expect(moments.getByRole('heading', { name: 'My Moments', exact: true })).toBeVisible()
  })
}
