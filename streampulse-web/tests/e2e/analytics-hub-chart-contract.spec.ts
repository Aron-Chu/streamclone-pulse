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
  const requestedServerWindows: string[] = []
  const runtimeErrors: string[] = []
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text())
  })
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.endsWith('/v1/public/hub')) {
      requestedServerWindows.push(url.searchParams.get('activityWindow') ?? '')
    }
  })
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

  const track = navigator.locator('.hx-chart-navigator__track')
  await track.scrollIntoViewIfNeeded()
  const trackBox = await track.boundingBox()
  expect(trackBox).toBeTruthy()
  const handleChrome = await start.evaluate((element) => {
    const style = getComputedStyle(element)
    return { border: style.borderStyle, background: style.backgroundColor }
  })
  expect(handleChrome.border).toBe('none')
  expect(handleChrome.background).toBe('rgba(0, 0, 0, 0)')

  // The navigator owns wheel gestures only when they can change its local
  // viewport. A vertical wheel zoom is anchored at the pointer.
  await page.mouse.move(trackBox!.x + trackBox!.width * 0.5, trackBox!.y + trackBox!.height / 2)
  await page.mouse.wheel(0, -180)
  await expect(start).not.toHaveAttribute('aria-valuenow', '0')
  const wheelStart = Number(await start.getAttribute('aria-valuenow'))
  await page.keyboard.down('Shift')
  await page.mouse.wheel(0, 120)
  await page.keyboard.up('Shift')
  await expect.poll(async () => Number(await start.getAttribute('aria-valuenow'))).toBeGreaterThan(wheelStart)
  await navigator.getByRole('button', { name: 'Reset chart view to the full requested range' }).click()
  await expect(start).toHaveAttribute('aria-valuenow', '0')

  await page.mouse.move(trackBox!.x + trackBox!.width * 0.2, trackBox!.y + trackBox!.height / 2)
  await page.mouse.down()
  await expect(navigator).toHaveAttribute('data-hub-chart-navigator-mode', 'brush')
  await page.mouse.move(trackBox!.x + trackBox!.width * 0.7, trackBox!.y + trackBox!.height / 2)
  await page.mouse.up()
  await expect(start).not.toHaveAttribute('aria-valuenow', '0')
  await expect(end).not.toHaveAttribute('aria-valuenow', String(endIndex))

  const brushedStart = Number(await start.getAttribute('aria-valuenow'))
  const brushedEnd = Number(await end.getAttribute('aria-valuenow'))
  const windowBox = await navigator.locator('.hx-chart-navigator__window').boundingBox()
  expect(windowBox).toBeTruthy()
  await page.mouse.move(windowBox!.x + windowBox!.width / 2, windowBox!.y + windowBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(windowBox!.x + windowBox!.width / 2 + trackBox!.width * 0.08, windowBox!.y + windowBox!.height / 2)
  await page.mouse.up()
  expect(Number(await start.getAttribute('aria-valuenow'))).toBeGreaterThan(brushedStart)
  expect(Number(await end.getAttribute('aria-valuenow'))).toBeGreaterThan(brushedEnd)

  await start.focus()
  await page.keyboard.press('ArrowRight')
  const keyboardStart = Number(await start.getAttribute('aria-valuenow'))
  expect(keyboardStart).toBeGreaterThan(brushedStart)
  await expect(page.locator('.hx-plot-stack')).toHaveAttribute('data-hub-chart-viewport-start', String(keyboardStart))
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
  expect(new Set(requestedServerWindows)).toEqual(new Set(['24h']))
  expect(runtimeErrors).toEqual([])
})

test('chart, navigator, provider lanes, and Live Wire remain usable at mobile width', async ({ page }) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text())
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await installHubUxMock(page)
  await page.goto('/analytics')

  const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
  const navigator = page.getByRole('group', { name: 'Chart navigator' })
  await expect(chart).toBeVisible()
  await expect(chart.locator('.hx-chart-line--viewers')).not.toHaveCount(0)
  await expect(navigator).toBeVisible()
  await expect(page.locator('.hx-provider-lane')).toHaveCount(4)
  await expect(page.locator('.hx-chart-header [data-provider-toggle], .hx-chart-header .hx-provider-chips')).toHaveCount(0)

  const liveWire = page.getByRole('region', { name: 'Live Wire', exact: true })
  await expect(liveWire).toBeVisible()
  await liveWire.locator('.hub-live-wire__chip').first().click()
  await expect(chart).toHaveAttribute('data-selected', 'true')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  expect(runtimeErrors).toEqual([])
})

test('Live Wire explains the detected event and keeps chat plus emote from the same channel', async ({ page }) => {
  await installHubUxMock(page, { truthV1: true })
  await page.goto('/analytics')

  const liveWire = page.getByRole('region', { name: 'Live Wire', exact: true })
  await expect(liveWire).toBeVisible()
  const xqc = liveWire.locator('.hub-live-wire__chip').filter({ hasText: 'xQc' }).first()
  await expect(xqc).toContainText('Emote spike')
  await expect(xqc).toContainText('Emotes reached 133/min')
  await expect(xqc).toContainText("this stream's earlier average")
  await expect(xqc).toContainText('60/63 earlier minutes')

  await xqc.click()
  const inspector = page.getByRole('complementary', { name: 'Moment Inspector' })
  await expect(inspector).toContainText('Twitch emote spike')
  await expect(inspector.locator('.pulse-moments__inspector-stat').filter({ hasText: 'Emotes / min' })).toContainText('133')
  await expect(inspector.locator('.pulse-moments__inspector-stat').filter({ hasText: 'Chat / min' })).toContainText('393')
})

test('Live Wire inspection selects the matching chart bucket and Escape clears it', async ({ page }) => {
  await installHubUxMock(page)
  await page.goto('/analytics')

  const liveWire = page.getByRole('region', { name: 'Live Wire', exact: true })
  await liveWire.locator('.hub-live-wire__chip').first().click()
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
  await expect(page.getByRole('region', { name: 'Live Wire', exact: true })).toBeVisible()
  await expect(page.locator('.hub-live-wire__chip-new')).toHaveCount(0)
})
