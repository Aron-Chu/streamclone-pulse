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

test('both landing tours reflow on short viewports and restore animation on resize', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  for (const selector of ['.sl-xtour', '.lsg']) {
    await expect(page.locator(selector)).not.toHaveAttribute('data-static')
  }
  await page.setViewportSize({ width: 1440, height: 450 })
  for (const selector of ['.sl-xtour', '.lsg']) {
    await expect(page.locator(selector)).toHaveAttribute('data-static', '')
  }
  const panel = page.locator('.pulse-landing-panel')
  expect(await panel.evaluate(el => el.scrollHeight <= el.clientHeight + 2)).toBe(true)
  await page.setViewportSize({ width: 1440, height: 1000 })
  for (const selector of ['.sl-xtour', '.lsg']) {
    await expect(page.locator(selector)).not.toHaveAttribute('data-static')
  }
})

test('analytics uses one readable legend label per series and a compact plot', async ({ page }) => {
  await installHubUxMock(page)
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/analytics')
    const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
    await expect(chart).toBeVisible()
    const labels = page.locator('.figma-global-activity__hub-chart .hx-legend-chip').filter({ has: page.locator('.hx-series-label--full') })
    await expect(labels).toHaveCount(2)
    for (const chip of await labels.all()) {
      expect(await chip.locator('.hx-series-label--full:visible, .hx-series-label--compact:visible').count()).toBe(1)
    }
    expect((await chart.boundingBox())!.height).toBeLessThanOrEqual(width < 720 ? 280 : 336)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  }
})
