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
  // Measure once the entrance animation settles (mid-slide heights come out as
  // 43.99998px). The sheen pseudo-element is clipped decoration that still counts
  // toward the button's scrollWidth, so text fit is checked on the label itself.
  await hub.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)))
  const box = await hub.boundingBox()
  expect(Math.round(box!.height)).toBeGreaterThanOrEqual(44)
  const label = hub.locator('span').first()
  expect(await label.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(hub).toHaveCSS('animation-name', 'none')
  await expect(hub).toHaveCSS('transition-duration', '0s')
  expect(await hub.evaluate(element => getComputedStyle(element, '::before').animationName)).toBe('none')
  // The arrow is part of the label text (no separately animated element).
  await hub.hover()
  await expect(hub).toHaveCSS('transform', 'none')
})
