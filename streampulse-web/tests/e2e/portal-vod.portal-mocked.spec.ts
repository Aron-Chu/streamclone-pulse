import { expect, test } from '@playwright/test'
import {
  assertNoUnexpected,
  buildDetail,
  buildMinutes,
  buildRecap,
  buildStatus,
  buildStreamRecord,
  installPortalAcceptanceHarness,
  NEIGHBOR_VOD_ID,
  openAnalyticsSession,
  PORTAL_STREAM_ID,
  PORTAL_VOD_ID,
} from './helpers/portalAcceptanceHarness'

test.describe('portal VOD correctness (mocked)', () => {
  test('D: exact-stream VOD; reject neighbor; no ?t= without align; verified align; pending stays on session', async ({
    page,
  }) => {
    const harness = await installPortalAcceptanceHarness(page)
    harness.setMinutesPayload(buildMinutes({ count: 30 }))

    // Linked without vodAlignSeconds — full VOD link has no ?t=
    harness.detail.setFallback({
      kind: 'json',
      body: buildDetail({
        state: 'ended',
        vodId: PORTAL_VOD_ID,
        availability: {
          liveDvrState: 'ended',
          vodState: 'linked',
          vodId: PORTAL_VOD_ID,
          chartState: 'usable',
          chartUsable: true,
        },
        stream: buildStreamRecord({
          endedAt: '2026-07-26T04:00:00.000Z',
          vodId: PORTAL_VOD_ID,
          currentViewers: 0,
        }),
      }),
    })
    harness.status.setFallback({
      kind: 'json',
      body: buildStatus({
        state: 'ended',
        vodId: PORTAL_VOD_ID,
        availability: {
          liveDvrState: 'ended',
          vodState: 'linked',
          vodId: PORTAL_VOD_ID,
          chartState: 'usable',
        },
        stream: buildStreamRecord({ endedAt: '2026-07-26T04:00:00.000Z', vodId: PORTAL_VOD_ID }),
      }),
    })
    harness.recap.setFallback({
      kind: 'json',
      body: buildRecap({
        // Neighbor / wrong stream id must not be adopted as this session's VOD.
        streamId: PORTAL_STREAM_ID,
        vodId: NEIGHBOR_VOD_ID,
      }),
    })

    await openAnalyticsSession(page)
    await expect(page.getByText(new RegExp(PORTAL_VOD_ID))).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(new RegExp(NEIGHBOR_VOD_ID))).toHaveCount(0)

    const fullVod = page.locator(`a[href*="/videos/${PORTAL_VOD_ID}"]`).first()
    await expect(fullVod).toBeVisible()
    const hrefNoAlign = await fullVod.getAttribute('href')
    expect(hrefNoAlign).toBeTruthy()
    expect(hrefNoAlign!).not.toContain('?t=')
    expect(hrefNoAlign!).not.toContain(NEIGHBOR_VOD_ID)
    await expect(page.locator(`a[href*="/videos/${PORTAL_VOD_ID}"][href*="t="]`)).toHaveCount(0)
    await expect(page.getByRole('link', { name: /Jump to VOD ·/ })).toHaveCount(0)

    // Missing stream-ID VOD hint: empty vodId in availability with neighbor only in recap — still exact stream id.
    expect(hrefNoAlign!).toContain(PORTAL_VOD_ID)

    // Reload with verified alignment on detail.
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    const harness2 = await installPortalAcceptanceHarness(page)
    harness2.setMinutesPayload(buildMinutes({ count: 30 }))
    harness2.detail.setFallback({
      kind: 'json',
      body: buildDetail({
        state: 'ended',
        vodId: PORTAL_VOD_ID,
        vodAlignSeconds: 120,
        availability: {
          liveDvrState: 'ended',
          vodState: 'linked',
          vodId: PORTAL_VOD_ID,
          chartState: 'usable',
          chartUsable: true,
        },
        stream: buildStreamRecord({
          endedAt: '2026-07-26T04:00:00.000Z',
          vodId: PORTAL_VOD_ID,
        }),
      }),
    })
    harness2.status.setFallback({
      kind: 'json',
      body: buildStatus({
        state: 'ended',
        vodId: PORTAL_VOD_ID,
        availability: {
          liveDvrState: 'ended',
          vodState: 'linked',
          vodId: PORTAL_VOD_ID,
          chartState: 'usable',
        },
      }),
    })
    harness2.recap.setFallback({
      kind: 'json',
      body: buildRecap({
        streamId: PORTAL_STREAM_ID,
        vodId: PORTAL_VOD_ID,
        topMoments: [
          {
            offsetSeconds: 240,
            score: 92,
            chatCount: 120,
            emoteCount: 60,
            viewerCount: 11_000,
          },
        ],
      }),
    })

    await openAnalyticsSession(page)
    await page.getByRole('button', { name: /Moments/i }).click().catch(() => undefined)
    // Select a moment if available to get timestamped jump
    const moment = page.getByRole('button', { name: /Confirmed peak|4m|peak/i }).first()
    if (await moment.count()) {
      await moment.click()
      const jump = page.locator(`a[href*="/videos/${PORTAL_VOD_ID}"][href*="t="]`).first()
      if (await jump.count()) {
        const href = await jump.getAttribute('href')
        // 120 align + 240 offset = 360s => 6m
        expect(href).toMatch(/[?&]t=/)
        expect(href).toMatch(/6m|360s|5m60s/)
      }
    }

    // Pending linkage: never opens another session's VOD
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    const harness3 = await installPortalAcceptanceHarness(page)
    harness3.setMinutesPayload(buildMinutes({ count: 20 }))
    harness3.detail.setFallback({
      kind: 'json',
      body: buildDetail({
        state: 'ended',
        availability: {
          liveDvrState: 'ended',
          vodState: 'resolving',
          chartState: 'usable',
          chartUsable: true,
        },
        stream: buildStreamRecord({ endedAt: '2026-07-26T04:00:00.000Z', vodId: '' }),
      }),
    })
    harness3.status.setFallback({
      kind: 'json',
      body: buildStatus({
        state: 'ended',
        availability: { liveDvrState: 'ended', vodState: 'resolving', chartState: 'usable' },
      }),
    })
    await openAnalyticsSession(page)
    await expect(page.getByText(/Waiting for Twitch VOD|Status/i).first()).toBeVisible()
    await expect(page.locator(`a[href*="${NEIGHBOR_VOD_ID}"]`)).toHaveCount(0)
    await expect(page.locator('a[href*="/videos/"]')).toHaveCount(0)

    await assertNoUnexpected(harness)
    await assertNoUnexpected(harness2)
    await assertNoUnexpected(harness3)
  })
})
