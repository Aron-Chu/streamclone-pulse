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
    await root.getByRole('button', { name: /^Select minute bucket/ }).first().click()
    const save = root.locator('[data-moment-action="bookmark"]')
    await expect(save).toBeEnabled()
    await save.click()
    await expect(root.getByRole('alert')).toContainText('Connect your free Pulse account')
    await expect(root.getByRole('button', { name: 'Connect free account', exact: true })).toBeVisible()
    const opened = extension.context.waitForEvent('page')
    await library.click()
    const moments = await opened
    await expect(moments).toHaveURL(/options\/index\.html#moments$/)
    await expect(moments.getByRole('heading', { name: 'My Moments', exact: true })).toBeVisible()
  })
}
