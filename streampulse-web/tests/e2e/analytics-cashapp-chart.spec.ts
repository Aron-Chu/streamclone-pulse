import { expect, test, type Route } from '@playwright/test'

const LOGIN = 'cashapp-fixture'
const STREAM_ID = 'cashapp-stream'
const STARTED_AT = '2026-07-27T18:00:00.000Z'

function json(route: Route, body: unknown): Promise<void> {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

test('session chart expands from overview to faded-future detail', async ({ page }) => {
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

  const chart = page.locator('svg[aria-label="Analytics timeline chart"]')
  await expect(chart).toBeVisible()
  await expect(chart).toHaveAttribute('data-chart-mode', 'overview')
  await expect(chart.locator('[data-chart-layer="overview"]')).toHaveCount(1)

  const box = await chart.boundingBox()
  expect(box).toBeTruthy()
  await chart.hover({ position: { x: box!.width * 0.36, y: box!.height * 0.5 } })

  await expect(chart).toHaveAttribute('data-chart-mode', 'detail')
  await expect(chart.locator('[data-chart-layer="detail-past"]').first()).toBeVisible()
  await expect(chart.locator('[data-chart-layer="detail-future"]').first()).toHaveAttribute(
    'stroke',
    'rgba(161, 161, 170, 0.58)',
  )

  await page.mouse.move(2, 2)
  await expect(chart).toHaveAttribute('data-chart-mode', 'overview')
})
