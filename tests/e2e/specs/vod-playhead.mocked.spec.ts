import type { Locator, Page } from '@playwright/test'
import { test, expect } from '../helpers/testFixtures.ts'
import { openTwitchVod } from '../helpers/mockTwitch.ts'
import { waitForPulseRoot } from '../helpers/assertions.ts'

// A six-hour replay shaped like a real one: steady chat, emotes mostly 8-36 a
// minute with a few huge bursts (the 1,049 one used to flatten the line).
const MINUTES = 360
const BURSTS: Record<number, number> = { 95: 640, 210: 1049, 300: 410 }
const points = Array.from({ length: MINUTES }, (_, i) => ({
  offsetSeconds: i * 60,
  chatPerMin: 250 + Math.round(150 * Math.sin(i / 9)) + (i % 7) * 10,
  emotesPerMin: BURSTS[i] ?? 8 + ((i * 7) % 29),
  viewers: 15_000 + Math.round(800 * Math.sin(i / 40)),
  score: 40,
}))
const longVod = {
  mode: 'vod',
  vodId: '2806037629',
  streamId: 'stream-fixture-prev',
  channelLogin: 'fixturechan',
  channelDisplayName: 'fixturechan',
  title: 'Fixture long VOD',
  startedAt: '2026-07-10T12:00:00.000Z',
  durationSeconds: MINUTES * 60,
  coverageStatus: 'ready',
  coverageMessage: 'Replay Pulse ready',
  fullAnalyticsUrl: 'https://streampulse.stream/analytics',
  timeline: { bucketSeconds: 60, points },
  topMoments: [{ offsetSeconds: 210 * 60, label: 'Emote burst', reason: 'emote burst', score: 95, chatPerMin: 400, emotesPerMin: 1049 }],
  topEmotes: [{ name: 'Kappa', count: 100, imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/1.0', provider: 'twitch' }],
  games: [{ gameName: 'Just Chatting', offsetSeconds: 0, durationSeconds: MINUTES * 60 }],
}

/** Seeks the fixture's <video> the way Twitch does: the element moves, then fires its events. */
async function seekVideo(page: Page, seconds: number): Promise<void> {
  await page.evaluate(target => {
    const video = document.querySelector('video')!
    video.currentTime = target
    video.dispatchEvent(new Event('seeked'))
    video.dispatchEvent(new Event('timeupdate'))
  }, seconds)
}

/** How far (px) the resting emote line peaks below the hover/lock line's peak. */
async function restingEmotePeakGap(chart: Locator): Promise<number> {
  const peakY = (state: string) => chart
    .locator(`path[data-chart-series="emotes"][data-chart-path-state="${state}"]`)
    .evaluate(element => (element as SVGPathElement).getBBox().y)
  return (await peakY('overview')) - (await peakY('detail'))
}

test('a replay chart follows the VOD player and its emote line is readable', async ({ extension, prepare }) => {
  test.setTimeout(45_000)
  await prepare({ scenario: 'vod-ready', twitchKind: 'vod', storage: {
    overlayPlacement: 'sidebar', sidebarTab: 'pulse', overlayMode: 'expanded',
  } })
  await extension.context.route('https://api.streampulse.stream/v1/extension/pulse/vods/**', route => route.fulfill({ json: longVod }))

  const vod = await extension.context.newPage()
  await openTwitchVod(vod)
  await waitForPulseRoot(vod)
  const root = vod.locator('#streamclone-pulse-root')
  const chart = root.getByTestId('pulse-overview-chart')
  const readout = root.locator('[data-chart-readout="true"]')
  const playhead = root.locator('[data-chart-playhead="true"] line')
  await expect(chart).toHaveAttribute('data-chart-point-count', /\d+/)

  // The fixture player opens paused at 2:00, so the band reads that minute.
  await expect(readout).toHaveAttribute('data-chart-readout-state', 'paused')
  await expect(readout).toContainText('Paused')
  await expect(readout).toContainText('0:02:00')
  const startX = Number(await playhead.getAttribute('x1'))

  // Seeking near the end moves the line right and the readout with it.
  await seekVideo(vod, 21_000)
  await expect(readout).toContainText('5:50:00')
  await expect.poll(async () => Number(await playhead.getAttribute('x1'))).toBeGreaterThan(startX + 100)
  await expect(readout).toContainText('15,')

  // Hover wins while it lasts; leaving the plot hands the band back to the video.
  const plot = root.getByRole('application', { name: /^Chart plot/ })
  const box = (await plot.boundingBox())!
  await vod.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5)
  await expect(readout).toHaveAttribute('data-chart-readout-state', 'preview')
  await vod.mouse.move(box.x + box.width * 0.3, box.y - 120)
  await expect(readout).toHaveAttribute('data-chart-readout-state', 'paused')
  await expect(readout).toContainText('5:50:00')

  // In the replay's last minute the line stays, on the minute the band reads.
  await seekVideo(vod, MINUTES * 60 - 30)
  await expect(readout).toContainText('5:59:00')
  await expect(playhead).toHaveCount(1)
  // So in the first, though a long replay draws each few minutes at the busiest one.
  await seekVideo(vod, 30)
  await expect(readout).toContainText('0:00:00')
  await expect(playhead).toHaveCount(1)
  await seekVideo(vod, 21_000)

  // At rest the emote line is the hover/lock line: its one 1,049 burst still
  // reaches the top instead of being averaged down to a bump.
  expect(Math.abs(await restingEmotePeakGap(chart))).toBeLessThan(1)

  await test.info().attach('vod-playhead', { body: await root.locator('[data-chart-surface="true"]').screenshot(), contentType: 'image/png' })
})
