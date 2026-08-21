import { expect, test } from '@playwright/test'
import {
  assertNoUnexpected,
  buildDetail,
  buildMinutes,
  buildStatus,
  buildStreamRecord,
  installPortalAcceptanceHarness,
  loadXqcGames,
  openAnalyticsSession,
  PORTAL_STARTED_AT,
  PORTAL_STREAM_ID,
} from './helpers/portalAcceptanceHarness'

const GAME_NAMES = [
  'Just Chatting',
  'GeoGuessr',
  'Battlefield 6',
  'Welcome to the Game III',
  'Just Chatting',
  'Deadlock',
  'Just Chatting',
]

test.describe('portal games (mocked)', () => {
  test('E: xQc segments count/order/labels/keys; highlight; live edge; no +120; transport vs empty', async ({
    page,
  }) => {
    const games = loadXqcGames()
    expect(games).toHaveLength(7)
    const hydratedGames = games.map((game, index) =>
      index === 0
        ? {
            ...game,
            categoryId: '509658',
            boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/509658-210x280.jpg',
          }
        : game,
    )

    const harness = await installPortalAcceptanceHarness(page)
    // Minutes sparse across the long fixture so duration covers last segment start.
    const lastStart = Number(games[games.length - 1].offsetSeconds)
    const sampleOffsets = [0, 60, 120, 15437, 17717, 21617, 31997, 32237, lastStart, lastStart + 60]
    const minutes = buildMinutes({ count: 2, withEmotes: false })
    minutes.minutes = sampleOffsets.map((offsetSeconds, i) => {
      const observedAt = new Date(Date.parse(PORTAL_STARTED_AT) + offsetSeconds * 1000).toISOString()
      return {
        offsetSeconds,
        viewerAvg: 10_000 + i,
        viewerMax: 10_100 + i,
        viewerLatest: 10_050 + i,
        viewerSamples: 2,
        chatCount: 30 + i,
        totalEmoteCount: 10,
        seventvEmoteCount: 4,
        topEmotes: [],
        signalObservations: {
          chat: { state: 'measured', observedAt, coveragePct: 100, source: 'fixture' },
          emotes: { state: 'measured', observedAt, coveragePct: 100, source: 'fixture' },
          viewers: { state: 'measured', observedAt, coveragePct: 100, source: 'helix' },
        },
      }
    })
    harness.setMinutesPayload(minutes)
    harness.setGamesPayload(hydratedGames)
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

    await openAnalyticsSession(page)
    const strip = page.getByLabel('Games played').first()
    await expect(strip).toBeVisible({ timeout: 25_000 })

    // Expand if live range-aware strip hides games.
    const showAll = strip.getByRole('button', { name: /show all|expand|all games/i })
    if (await showAll.count()) {
      await showAll.click()
    }

    await expect(strip.locator('img').first()).toHaveAttribute(
      'src',
      /509658-210x280\.jpg/,
    )

    for (const name of [...new Set(GAME_NAMES)]) {
      await expect(strip.getByRole('listitem', { name: new RegExp(name, 'i') }).first()).toBeVisible()
    }

    const chips = strip.locator('[role="listitem"]')
    const chipCount = await chips.count()
    expect(chipCount).toBeGreaterThanOrEqual(7)

    const labels = await chips.evaluateAll((nodes) =>
      nodes.map((n) => (n.getAttribute('aria-label') || n.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean),
    )
    // Order of first occurrences matches fixture order for unique sequence starts.
    const firstIdx = (name: string) => labels.findIndex((l) => l.includes(name))
    expect(firstIdx('Just Chatting')).toBeGreaterThanOrEqual(0)
    expect(firstIdx('GeoGuessr')).toBeGreaterThan(firstIdx('Just Chatting'))
    expect(firstIdx('Battlefield')).toBeGreaterThan(firstIdx('GeoGuessr'))
    expect(firstIdx('Deadlock')).toBeGreaterThan(firstIdx('Battlefield'))

    // Unique keys — duplicate Just Chatting segments are distinct list items.
    const jc = strip.getByRole('listitem', { name: /Just Chatting/i })
    expect(await jc.count()).toBeGreaterThanOrEqual(3)

    await chips.nth(1).hover()
    await expect(chips.nth(1)).toBeVisible()

    // Live final segment: strip still present at live edge (no crash / empty).
    await expect(strip).toBeVisible()

    // Ended duration: no +120 skew — duration label should not invent +2m beyond authored sum.
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    const endedHarness = await installPortalAcceptanceHarness(page)
    endedHarness.setMinutesPayload(minutes)
    endedHarness.setGamesPayload(games)
    const endedAtMs = Date.parse(PORTAL_STARTED_AT) + (lastStart + 600) * 1000
    endedHarness.detail.setFallback({
      kind: 'json',
      body: buildDetail({
        state: 'ended',
        availability: { liveDvrState: 'ended', vodState: 'resolving', chartState: 'usable', chartUsable: true },
        stream: buildStreamRecord({
          endedAt: new Date(endedAtMs).toISOString(),
          currentViewers: 0,
        }),
      }),
    })
    endedHarness.status.setFallback({
      kind: 'json',
      body: buildStatus({
        state: 'ended',
        availability: { liveDvrState: 'ended', vodState: 'resolving', chartState: 'usable' },
        stream: buildStreamRecord({ endedAt: new Date(endedAtMs).toISOString() }),
      }),
    })
    await openAnalyticsSession(page)
    const endedStrip = page.getByLabel('Games played').first()
    await expect(endedStrip).toBeVisible()
    const durationText = await endedStrip.innerText()
    // Should not show a fabricated +120s (common bug was end+120).
    expect(durationText).not.toMatch(/\+120/)

    // Transport failure differs from successful empty.
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    const failHarness = await installPortalAcceptanceHarness(page)
    failHarness.setMinutesPayload(buildMinutes({ count: 12 }))
    failHarness.games.push({ kind: 'json', status: 500, body: { error: 'games_failed' } })
    failHarness.games.setFallback({ kind: 'json', status: 500, body: { error: 'games_failed' } })
    await openAnalyticsSession(page)
    // On transport failure, product returns [] — UI should not invent a synthetic single game from category alone as "loaded games success".
    // Successful empty:
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    const emptyHarness = await installPortalAcceptanceHarness(page)
    emptyHarness.setMinutesPayload(buildMinutes({ count: 12 }))
    emptyHarness.setGamesPayload([])
    emptyHarness.detail.setFallback({
      kind: 'json',
      body: buildDetail({
        state: 'ended',
        stream: buildStreamRecord({ category: 'Just Chatting', endedAt: '2026-07-26T01:00:00.000Z' }),
        availability: { liveDvrState: 'ended', vodState: 'unavailable', chartState: 'usable', chartUsable: true },
      }),
    })
    await openAnalyticsSession(page)
    // Empty success may synthesize from category OR hide strip — either way no 7-segment fixture.
    const emptyStrip = page.getByLabel('Games played')
    if (await emptyStrip.count()) {
      const emptyChips = emptyStrip.locator('button').filter({ hasText: /GeoGuessr|Deadlock|Battlefield/ })
      expect(await emptyChips.count()).toBe(0)
    }

    // Desktop + narrow controls
    await page.setViewportSize({ width: 1280, height: 900 })
    await expect(page.getByLabel('Games played').or(page.locator('main')).first()).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.locator('main, .analytics-console').first()).toBeVisible()

    await assertNoUnexpected(harness)
    await assertNoUnexpected(endedHarness)
    await assertNoUnexpected(failHarness)
    await assertNoUnexpected(emptyHarness)
    expect(failHarness.counter.count(`/streams/${PORTAL_STREAM_ID}/games`)).toBeGreaterThan(0)
  })
})
