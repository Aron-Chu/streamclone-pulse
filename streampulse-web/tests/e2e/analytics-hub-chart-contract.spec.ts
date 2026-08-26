import { test, expect } from '@playwright/test'
import { installHubUxMock } from './helpers/hubUxMock'

test('hub chart keeps a viewer foreground with truthful chat bars and an external hover readout', async ({ page }) => {
  await installHubUxMock(page)
  await page.goto('/analytics')

  const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
  await expect(chart).toBeVisible()
  // Viewers and emotes use independent line scales; tracked chat is the only
  // bar series. Unlike units are never stacked into one contribution bar.
  await expect(chart.locator('.hx-chart-line--viewers')).not.toHaveCount(0)
  await expect(chart.locator('.hx-chart-line--emotes')).not.toHaveCount(0)
  await expect(chart.locator('[data-component="HubActivityBarSeries"] .hx-chat-bar')).not.toHaveCount(0)
  await expect(chart.locator('.hx-bar-segment--viewers, .hx-bar-segment--emotes')).toHaveCount(0)
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

test('chart navigator zooms locally, stays keyboard accessible, and leaves provider lanes at the bottom', async ({ page }) => {
  await installHubUxMock(page)
  await page.goto('/analytics')

  const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
  const navigator = page.getByRole('group', { name: 'Chart navigator' })
  await expect(chart).toBeVisible()
  await expect(navigator).toBeVisible()
  const start = navigator.getByRole('slider', { name: 'Chart view start' })
  const end = navigator.getByRole('slider', { name: 'Chart view end' })
  await expect(start).toHaveAttribute('aria-valuenow', '0')
  const endIndex = Number(await end.getAttribute('aria-valuenow'))
  expect(endIndex).toBeGreaterThan(1)
  await expect(navigator).toContainText('requested server range is unchanged')

  await start.focus()
  await page.keyboard.press('ArrowRight')
  await expect(start).toHaveAttribute('aria-valuenow', '1')
  await expect(page.locator('.hx-plot-stack')).toHaveAttribute('data-hub-chart-viewport-start', '1')
  await expect(navigator.getByRole('button', { name: 'Reset chart view to the full requested range' })).toBeEnabled()

  const order = await page.evaluate(() => {
    const navigator = document.querySelector('[data-hub-chart-navigator]')
    const lanes = document.querySelector('.hx-provider-lanes')
    if (!navigator || !lanes) return null
    return Boolean(navigator.compareDocumentPosition(lanes) & Node.DOCUMENT_POSITION_FOLLOWING)
  })
  expect(order).toBe(true)
  await expect(page.locator('.hx-chart-header [data-provider-toggle], .hx-chart-header .hx-provider-chips')).toHaveCount(0)

  await navigator.getByRole('button', { name: 'Reset chart view to the full requested range' }).click()
  await expect(start).toHaveAttribute('aria-valuenow', '0')
})

test('Live Wire explains the detected event and keeps chat plus emote from the same channel', async ({ page }) => {
  await installHubUxMock(page)
  await page.goto('/analytics')

  const liveWire = page.getByRole('region', { name: 'Live Wire' })
  await expect(liveWire).toBeVisible()
  const first = liveWire.locator('article').first()
  await expect(first).toContainText('xQc')
  await expect(first).toContainText('Twitch emote spike')
  await expect(first).toContainText('393/m')
  await expect(first).toContainText('133/m')
  await expect(first).toContainText('IRC measured')
  await expect(first.getByRole('button', { name: 'Inspect this minute' })).toBeVisible()
})

test('Live Wire inspection selects the matching chart bucket and Escape clears it', async ({ page }) => {
  await installHubUxMock(page)
  await page.goto('/analytics')

  const liveWire = page.getByRole('region', { name: 'Live Wire' })
  await liveWire.getByRole('button', { name: 'Inspect this minute' }).first().click()
  const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
  await expect(chart).toHaveAttribute('data-selected', 'true')
  await chart.focus()
  await page.keyboard.press('Escape')
  await expect(chart).not.toHaveAttribute('data-selected', 'true')
})

test('reduced motion leaves Live Wire without entrance animation class churn', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await installHubUxMock(page)
  await page.goto('/analytics')
  await expect(page.getByRole('region', { name: 'Live Wire' })).toBeVisible()
  await expect(page.locator('.hub-live-wire__rail-new')).toHaveCount(0)
})
