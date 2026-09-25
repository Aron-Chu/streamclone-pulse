import { test, expect } from '@playwright/test'
import portalTimingFixture from '../fixtures/portal_vod_timing_v1.json' with { type: 'json' }

for (const width of [390, 1370, 1920]) {
  test(`selected moment reaches its full content at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.route('https://player.twitch.tv/**', route => route.fulfill({ contentType: 'text/html', body: '<p>Replay preview</p>' }))
    await page.route(/\/v1\/portal\/analytics\/streams\/321192454233(?:\?.*)?$/, route => route.fulfill({ json: portalTimingFixture }))
    await page.route('**/v1/portal/analytics/streams/321192454233/recap', route => route.fulfill({ json: {
      login: 'xqc', streamId: '321192454233', topMoments: [{ offsetSeconds: 5183, reasons: ['chat_spike'] }],
    } }))
    await page.goto('/analytics/moments?login=xqc&stream=321192454233&offset=5183')
    const detail = page.getByRole('region', { name: 'Selected moment', exact: true })
    await expect(detail.getByRole('link', { name: /^Open VOD at/ })).toHaveCount(1)
    if (width > 760) {
      await detail.focus()
      await page.keyboard.press('End')
      await expect.poll(() => detail.evaluate(el => el.scrollTop)).toBeGreaterThan(0)
      await expect(detail.locator('.moments-evidence')).toBeInViewport()
      await page.keyboard.press('Home')
      await expect.poll(() => detail.evaluate(el => el.scrollTop)).toBe(0)
      await detail.hover({ position: { x: 15, y: 120 } })
      await page.mouse.wheel(0, 1500)
      await expect.poll(() => detail.evaluate(el => el.scrollTop)).toBeGreaterThan(0)
      expect((await detail.boundingBox())!.height).toBeLessThanOrEqual(696)
    } else {
      expect(await detail.evaluate(el => getComputedStyle(el).overflowY)).toBe('visible')
      await detail.locator('.moments-evidence').scrollIntoViewIfNeeded()
      await expect(detail.locator('.moments-evidence')).toBeInViewport()
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}
