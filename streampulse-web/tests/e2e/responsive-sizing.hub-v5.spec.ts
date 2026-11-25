import { test, expect } from '@playwright/test'
import { installHubUxMock } from './helpers/hubUxMock'

test('public and analytics route shells reflow across desktop and zoom-sized viewports', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await installHubUxMock(page)
  const measurements: unknown[] = []
  for (const width of [1440, 1024, 768, 560, 375]) {
    await page.setViewportSize({ width, height: width === 768 ? 450 : 900 })
    for (const route of ['/help', '/privacy', '/terms', '/refunds', '/guides/twitch-vod-timestamps', '/status', '/supporter', '/account/sign-in', '/analytics/moments', '/analytics/xqc']) {
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

test('the landing demo keeps its stage shape as the window changes, and takes the phone shape when narrow', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  // The demo mounts only once its section scrolls into view (DeferredDemo in Landing.tsx); until then its place is
  // the stage's own shape.
  const placeholder = page.locator('#demo .sl-demo-placeholder')
  await expect(placeholder).toBeAttached()
  const held = await placeholder.evaluate(el => el.getBoundingClientRect().height)
  await placeholder.scrollIntoViewIfNeeded()
  const stage = page.locator('.es-demo .es')
  await expect(stage).toBeVisible()
  const size = () => stage.evaluate(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }))
  const wide = await size()
  expect(Math.abs(held - wide.height)).toBeLessThanOrEqual(2)
  expect(wide.width).toBeLessThanOrEqual(1120)
  expect(Math.abs(wide.height - Math.round(wide.width * 700 / 1120))).toBeLessThanOrEqual(1)
  // A short window keeps the shape: the page scrolls, the stage does not squash.
  await page.setViewportSize({ width: 1440, height: 450 })
  expect(await size()).toEqual(wide)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.es-demo')).toHaveAttribute('data-phone', '')
  const phone = await size()
  expect(phone.height).toBeGreaterThan(phone.width)
  expect(phone.height).toBeLessThanOrEqual(640)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await expect(page.locator('.es-demo')).not.toHaveAttribute('data-phone', '')
  expect(await size()).toEqual(wide)
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
