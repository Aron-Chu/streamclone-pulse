import { test, expect } from '@playwright/test'
import { installHubUxMock } from './helpers/hubUxMock'

for (const width of [390, 1440, 1920]) {
  test(`bucket and moment inspectors animate and dismiss on click-away at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await installHubUxMock(page)
    await page.goto('/analytics')
    const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
    await chart.click()
    await expect(chart).toHaveAttribute('data-selected', 'true')
    const reveal = page.locator('.figma-global-activity__inspector .inspector-reveal')
    await expect(reveal).toHaveAttribute('data-open', 'true')
    await expect(reveal).toHaveCSS('transition-duration', '0.24s, 0.18s')
    await page.locator('.figma-global-activity__inspector').click({ position: { x: 15, y: 15 } })
    await expect(chart).toHaveAttribute('data-selected', 'true')
    await page.locator('.figma-global-activity .figma-block__title').click()
    await expect(chart).not.toHaveAttribute('data-selected', 'true')
    await expect(reveal).toHaveCSS('height', '0px')
    const row = page.getByRole('region', { name: 'Live Wire' }).locator('[data-stream-id="s1"]').first()
    await row.getByRole('button', { name: /^Show .* on chart$/ }).click()
    await expect(page.locator('[aria-label="Moment Inspector"]')).toBeVisible()
    await page.locator('.figma-global-activity .figma-block__title').click()
    await expect(row.getByRole('button', { name: /^Show .* on chart$/ })).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('[aria-label="Moment Inspector"]')).not.toBeVisible()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await chart.click()
    expect(await reveal.evaluate(element => parseFloat(getComputedStyle(element).transitionDuration))).toBeLessThanOrEqual(.001)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  })
}

test('a blocked application entry leaves a readable reload fallback', async ({ page }) => {
  await page.route(/\/src\/main\.tsx(?:\?.*)?$/, route => route.abort())
  await page.goto('/analytics/xqc/320241612508')
  await expect(page.getByRole('main', { name: 'Loading StreamPulse' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'reload this page' })).toBeVisible()
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(9, 9, 11)')
})
