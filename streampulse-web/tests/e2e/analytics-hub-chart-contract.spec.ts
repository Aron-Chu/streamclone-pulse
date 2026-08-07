import { test, expect } from '@playwright/test'
import { installHubUxMock } from './helpers/hubUxMock'

test('hub chart keeps one viewer line and an external hover readout', async ({ page }) => {
  await installHubUxMock(page)
  await page.goto('/analytics')

  const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
  await expect(chart).toBeVisible()
  await expect(chart.locator('.hx-chart-line--viewers').first()).toHaveAttribute('d', /.+/)
  await expect(page.locator('.hx-moment-marker')).toHaveCount(0)
  await expect(chart.locator('.hdot')).toHaveCount(0)
  await expect(chart.locator('.hx-bucket-cue__node, .hx-bucket-cue__ring')).toHaveCount(0)
  await expect(chart.locator('.hx-chart-line--chat-detail')).toHaveCount(0)
  await expect(chart.locator('.hx-chart-tip-slot .tip')).toHaveCount(0)
  await expect(page.locator('.hx-chart-header__readout')).toHaveCount(1)
})

test('hub chart updates the external readout on hover and fades back to calm', async ({ page }) => {
  await installHubUxMock(page)
  await page.goto('/analytics')

  const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
  const readout = page.locator('.figma-global-activity__hub-chart .hx-chart-header__readout')

  await expect(chart).toBeVisible()
  await expect(chart).not.toHaveAttribute('data-hover')
  await expect(chart.locator('.hx-chart-detail-layer')).toHaveCount(0)

  const box = await chart.boundingBox()
  expect(box).toBeTruthy()
  await chart.hover({ position: { x: box!.width * 0.55, y: box!.height * 0.5 } })

  await expect(chart).toHaveAttribute('data-hover', 'true')
  await expect(readout).toContainText('Viewers')
  await expect(chart.locator('.hx-detail-readout')).toHaveCount(0)
  await expect(page.locator('.hx-moment-marker')).toHaveCount(0)

  await page.mouse.move(4, 4)
  await expect(chart).not.toHaveAttribute('data-hover')
  await expect(readout).not.toContainText('Viewers')
})
