import { expect, test } from '@playwright/test'
import {
  assertNoUnexpected,
  buildDetail,
  buildMinutes,
  buildStatus,
  buildStreamRecord,
  getMountId,
  installPortalAcceptanceHarness,
  openAnalyticsSession,
  PORTAL_STREAM_ID,
  PORTAL_VOD_ID,
} from './helpers/portalAcceptanceHarness'

test.describe('portal lifecycle (mocked)', () => {
  test('A: live → ended → resolving → linked without remount; polling stops', async ({ page }) => {
    const harness = await installPortalAcceptanceHarness(page)
    harness.setMinutesPayload(buildMinutes({ count: 24, withEmotes: true }))

    const resolvingStatus = {
      kind: 'json' as const,
      body: buildStatus({
        state: 'ended',
        availability: { liveDvrState: 'ended', vodState: 'resolving', chartState: 'usable' },
        stream: buildStreamRecord({ endedAt: '2026-07-26T04:00:00.000Z', currentViewers: 0 }),
      }),
    }
    const linkedStatus = {
      kind: 'json' as const,
      body: buildStatus({
        state: 'ended',
        vodId: PORTAL_VOD_ID,
        availability: {
          liveDvrState: 'ended',
          vodState: 'linked',
          vodId: PORTAL_VOD_ID,
          chartState: 'usable',
        },
        stream: buildStreamRecord({
          endedAt: '2026-07-26T04:00:00.000Z',
          currentViewers: 0,
          vodId: PORTAL_VOD_ID,
        }),
      }),
    }
    harness.status.push(
      { kind: 'json', body: buildStatus({ state: 'live', availability: { liveDvrState: 'live', vodState: 'pending_live', chartState: 'usable' } }) },
      resolvingStatus,
      resolvingStatus,
      // Pad linked — Linux CI may consume an extra status tick before assert.
      linkedStatus,
      linkedStatus,
      linkedStatus,
    )

    harness.detail.setFallback({
      kind: 'json',
      body: buildDetail({
        state: 'live',
        availability: { liveDvrState: 'live', vodState: 'pending_live', chartState: 'usable', chartUsable: true },
      }),
    })

    await openAnalyticsSession(page)
    await expect(page.getByText(/VOD pending \(live\)|Live — no VOD yet/i).first()).toBeVisible()
    await expect(page.getByText(/Just Chatting|xQc|Deterministic portal/i).first()).toBeVisible()

    const mountBefore = await getMountId(page)
    const chatBefore = await page.locator('text=/chat|emote|viewer/i').count()
    expect(chatBefore).toBeGreaterThan(0)

    const statusBefore = harness.counter.count(`/streams/${PORTAL_STREAM_ID}/status`)

    await harness.advancePoll(30_000)
    await expect(page.getByText(/Waiting for Twitch VOD/i).first()).toBeVisible({ timeout: 15_000 })

    await expect
      .poll(
        async () => {
          await harness.advancePoll(30_000)
          return page.getByText(/Jump to VOD|open the full VOD|VOD vod_exact/i).count()
        },
        { timeout: 45_000, intervals: [200, 500, 1000] },
      )
      .toBeGreaterThan(0)
    await expect(page.getByText(/Jump to VOD|open the full VOD|VOD vod_exact/i).first()).toBeVisible()
    await expect(page.getByText('VOD unavailable')).toHaveCount(0)

    const mountAfter = await getMountId(page)
    expect(mountAfter).toBe(mountBefore)

    // Terminal linked — further polls should stop (no additional status after settle).
    const statusAtLinked = harness.counter.count(`/streams/${PORTAL_STREAM_ID}/status`)
    await harness.advancePoll(60_000)
    await page.waitForTimeout(200)
    const statusAfterStop = harness.counter.count(`/streams/${PORTAL_STREAM_ID}/status`)
    expect(statusAtLinked).toBeGreaterThan(statusBefore)
    expect(statusAfterStop).toBe(statusAtLinked)

    await assertNoUnexpected(harness)
  })
})
