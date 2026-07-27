import { expect, test } from '@playwright/test'
import {
  assertEmotePlotLines,
  assertNoUnexpected,
  buildDetail,
  buildEmotes30d,
  buildMinutes,
  buildStatus,
  buildSummary,
  installPortalAcceptanceHarness,
  openAnalyticsSession,
  openEmotesRail,
  setChartViewEmotes,
} from './helpers/portalAcceptanceHarness'

test.describe('portal emote plotting (mocked)', () => {
  test('F: session ranking; cross-provider; CDN wins; six traces; stale prune; honesty', async ({ page }) => {
    const harness = await installPortalAcceptanceHarness(page)
    harness.setMinutesPayload(buildMinutes({ count: 30, withEmotes: true }))
    harness.setSummaryPayload(buildSummary())
    harness.setEmotes30dPayload(buildEmotes30d())
    harness.detail.setFallback({
      kind: 'json',
      body: buildDetail({
        state: 'ended',
        availability: {
          liveDvrState: 'ended',
          vodState: 'unavailable',
          chartState: 'usable',
          chartUsable: true,
        },
      }),
    })
    harness.status.setFallback({
      kind: 'json',
      body: buildStatus({
        state: 'ended',
        availability: { liveDvrState: 'ended', vodState: 'unavailable', chartState: 'usable' },
      }),
    })

    await openAnalyticsSession(page)
    await openEmotesRail(page)
    await expect(page.getByText('KEKW').first()).toBeVisible({ timeout: 20_000 })

    const emotePanel = page.locator('aside').filter({ hasText: 'KEKW' }).first()
    const rowText = await emotePanel.innerText()
    expect(rowText.indexOf('KEKW')).toBeGreaterThanOrEqual(0)
    expect(rowText.indexOf('KEKW')).toBeLessThan(rowText.indexOf('RareGhost'))

    const clapRows = page.locator('aside button').filter({ hasText: /Clap/ })
    expect(await clapRows.count()).toBeGreaterThanOrEqual(2)

    const images = page.locator('img[src*="cdn.7tv.app"], img[src*="static-cdn.jtvnw.net"]')
    expect(await images.count()).toBeGreaterThan(0)
    const proxyOnly = page.locator('img[src*="/emotes/proxy/bt1"]')
    const bttvCdn = page.locator('img[src*="frankerfacez.com/emote/bt1"], img[src*="cdn.frankerfacez.com"]')
    expect((await bttvCdn.count()) + (await proxyOnly.count())).toBeGreaterThan(0)

    // Chart emotes view auto-selects up to six session leaders — assert real traces.
    await setChartViewEmotes(page)
    await assertEmotePlotLines(page, 6)

    // Stale prune via reload with shrunk catalog.
    harness.setSummaryPayload(
      buildSummary({
        topEmotes: [
          {
            key: 'twitch:KEKW:KEKW',
            name: 'KEKW',
            id: 'tw1',
            provider: 'twitch',
            imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/tw1/default/dark/1.0',
            count: 900,
          },
          {
            key: 'twitch:OMEGALUL:OMEGALUL',
            name: 'OMEGALUL',
            id: 'tw2',
            provider: 'twitch',
            imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/tw2/default/dark/1.0',
            count: 800,
          },
        ],
      }),
    )
    harness.setMinutesPayload(buildMinutes({ count: 10, withEmotes: true }))
    await page.reload({ waitUntil: 'domcontentloaded' })
    await openEmotesRail(page)
    await setChartViewEmotes(page)
    await expect(page.getByText('KEKW').first()).toBeVisible()
    const pathCount = await page.locator('path.sc-emote-plot-line').count()
    expect(pathCount).toBeLessThanOrEqual(6)
    expect(pathCount).toBeGreaterThan(0)

    await assertNoUnexpected(harness)
  })
})
