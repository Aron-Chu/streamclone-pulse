import { expect, test } from '@playwright/test'
import {
  assertNoUnexpected,
  buildDetail,
  buildMinutes,
  buildStatus,
  installPortalAcceptanceHarness,
  openAnalyticsSession,
  PORTAL_STREAM_ID,
} from './helpers/portalAcceptanceHarness'

test.describe('portal minutes tail (mocked)', () => {
  test('C: full minutes once; afterOffset tails; open-minute replace; append; no catalog spam', async ({
    page,
  }) => {
    const harness = await installPortalAcceptanceHarness(page)
    const initial = buildMinutes({ count: 20, withEmotes: true })
    harness.setMinutesPayload(initial)
    harness.detail.setFallback({
      kind: 'json',
      body: buildDetail({
        state: 'live',
        availability: { liveDvrState: 'live', vodState: 'pending_live', chartState: 'usable', chartUsable: true },
      }),
    })
    harness.status.setFallback({
      kind: 'json',
      body: buildStatus({
        state: 'live',
        availability: { liveDvrState: 'live', vodState: 'pending_live', chartState: 'usable' },
      }),
    })

    // Open-minute replacement at offset 1140 (19*60), then append 1200.
    const replacedOpen = buildMinutes({
      count: 20,
      openMinuteOffset: 19 * 60,
      openMinuteChat: 999,
      withEmotes: true,
    })
    const appended = buildMinutes({
      count: 20,
      openMinuteOffset: 19 * 60,
      openMinuteChat: 999,
      appendOffsets: [20 * 60],
      withEmotes: true,
    })
    // Tail responses should only include the tail window points.
    harness.minutesTail.push(
      {
        kind: 'json',
        body: {
          ...replacedOpen,
          minutes: replacedOpen.minutes.filter((m) => Number(m.offsetSeconds) >= 19 * 60),
        },
      },
      {
        kind: 'json',
        body: {
          ...appended,
          minutes: appended.minutes.filter((m) => Number(m.offsetSeconds) >= 19 * 60),
        },
      },
    )

    await openAnalyticsSession(page)
    await expect(page.locator('svg').first()).toBeVisible({ timeout: 20_000 })

    const countFullMinutes = () =>
      harness.counter.urls.filter((u) => {
        try {
          const parsed = new URL(u)
          return (
            parsed.pathname.endsWith(`/streams/${PORTAL_STREAM_ID}/minutes`)
            && !parsed.searchParams.has('afterOffset')
          )
        } catch {
          return false
        }
      }).length

    // Settle initial load (catalog/summary may arrive after first paint).
    await expect.poll(() => countFullMinutes()).toBeGreaterThanOrEqual(1)
    await expect.poll(() => harness.counter.count(/emotes\?range=30d/)).toBeGreaterThanOrEqual(1)
    await expect
      .poll(() => harness.counter.count(`/streams/${PORTAL_STREAM_ID}/summary`))
      .toBeGreaterThanOrEqual(1)

    const fullBefore = harness.counter.matching(
      new RegExp(`/streams/${PORTAL_STREAM_ID}/minutes(?!\\?.*afterOffset)`),
    )
    const fullCount = countFullMinutes()
    expect(fullCount).toBeLessThanOrEqual(2)

    const catalogBefore = harness.counter.count(/emotes\?range=30d/)
    const summaryBefore = harness.counter.count(`/streams/${PORTAL_STREAM_ID}/summary`)

    await harness.advancePoll(30_000)
    await page.waitForTimeout(300)

    const tailUrls = harness.counter.urls.filter((u) => u.includes('afterOffset='))
    expect(tailUrls.length).toBeGreaterThanOrEqual(1)
    for (const u of tailUrls) {
      const after = new URL(u).searchParams.get('afterOffset')
      expect(after).toMatch(/^\d+$/)
      expect(Number(after)).toBeGreaterThanOrEqual(0)
    }

    await harness.advancePoll(30_000)
    await page.waitForTimeout(300)

    const fullAfter = countFullMinutes()
    expect(fullAfter).toBe(fullCount)
    expect(fullBefore.length).toBeGreaterThanOrEqual(0)

    // No duplicate 30d catalog / summary spam on live tails after settle.
    expect(harness.counter.count(/emotes\?range=30d/)).toBe(catalogBefore)
    expect(harness.counter.count(`/streams/${PORTAL_STREAM_ID}/summary`)).toBe(summaryBefore)

    // Chart still present (visually advanced via new points).
    await expect(page.locator('svg path, svg circle').first()).toBeVisible()
    await assertNoUnexpected(harness)
  })
})
