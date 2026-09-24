import { test, expect } from '../helpers/testFixtures.ts'
import { openTwitchChannel } from '../helpers/mockTwitch.ts'
import { waitForPulseRoot } from '../helpers/assertions.ts'

test('banner preferences persist, rain pauses, and narrow layout stays contained', async ({ extension, prepare }, info) => {
  await prepare({ storage: { overlayPlacement: 'sidebar', sidebarTab: 'pulse', overlayMode: 'expanded' } })
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
  expect(settings.url()).toContain('#pulse')
  await settings.locator('.pulse-banner-customize summary').click()
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
