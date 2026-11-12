import { test, expect } from '@playwright/test'
import { installHubUxMock } from './helpers/hubUxMock'

test('public and analytics route shells reflow across desktop and zoom-sized viewports', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await installHubUxMock(page)
  const measurements: unknown[] = []
  for (const width of [1440, 1024, 768, 560, 375]) {
    await page.setViewportSize({ width, height: width === 768 ? 450 : 900 })
    for (const route of ['/docs', '/privacy', '/terms', '/refunds', '/support', '/status', '/supporter', '/account/sign-in', '/analytics/moments', '/analytics/xqc']) {
      await page.goto(route)
      await expect(page.locator('h1').first()).toBeVisible()
      await page.evaluate(() => document.fonts.ready)
      const dimensions = await page.evaluate(() => ({
        width: innerWidth, document: document.documentElement.scrollWidth,
        heading: document.querySelector('h1')?.textContent,
      }))
      measurements.push({ route, ...dimensions })
      expect(dimensions.document, `${route} at ${width}px`).toBeLessThanOrEqual(width + 1)
    }
  }
  await testInfo.attach('responsive-route-audit.json', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' })
})

test('landing heading does not grow when crossing the mobile breakpoint', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 562, height: 700 })
  await page.goto('/')
  const heading = page.locator('.sl-stage h1')
  await expect(heading).toBeVisible()
  const before = await heading.evaluate(el => parseFloat(getComputedStyle(el).fontSize))
  await page.setViewportSize({ width: 560, height: 700 })
  const after = await heading.evaluate(el => parseFloat(getComputedStyle(el).fontSize))
  expect(after).toBeLessThanOrEqual(before)
})

test('the landing tour reflows on short viewports and restores animation on resize', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  const tour = page.locator('.sl-xtour')
  await expect(tour).not.toHaveAttribute('data-static')
  await page.setViewportSize({ width: 1440, height: 450 })
  await expect(tour).toHaveAttribute('data-static', '')
  const panel = page.locator('.pulse-landing-panel')
  expect(await panel.evaluate(el => el.scrollHeight <= el.clientHeight + 2)).toBe(true)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await expect(tour).not.toHaveAttribute('data-static')
})

test('analytics uses one readable chip per series and the design plot height', async ({ page }) => {
  await installHubUxMock(page)
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/analytics')
    const plot = page.locator('.figma-global-activity__hub-chart svg[data-bench-plot]')
    await expect(plot).toBeVisible()
    const chips = page.locator('.figma-global-activity__hub-chart [data-hub-series-chip]')
    await expect(chips).toHaveText(['Chat/min', 'Emotes/min', 'Viewers (sample)'])
    for (const chip of await chips.all()) {
      expect(await chip.evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && el.getBoundingClientRect().height >= 24)).toBe(true)
    }
    // d3 design: 420 px plot from 720 px up, 300 px on a phone (hub.html @media (max-width:719px)).
    expect(Math.round((await plot.boundingBox())!.height)).toBe(width < 720 ? 300 : 420)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  }
})
