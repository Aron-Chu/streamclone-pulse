import { expect, test } from '@playwright/test'
import {
  assertNoUnexpected,
  buildDetail,
  buildMinutes,
  buildRecap,
  buildStatus,
  buildStreamRecord,
  installPortalAcceptanceHarness,
  openAnalyticsSession,
  PORTAL_STREAM_ID,
  PORTAL_VOD_ID,
} from './helpers/portalAcceptanceHarness'

const OTHER_VOD_ID = '498765432108'

test.describe('portal VOD correctness (mocked)', () => {
  test('status cache miss keeps an ended session in the pending-archive state', async ({ page }) => {
    const harness = await installPortalAcceptanceHarness(page)
    harness.setMinutesPayload(buildMinutes({ count: 20 }))
    harness.detail.setFallback({
      kind: 'json',
      body: buildDetail({
        state: 'ended',
        availability: { liveDvrState: 'ended', vodState: 'resolving', chartState: 'usable', chartUsable: true },
        stream: buildStreamRecord({ endedAt: '2026-07-26T04:00:00.000Z', vodId: '' }),
      }),
    })
    // No top-level vodId/vodTiming: this poll is a cache miss, not a fresh
    // source observation that may replace the full detail's archive state.
    harness.status.setFallback({
      kind: 'json',
      body: buildStatus({
        state: 'ended',
        availability: { liveDvrState: 'ended', vodState: 'resolving', chartState: 'usable' },
      }),
    })

    await openAnalyticsSession(page)
    await expect.poll(() => harness.counter.count(`/streams/${PORTAL_STREAM_ID}/status`)).toBeGreaterThan(0)
    await expect(page.getByRole('status').filter({ hasText: 'Past broadcast' })).toBeVisible()
    await expect(page.getByText('This broadcast is confirmed ended. A fresh archive check has not verified a link yet.', { exact: true })).toBeVisible()
    await expect(page.getByText(/This session is still live\. A timestamped VOD link/i)).toHaveCount(0)
    await expect(page.locator('a[href*="/videos/"]')).toHaveCount(0)
    await assertNoUnexpected(harness)
  })

  test('D: only verified archive timing creates an exact-stream VOD jump; pending stays on session', async ({
    page,
  }) => {
    const harness = await installPortalAcceptanceHarness(page)
    harness.setMinutesPayload(buildMinutes({ count: 30 }))

    // A linked-looking legacy hint without verified timing is not an archive
    // mapping. The unrelated recap must not supply this session's VOD.
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
        streamId: '320567744987',
        vodId: OTHER_VOD_ID,
      }),
    })

    await openAnalyticsSession(page)
    await expect(page.locator('a[href*="/videos/"]')).toHaveCount(0)
    await expect(page.getByText(OTHER_VOD_ID)).toHaveCount(0)
    await expect(page.getByRole('link', { name: /Jump to VOD ·/ })).toHaveCount(0)

    // Reload with a verified exact-stream identity, alignment and duration.
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    const harness2 = await installPortalAcceptanceHarness(page)
    harness2.setMinutesPayload(buildMinutes({ count: 30 }))
    harness2.detail.setFallback({
      kind: 'json',
      body: buildDetail({
        state: 'ended',
        vodId: PORTAL_VOD_ID,
        vodAlignSeconds: 120,
        vodDurationSeconds: 3_600,
        vodTiming: { state: 'verified' },
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
        vodAlignSeconds: 120,
        vodDurationSeconds: 3_600,
        vodTiming: { state: 'verified' },
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
    const fullVod = page.getByRole('link', { name: /open the full VOD/i })
    await expect(fullVod).toBeVisible()
    await expect(fullVod).toHaveAttribute('href', `https://www.twitch.tv/videos/${PORTAL_VOD_ID}`)
    await expect(page.locator(`a[href*="/videos/${OTHER_VOD_ID}"]`)).toHaveCount(0)

    const moment = page.getByRole('region', { name: 'Pulse moments recap' }).getByRole('button', { name: /00:04:00 into stream/ })
    await expect(moment).toBeVisible()
    await moment.click()
    const jump = page.getByRole('link', { name: /Jump to VOD ·/ }).first()
    await expect(jump).toBeVisible()
    // 120-second verified alignment plus the selected 240-second moment.
    await expect(jump).toHaveAttribute('href', `https://www.twitch.tv/videos/${PORTAL_VOD_ID}?t=6m0s`)

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
        // A cache miss cannot establish that the archive is still resolving.
        // This status is an explicit unsuccessful source observation.
        vodId: '',
        vodTiming: { state: 'unavailable' },
        availability: { liveDvrState: 'ended', vodState: 'resolving', chartState: 'usable' },
      }),
    })
    await openAnalyticsSession(page)
    await expect(page.getByText('Waiting for Twitch VOD publication.', { exact: true })).toBeVisible()
    await expect(page.locator(`a[href*="${OTHER_VOD_ID}"]`)).toHaveCount(0)
    await expect(page.locator('a[href*="/videos/"]')).toHaveCount(0)

    await assertNoUnexpected(harness)
    await assertNoUnexpected(harness2)
    await assertNoUnexpected(harness3)
  })
})
