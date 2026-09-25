import { test, expect } from '../helpers/testFixtures.ts'
import { openTwitchChannel, openTwitchVod } from '../helpers/mockTwitch.ts'
import { waitForPulseRoot } from '../helpers/assertions.ts'
import { readFileSync } from 'node:fs'

for (const surface of ['live', 'vod'] as const) {
  test(`${surface} sidebar exposes working zoom and reset controls`, async ({ extension, prepare }, info) => {
    await prepare({ scenario: surface === 'live' ? 'live-ready' : 'vod-ready', twitchKind: surface,
      storage: { overlayPlacement: 'sidebar', sidebarTab: 'pulse', overlayMode: 'expanded' } })
    const page = extension.page
    if (surface === 'vod') {
      const vod = JSON.parse(readFileSync(new URL('../fixtures/api/vod-ready.json', import.meta.url), 'utf8'))
      vod.timeline.points = Array.from({ length: 60 }, (_, i) => ({ offsetSeconds: i * 60, chatPerMin: 40 + i % 12, emotesPerMin: 12 + i % 8, viewers: 800 + i, score: 40 }))
      await extension.context.route('https://api.streampulse.stream/v1/extension/pulse/vods/*', route => route.fulfill({ json: vod }))
    }
    await page.setViewportSize({ width: 1100, height: 900 })
    if (surface === 'live') await openTwitchChannel(page)
    else await openTwitchVod(page)
    await waitForPulseRoot(page)
    const root = page.locator('#streamclone-pulse-root')
    const controls = root.locator('[data-chart-viewport-controls]').first()
    const zoomIn = controls.getByRole('button', { name: 'Zoom in chart', exact: true })
    const zoomOut = controls.getByRole('button', { name: 'Zoom out chart', exact: true })
    const reset = controls.getByRole('button', { name: 'Reset chart view', exact: true })
    await expect(zoomIn).toHaveCount(0)
    const slider = controls.getByRole('slider', { name: 'Chart zoom and position', exact: true })
    await expect(slider).toBeVisible()
    const fullRail = await slider.boundingBox()
    await slider.press('[')
    await expect(zoomIn).toBeEnabled()
    await expect(zoomIn).toHaveCSS('width', '24px')
    await expect(zoomIn).toHaveCSS('height', '24px')
    await expect(reset).toHaveCSS('width', '44px')
    await expect(reset).toHaveCSS('height', '24px')
    expect((await slider.boundingBox())!.width).toBeCloseTo(fullRail!.width, 2)
    await zoomIn.click()
    await expect(zoomOut).toBeEnabled()
    await expect(reset).toBeEnabled()
    await expect(controls.locator('[data-chart-visible-range]')).not.toHaveText('Full stream')
    await page.screenshot({ path: info.outputPath(`${surface}-zoomed.png`) })
    await zoomOut.click()
    await zoomIn.click()
    await reset.click()
    await expect(reset).toHaveCount(0)
    await expect(slider).toBeFocused()
    await expect(controls.locator('[data-chart-visible-range]')).toHaveText(/Full stream/i)
    expect(await controls.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  })
}
