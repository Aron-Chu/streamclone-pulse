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
    { name: 'timeout', spec: { kind: 'timeout' as const, delayMs: 12_000 } },
    { name: 'malformed', spec: { kind: 'text' as const, status: 502, body: '{not-json', contentType: 'text/plain' } },
  ]) {
    test(`B: status ${failure.name} shows request_failed/reconnecting then recovers`, async ({ page }) => {
      test.setTimeout(failure.name === 'timeout' ? 120_000 : 90_000)
      const harness = await installPortalAcceptanceHarness(page)
      harness.setMinutesPayload(buildMinutes({ count: 20 }))

      const resolvingBody = buildStatus({
        state: 'ended',
        availability: { liveDvrState: 'ended', vodState: 'resolving', chartState: 'usable' },
      })
      const failedBody = buildStatus({
        state: 'ended',
        availability: {
          liveDvrState: 'ended',
          vodState: 'request_failed',
          vodMessage: 'Helix timeout',
          chartState: 'usable',
        },
      })

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

      // Keep fallback on request_failed so draining the queue cannot snap back to live pending.
      harness.status.setFallback({ kind: 'json', body: failedBody })
      harness.status.push(
        { kind: 'json', body: resolvingBody },
        failure.spec,
        // React Query retry:1 and/or apiClient retries may consume an extra failure tick.
        failure.spec,
        { kind: 'json', body: failedBody },
        { kind: 'json', body: failedBody },
        { kind: 'json', body: resolvingBody },
      )

      await openAnalyticsSession(page)
      const mountBefore = await getMountId(page)
      await expect(page.getByText(/Waiting for Twitch VOD/i).first()).toBeVisible({ timeout: 20_000 })

      if (failure.name === 'timeout') {
        // Hold long enough for apiClient timeout under fake timers.
        await page.clock.fastForward(15_000)
      }

      let sawFailed = false
      for (let i = 0; i < 10; i += 1) {
        await harness.advancePoll(30_000)
        if ((await page.getByText(/VOD lookup failed|Helix timeout/i).count()) > 0) {
          sawFailed = true
          break
        }
      }
      expect(sawFailed, 'expected request_failed VOD chip/message after status errors').toBe(true)
      await expect(page.getByText('VOD unavailable')).toHaveCount(0)

      // Further polls may return resolving again — mount must stay stable.
      await harness.advancePoll(30_000)
      expect(await getMountId(page)).toBe(mountBefore)

      expect(harness.counter.count(`/streams/${PORTAL_STREAM_ID}/status`)).toBeGreaterThan(0)
      await assertNoUnexpected(harness)
    })
  }
})
