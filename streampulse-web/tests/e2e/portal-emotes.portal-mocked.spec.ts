import { expect, test } from './helpers/portalMockedTest'
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
  plotSessionEmotes,
  SIX_SESSION_EMOTE_KEYS,
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

    // The chart starts with the session leader plotted. Add five more from
    // "Emotes on chart" and assert that each selected emote produces a real trace.
    await assertEmotePlotLines(page, 1)
    // The 7TV and BTTV Clap are two emotes: each plots its own trace.
    await plotSessionEmotes(page, ['7tv:Clap:Clap', 'bttv:Clap:Clap'])
    await assertEmotePlotLines(page, 3)
    for (const key of ['7tv:Clap:Clap', 'bttv:Clap:Clap']) {
      await expect(page.locator(`[data-bench-plot] path[data-lane-line="${key}"]`)).toHaveCount(1)
    }
    await page.locator('[data-session-emote-remove="bttv:Clap:Clap"]').click()
    await assertEmotePlotLines(page, 2)
    await plotSessionEmotes(page, SIX_SESSION_EMOTE_KEYS)
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
    await expect(page.getByText('KEKW').first()).toBeVisible()
    await expect(page.getByRole('tabpanel', { name: 'Emotes' })).not.toContainText('RareGhost')
    await assertEmotePlotLines(page, 1)

    await assertNoUnexpected(harness)
  })
})
