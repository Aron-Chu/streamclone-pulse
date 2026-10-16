import { expect, test, type Route } from '@playwright/test'

// Twitch logins are [a-z0-9_]: a hyphen routes to Page not found.
const LOGIN = 'cashapp_fixture'
const STREAM_ID = 'cashapp-stream'
const STARTED_AT = '2026-07-27T18:00:00.000Z'

function json(route: Route, body: unknown): Promise<void> {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

test('a short limited session draws per-minute bars and the hover readout follows the pointer', async ({ page }) => {
  const stream = {
    streamId: STREAM_ID,
    login: LOGIN,
    displayName: 'Cash App Fixture',
    title: 'Smooth to complex chart fixture',
    startedAt: STARTED_AT,
    endedAt: '2026-07-27T18:08:00.000Z',
    avgViewers: 1200,
    peakViewers: 1500,
  }
  const minutes = Array.from({ length: 8 }, (_, index) => ({
    offsetSeconds: index * 60,
    viewerAvg: 1000 + [0, 160, 80, 300, 180, 460, 260, 390][index]!,
    viewerSamples: 2,
    chatCount: 20 + index * 8,
    totalEmoteCount: 10 + index * 5,
  }))

  await page.route(/\/v1\/.*/, route => json(route, { items: [], streams: [], segments: [] }))
  await page.route(/\/v1\/portal\/analytics\/.*/, async route => {
    const path = new URL(route.request().url()).pathname
    if (path === `/v1/portal/analytics/channels/${LOGIN}/streams`) {
      await json(route, { channel: LOGIN, items: [stream] })
      return
    }
    if (path === `/v1/portal/analytics/streams/${STREAM_ID}`) {
      await json(route, {
        channel: LOGIN,
        state: 'historical',
        analyticsQuality: 'limited',
        chatCoveragePct: 6.63,
        stream,
      })
      return
    }
    if (path === `/v1/portal/analytics/streams/${STREAM_ID}/minutes`) {
      await json(route, {
        streamId: STREAM_ID,
        channel: LOGIN,
        startedAt: STARTED_AT,
        minutes,
      })
      return
    }
    if (path === `/v1/portal/analytics/streams/${STREAM_ID}/summary`) {
      await json(route, {
        streamId: STREAM_ID,
        channel: LOGIN,
        analyticsQuality: 'limited',
        metrics: {
          sync_health_state: 'partial',
          data_coverage_pct: 6.63,
          minutesWithData: minutes.length,
          viewerSampleCount: minutes.length,
        },
      })
      return
    }
    if (path.endsWith('/games')) {
      await json(route, { streamId: STREAM_ID, segments: [] })
      return
    }
    if (path.endsWith('/sync/status')) {
      await json(route, {
        streamId: STREAM_ID,
        phase: 'completed',
        updatedAt: '2026-07-27T18:08:00.000Z',
      })
      return
    }
    await json(route, { items: [], streams: [], segments: [] })
  })

  await page.goto(`/analytics/${LOGIN}/${STREAM_ID}`, { waitUntil: 'domcontentloaded' })

  // d3 session chart (plan §1.2): the Cash App overview/detail transition is
  // gone. A short limited-quality session draws one bar per measured minute;
  // hovering reads that minute and leaving the plot restores the resting line.
  const chart = page.locator('svg[aria-label="Analytics timeline chart"]')
  await expect(chart).toBeVisible()
  await expect(chart).toHaveAttribute('data-activity-bucket-minutes', '1')
  const bars = chart.locator('rect.spc-bar')
  await expect.poll(() => bars.count()).toBeGreaterThan(0)
  expect(await bars.count()).toBeLessThanOrEqual(minutes.length)
  await expect(chart.locator('[data-activity-bar-peak]')).toHaveCount(0)

  const readout = page.locator('[data-session-readout]')
  const resting = (await readout.textContent()) ?? ''
  const area = chart.locator('rect[data-chart-touch-action]')
  await chart.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }))
  const box = await area.boundingBox()
  expect(box).toBeTruthy()
  await page.mouse.move(box!.x + box!.width * 0.36, box!.y + box!.height * 0.5)
  await expect(readout).not.toHaveText(resting)
  await expect(readout).toContainText(/0:0\d:00/)

  await page.mouse.move(2, 2)
  await expect(readout).toHaveText(resting)
})
