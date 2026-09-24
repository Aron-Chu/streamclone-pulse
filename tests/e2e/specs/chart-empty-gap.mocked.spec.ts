import { readFileSync } from 'node:fs'
import { test, expect } from '../helpers/testFixtures.ts'
import { PULSE_ROOT_ID, assertNoUncaughtErrors, waitForPulseRoot } from '../helpers/assertions.ts'
import { openTwitchChannel } from '../helpers/mockTwitch.ts'

test('empty timestamp gaps neither create nor move a chart pin', async ({
  extension, prepare, evidence,
}, info) => {
  await prepare()
  const fixture = JSON.parse(readFileSync(
    new URL('../fixtures/api/pulse-live-ready.json', import.meta.url), 'utf8',
  ))
  const duration = 660
  const rollups = [0, 60, 600, 660].map(offsetSeconds => ({
    offsetSeconds,
    chatCount: 40,
    totalEmoteCount: 12,
    sevenTvEmoteCount: 4,
    viewerCount: 800,
    viewerSamples: 1,
    topEmotes: [],
  }))
  const payload = {
    ...fixture,
    startedAt: new Date(Date.now() - duration * 1000).toISOString(),
    currentOffsetSeconds: duration,
    coverageStartOffsetSeconds: 0,
    rollups,
    fullRollups: rollups,
    peaks: [],
    games: [],
    coverage: {
      ...fixture.coverage,
      state: 'missing_ranges_detected',
      hasFullStreamCoverage: false,
      hasGaps: true,
      coverageStartOffsetSeconds: 0,
      coverageEndOffsetSeconds: duration,
      missingRanges: [{ fromOffsetSeconds: 120, toOffsetSeconds: 600 }],
      message: 'Missing chat data from 00:02:00 to 00:10:00',
    },
  }
  await extension.context.route(
    'https://api.streampulse.stream/v1/extension/pulse/channels/fixturechan*',
    async route => {
      if (new URL(route.request().url()).pathname.endsWith('/fixturechan')) {
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) })
      } else {
        await route.fallback()
      }
    },
  )
  await openTwitchChannel(extension.page)
  await waitForPulseRoot(extension.page)
  const chart = extension.page.locator(`#${PULSE_ROOT_ID} svg[data-testid="pulse-overview-chart"]`)
  const plot = chart.locator('[data-chart-scrubber="true"]')
  await expect(plot).toBeVisible()
  await expect(chart).toHaveAttribute('data-chart-viewer-lane', 'true')
  const box = (await plot.boundingBox())!
  const viewerY = box.height * 0.1
  const activityY = box.height * 0.7
  const gapX = box.width * 0.5

  await plot.click({ position: { x: gapX, y: viewerY } })
  await expect(chart).not.toHaveAttribute('data-chart-locked-index')
  await expect(chart).not.toHaveAttribute('data-chart-hover-index')

  await plot.click({ position: { x: gapX, y: activityY } })
  await expect(chart).not.toHaveAttribute('data-chart-locked-index')
  await expect(chart).not.toHaveAttribute('data-chart-hover-index')

  await plot.click({ position: { x: 1, y: viewerY } })
  await expect(chart).toHaveAttribute('data-chart-active-offset', '0')
  await expect(chart).toHaveAttribute('data-chart-locked-index', /\d+/)
  const pinnedIndex = await chart.getAttribute('data-chart-locked-index')

  for (const y of [viewerY, activityY]) {
    await plot.click({ position: { x: gapX, y } })
    await expect(chart).toHaveAttribute('data-chart-locked-index', pinnedIndex!)
    await expect(chart).toHaveAttribute('data-chart-active-offset', '0')
    await expect(chart).not.toHaveAttribute('data-chart-hover-index')
  }

  await plot.click({ position: { x: box.width - 1, y: viewerY } })
  await expect(chart).toHaveAttribute('data-chart-active-offset', '660')
  await extension.page.keyboard.press('Escape')
  await expect(chart).not.toHaveAttribute('data-chart-locked-index')
  await chart.screenshot({ path: info.outputPath('empty-gap-chart.png') })
  assertNoUncaughtErrors(evidence)
})
