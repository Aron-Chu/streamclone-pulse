import { test, expect } from '@playwright/test'
import { installHubUxMock } from './helpers/hubUxMock'

test('hub chart keeps a viewer foreground and an external hover readout', async ({ page }) => {
  await installHubUxMock(page)
  await page.goto('/analytics')

  const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
  await expect(chart).toBeVisible()
  // Redesigned chart foreground: stacked viewer segments (the legacy
  // hx-chart-line--viewers path was removed in Task 9 of the redesign).
  await expect(chart.locator('.hx-bar-segment--viewers')).not.toHaveCount(0)
  await expect(chart.locator('.hx-chart-line--viewers')).toHaveCount(0)
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

test('Signal Wire shows a real emote image and keeps chat plus emote from the same channel', async ({ page }) => {
  await installHubUxMock(page)
  await page.goto('/analytics')

  const liveWire = page.locator('#section-signal-wire')
  await expect(liveWire).toBeVisible()
  await expect(liveWire.locator('[data-signal-emote="true"]')).toHaveCount(1)
  await expect(liveWire.locator('button.hub-live-wire__chip', { hasText: 'Emote burst' })).toHaveCount(1)
  await expect(liveWire.locator('button.hub-live-wire__chip', { hasText: /xQc/ })).toHaveCount(2)
})

test('Signal Wire selection renders an exact chart marker and Escape clears it', async ({ page }) => {
  await installHubUxMock(page)
  await page.goto('/analytics')

  const liveWire = page.locator('#section-signal-wire')
  const emoteChip = liveWire.locator('button.hub-live-wire__chip', { hasText: 'Emote burst' })
  await expect(emoteChip).toBeVisible()
  await emoteChip.click()
  await expect(emoteChip).toHaveAttribute('aria-pressed', 'true')

  const marker = page.locator('[data-chart-marker-key][aria-pressed="true"]')
  await expect(marker).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(emoteChip).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('[data-chart-marker-key][aria-pressed="true"]')).toHaveCount(0)
})

test('reduced motion leaves Signal Wire without entrance animation class churn', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await installHubUxMock(page)
  await page.goto('/analytics')
  await expect(page.locator('#section-signal-wire .hub-live-wire')).toBeVisible()
  await expect(page.locator('.hub-live-wire__chip--new')).toHaveCount(0)
})
