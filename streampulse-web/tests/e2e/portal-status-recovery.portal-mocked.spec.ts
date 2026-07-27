import { expect, test } from '@playwright/test'
import {
  assertNoUnexpected,
  buildDetail,
  buildMinutes,
  buildStatus,
  getMountId,
  installPortalAcceptanceHarness,
  openAnalyticsSession,
  PORTAL_STREAM_ID,
} from './helpers/portalAcceptanceHarness'

test.describe('portal status recovery (mocked)', () => {
  for (const failure of [
    { name: '404', spec: { kind: 'json' as const, status: 404, body: { error: 'not_found' } } },
    { name: '500', spec: { kind: 'json' as const, status: 500, body: { error: 'boom' } } },
    { name: 'timeout', spec: { kind: 'timeout' as const } },
    { name: 'malformed', spec: { kind: 'text' as const, status: 502, body: '{not-json', contentType: 'text/plain' } },
  ]) {
    test(`B: status ${failure.name} shows request_failed/reconnecting then recovers`, async ({ page }) => {
      test.setTimeout(failure.name === 'timeout' ? 120_000 : 90_000)
      const harness = await installPortalAcceptanceHarness(page)
      harness.setMinutesPayload(buildMinutes({ count: 20 }))
      harness.detail.setFallback({
        kind: 'json',
        body: buildDetail({
          state: 'ended',
          availability: {
            liveDvrState: 'ended',
            vodState: 'resolving',
            chartState: 'usable',
            chartUsable: true,
          },
        }),
      })

      harness.status.push(
        {
          kind: 'json',
          body: buildStatus({
            state: 'ended',
            availability: { liveDvrState: 'ended', vodState: 'resolving', chartState: 'usable' },
          }),
        },
        failure.spec,
        // React Query statusQuery retry:1 + apiClient may consume a second failure tick.
        failure.spec,
        {
          kind: 'json',
          body: buildStatus({
            state: 'ended',
            availability: {
              liveDvrState: 'ended',
              vodState: 'request_failed',
              vodMessage: 'Helix timeout',
              chartState: 'usable',
            },
          }),
        },
        {
          kind: 'json',
          body: buildStatus({
            state: 'ended',
            availability: {
              liveDvrState: 'ended',
              vodState: 'resolving',
              chartState: 'usable',
            },
          }),
        },
      )

      await openAnalyticsSession(page)
      const mountBefore = await getMountId(page)
      await expect(page.getByText(/Waiting for Twitch VOD|VOD pending/i).first()).toBeVisible()

      // Trigger failure poll(s), then the authored request_failed recovery poll.
      if (failure.name === 'timeout') {
        await page.clock.fastForward(10_000)
      }
      await expect
        .poll(
          async () => {
            await harness.advancePoll(30_000)
            return page.getByText(/VOD lookup failed|request failed|reconnecting|Could not reach|Helix/i).count()
          },
          { timeout: failure.name === 'timeout' ? 90_000 : 45_000, intervals: [200, 500, 1000] },
        )
        .toBeGreaterThan(0)

      await expect(
        page.getByText(/VOD lookup failed|request failed|reconnecting|Could not reach|Helix/i).first(),
      ).toBeVisible({ timeout: 5_000 })
      await expect(page.getByText('VOD unavailable')).toHaveCount(0)

      await harness.advancePoll(30_000)
      await expect(page.getByText(/Waiting for Twitch VOD|VOD lookup failed/i).first()).toBeVisible()
      expect(await getMountId(page)).toBe(mountBefore)

      expect(harness.counter.count(`/streams/${PORTAL_STREAM_ID}/status`)).toBeGreaterThan(0)
      await assertNoUnexpected(harness)
    })
  }
})
