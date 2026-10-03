import { test, expect } from '../helpers/testFixtures.ts'
import { openTwitchChannel } from '../helpers/mockTwitch.ts'

test('the CHAT/PULSE row follows Twitch light and dark themes', async ({ extension, prepare }, info) => {
  await prepare()
  const page = extension.page
  await page.setViewportSize({ width: 1440, height: 900 })
  await openTwitchChannel(page)
  const host = page.locator('#streamclone-pulse-tabs')
  await expect(host).toHaveAttribute('data-twitch-theme', 'dark')

  // Twitch flips one class on <html> and repaints its header white.
  await page.evaluate(() => {
    document.documentElement.classList.replace('tw-root--theme-dark', 'tw-root--theme-light')
    if (!document.documentElement.classList.contains('tw-root--theme-light')) document.documentElement.classList.add('tw-root--theme-light')
    const style = document.createElement('style')
    // Paint every light-DOM box white, the host included; shadow internals are untouched.
    style.textContent = 'html, body, body * { background-color: #ffffff !important; }'
    document.head.append(style)
  })
  await expect(host).toHaveAttribute('data-twitch-theme', 'light')
  await expect(page.locator('#streamclone-pulse-root')).toHaveAttribute('data-twitch-theme', 'light')

  // The row is opaque in the sidebar placement, so it must repaint itself.
  await expect(host.locator('section.pulse-sidebar-header-tabs')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  const inactive = host.locator('.pulse-sidebar-header-tabs .pulse-sidebar-tab:not(.active)').first()
  await expect(inactive).toBeVisible()
  // Dark-only labels were pale (#a1a1b2); light mode switches to dark ink once the colour transition ends.
  await expect.poll(() => inactive.evaluate(element => Math.max(...getComputedStyle(element).color.match(/\d+/g)!.slice(0, 3).map(Number))))
    .toBeLessThan(120)
  await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished)))
  const box = await host.boundingBox()
  await page.screenshot({ path: info.outputPath('twitch-tabs-light.png'), clip: { x: box!.x - 8, y: box!.y - 8, width: box!.width + 16, height: box!.height + 16 } })

  await page.evaluate(() => document.documentElement.classList.replace('tw-root--theme-light', 'tw-root--theme-dark'))
  await expect(host).toHaveAttribute('data-twitch-theme', 'dark')
  await expect(host.locator('section.pulse-sidebar-header-tabs')).toHaveCSS('background-color', 'rgb(17, 17, 23)')
})
