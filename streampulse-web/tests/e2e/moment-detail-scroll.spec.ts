import { test, expect } from '@playwright/test'
import portalTimingFixture from '../fixtures/portal_vod_timing_v1.json' with { type: 'json' }

// The detail opens in line, inside the page, so it never scrolls on its own: the
// page does, and every part of it stays reachable at every width.
for (const width of [390, 1370, 1920]) {
  test(`selected moment reaches its full content at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    // Mock-only: an API read this test does not answer fails here, never against production.
    await page.route('**/v1/**', route => route.fulfill({ status: 503, json: { error: 'unmocked_endpoint' } }))
    // The chart's lazy minutes read fails, so the detail settles on its retry note and draws no bars.
    await page.route(/\/v1\/portal\/analytics\/streams\/321192454233\/minutes(?:\?.*)?$/, route => route.fulfill({ status: 503, json: { error: 'stream_unavailable' } }))
    await page.route('https://player.twitch.tv/**', route => route.fulfill({ contentType: 'text/html', body: '<p>Replay preview</p>' }))
    await page.route(/\/v1\/portal\/analytics\/streams\/321192454233(?:\?.*)?$/, route => route.fulfill({ json: portalTimingFixture }))
    await page.route('**/v1/portal/analytics/streams/321192454233/recap', route => route.fulfill({ json: {
      login: 'xqc', streamId: '321192454233', topMoments: [{ offsetSeconds: 5183, reasons: ['chat_spike'] }],
    } }))
    await page.goto('/analytics/moments?login=xqc&stream=321192454233&offset=5183')
    const detail = page.getByRole('region', { name: /^Selected moment: / })
    await expect(detail.getByRole('link', { name: /^Open VOD at/ })).toHaveCount(1)
    // Let the lazy reads settle before measuring.
    await expect(detail.locator('.moment-minutes-note[data-state="error"]')).toBeVisible()
    await expect(detail.locator('.moments-source > summary')).toHaveText('Source & playback details')
    expect(await detail.evaluate(el => getComputedStyle(el).overflowY)).toBe('visible')
    expect(await detail.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true)
    // The page itself reaches the end of the detail, by keyboard and by wheel.
    await page.keyboard.press('End')
    await expect(detail.locator('.moments-evidence')).toBeInViewport()
    await page.keyboard.press('Home')
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
    await page.mouse.move(width / 2, 400)
    await page.mouse.wheel(0, 4000)
    await expect(detail.locator('.moments-evidence')).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}
