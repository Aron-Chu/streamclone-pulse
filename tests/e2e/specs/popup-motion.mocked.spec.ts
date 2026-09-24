import { test, expect } from '../helpers/testFixtures.ts'

test('popup hub motion is loaded and respects reduced motion', async ({ extension, prepare }) => {
  await prepare()
  const page = extension.page
  await page.setViewportSize({ width: 320, height: 600 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto(`chrome-extension://${extension.extensionId}/popup/index.html`)

  const hub = page.getByRole('button', { name: 'Open analytics hub', exact: true })
  await expect(hub).toBeInViewport()
  await expect(page.locator('#streamclone-pulse-styles')).toHaveCount(1)
  await expect(hub).toHaveCSS('animation-name', 'pulse-hub-cta-in')
  expect(await hub.evaluate(element => getComputedStyle(element, '::before').animationName))
    .toBe('pulse-hub-cta-sheen')

  await hub.focus()
  await expect(hub).toBeFocused()
  await expect(hub).toHaveCSS('outline-style', 'solid')
  // Chromium rounds outline widths to device pixels on scaled displays.
  expect(await hub.evaluate(element => parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThanOrEqual(1.5)
  const box = await hub.boundingBox()
  expect(box!.height).toBeGreaterThanOrEqual(44)
  expect(await hub.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(hub).toHaveCSS('animation-name', 'none')
  await expect(hub).toHaveCSS('transition-duration', '0s')
  expect(await hub.evaluate(element => getComputedStyle(element, '::before').animationName)).toBe('none')
  await hub.hover()
  await expect(hub).toHaveCSS('transform', 'none')
  await expect(hub.locator('.pulse-hub-arrow')).toHaveCSS('transition-duration', '0s')
})
