import { readFileSync } from 'node:fs'
import type { BrowserContext, Page, Route } from '@playwright/test'
import { test, expect } from '../helpers/testFixtures.ts'
import { assertNoUncaughtErrors, PULSE_ROOT_ID, waitForPulseRoot } from '../helpers/assertions.ts'
import { openTwitchChannel } from '../helpers/mockTwitch.ts'

/**
 * Zoom-aware bars (spec 2026-10-09 §3): the panel's chat and emote bars
 * average aligned minute slots whose length follows the zoom. A 12h27m live
 * Full stream at the 340px chat column draws 15-minute bars; wheel zoom (its
 * behaviour unchanged) re-buckets them to 5 and then 1 minute.
 */
const BARS_STREAM_SECONDS = 44_820

function barsLivePayload(hole?: readonly [number, number]) {
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/api/pulse-live-ready.json', import.meta.url), 'utf8'))
  const rollups = Array.from({ length: Math.floor(BARS_STREAM_SECONDS / 60) }, (_, index) => ({
    offsetSeconds: index * 60,
    // A quiet base with one spike per 15 minutes, so averaged bars carry peak caps.
    chatCount: index % 15 === 7 ? 400 : 40 + (index * 7) % 23,
    totalEmoteCount: 12 + index % 5,
    sevenTvEmoteCount: 4,
    viewerCount: 900 + index % 50,
    viewerSamples: 1,
    finalized: true,
    topEmotes: [],
  })).filter(rollup => !hole || rollup.offsetSeconds < hole[0] || rollup.offsetSeconds >= hole[1])
  return {
    ...fixture,
    startedAt: new Date(Date.now() - BARS_STREAM_SECONDS * 1000).toISOString(),
    currentOffsetSeconds: BARS_STREAM_SECONDS,
    coverageStartOffsetSeconds: 0,
    rollups: rollups.slice(-60),
    fullRollups: rollups,
    peaks: [],
    games: [],
    coverage: {
      ...fixture.coverage,
      state: hole ? 'missing_ranges_detected' : 'full_stream_tracked',
      coverageStartOffsetSeconds: 0,
      coverageEndOffsetSeconds: BARS_STREAM_SECONDS,
      hasFullStreamCoverage: !hole,
      trackedFromStart: true,
      hasGaps: Boolean(hole),
      missingRanges: hole ? [{ fromOffsetSeconds: hole[0], toOffsetSeconds: hole[1] }] : [],
      canBackfill: false,
    },
  }
}

async function serveBarsPulse(context: BrowserContext, payload: unknown): Promise<void> {
  const serve = async (route: Route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/fixturechan') || url.pathname.startsWith('/v1/extension/pulse/streams/')) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) })
    } else {
      await route.fallback()
    }
  }
  await context.route('https://api.streampulse.stream/v1/extension/pulse/channels/fixturechan*', serve)
  await context.route('https://api.streampulse.stream/v1/extension/pulse/streams/**', serve)
}

interface BarProbe {
  minutes: number
  viewportStart: number
  viewportEnd: number
  bars: Array<{ x: number; y: number; partial: boolean; highlight: string | null; opacity: number }>
  caps: number
  readout: string
  readoutBar: string | null
  readoutTime: string
  pageScrollY: number
}

async function probeBars(page: Page): Promise<BarProbe> {
  return page.evaluate(rootId => {
    const root = document.getElementById(rootId)?.shadowRoot
    const svg = root?.querySelector('svg[data-testid="pulse-overview-chart"]')
    const bars = Array.from(svg?.querySelectorAll('rect[data-chart-signal-bar="chat"]') ?? []).map(rect => {
      const box = rect.getBoundingClientRect()
      return {
        x: box.x + box.width / 2,
        y: box.y + box.height - 1,
        partial: rect.getAttribute('data-chart-bar-partial') === 'true',
        highlight: rect.getAttribute('data-chart-bar-highlight'),
        opacity: Number(rect.getAttribute('opacity') ?? 1),
      }
    })
    return {
      minutes: Number(svg?.getAttribute('data-chart-bar-minutes') ?? 0),
      viewportStart: Number(svg?.getAttribute('data-chart-viewport-start') ?? 0),
      viewportEnd: Number(svg?.getAttribute('data-chart-viewport-end') ?? 0),
      bars,
      caps: svg?.querySelectorAll('rect[data-chart-bar-peak]').length ?? 0,
      readout: root?.querySelector('[data-chart-readout="true"]')?.textContent ?? '',
      readoutBar: root?.querySelector('[data-chart-readout-bar]')?.getAttribute('data-chart-readout-bar') ?? null,
      readoutTime: root?.querySelector('[data-chart-readout="true"] .pulse-readout-time')?.textContent ?? '',
      pageScrollY: window.scrollY,
    }
  }, PULSE_ROOT_ID)
}

async function openBarsChart(page: Page) {
  await openTwitchChannel(page)
  await waitForPulseRoot(page)
  const chart = page.locator(`#${PULSE_ROOT_ID} svg[data-testid="pulse-overview-chart"]`).first()
  await expect.poll(async () => Number(await chart.getAttribute('data-chart-viewport-end'))).toBeGreaterThanOrEqual(BARS_STREAM_SECONDS - 60)
  await expect.poll(async () => (await probeBars(page)).minutes).toBe(15)
  return chart
}

test.describe('zoom-aware activity bars (12h27m Full at the chat column)', () => {
  test('Full averages 15-minute bars with peak caps and the hover readout names the bar', async ({ extension, prepare, evidence }, info) => {
    await prepare({ scenario: 'live-ready', twitchKind: 'live' })
    await serveBarsPulse(extension.context, barsLivePayload())
    const chart = await openBarsChart(extension.page)
    const full = await probeBars(extension.page)
    // 747 minutes in 15-minute slots aligned to the stream start.
    expect(full.bars).toHaveLength(50)
    expect(full.caps).toBeGreaterThan(40)
    expect(full.bars.some(bar => bar.partial)).toBe(false)

    await extension.page.mouse.move(full.bars[2]!.x, full.bars[2]!.y)
    await expect.poll(async () => (await probeBars(extension.page)).readoutBar).toBe('15')
    const hovered = await probeBars(extension.page)
    expect(hovered.readoutTime).toBe('00:30:00–00:45:00')
    expect(hovered.readout).toContain('15-min avg')
    expect(hovered.readout).toContain('pk 400')
    expect(hovered.bars.findIndex(bar => bar.highlight === 'hovered')).toBe(2)
    await info.attach('bars-12h-full-hover.png', { body: await chart.screenshot(), contentType: 'image/png' })
    assertNoUncaughtErrors(evidence)
  })

  test('wheel zoom re-buckets 15 to 5 to 1 minute, and 1-minute bars read the exact minute', async ({ extension, prepare, evidence }, info) => {
    await prepare({ scenario: 'live-ready', twitchKind: 'live' })
    await serveBarsPulse(extension.context, barsLivePayload())
    const chart = await openBarsChart(extension.page)
    const box = (await chart.boundingBox())!
    await extension.page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.8)
    const before = await probeBars(extension.page)
    const levels = [before.minutes]
    for (let notch = 0; notch < 12 && levels.at(-1) !== 1; notch += 1) {
      await extension.page.mouse.wheel(0, -100)
      await extension.page.waitForTimeout(250)
      const state = await probeBars(extension.page)
      // Each notch zooms in (the wheel behaviour itself is unchanged)...
      expect(state.viewportEnd - state.viewportStart).toBeLessThan(before.viewportEnd - before.viewportStart)
      // ...and never scrolls the page.
      expect(state.pageScrollY).toBe(before.pageScrollY)
      levels.push(state.minutes)
    }
    await info.attach('bar-levels.json', { body: JSON.stringify(levels), contentType: 'application/json' })
    expect(levels[0]).toBe(15)
    expect(levels).toContain(5)
    expect(levels.at(-1)).toBe(1)
    expect(levels.every((level, index) => index === 0 || level <= levels[index - 1]!)).toBe(true)

    const zoomed = await probeBars(extension.page)
    const target = zoomed.bars[Math.floor(zoomed.bars.length / 2)]!
    await extension.page.mouse.move(target.x, target.y)
    await expect.poll(async () => (await probeBars(extension.page)).readoutTime).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    const minute = await probeBars(extension.page)
    expect(minute.readoutBar).toBeNull()
    expect(minute.readout).not.toContain('avg')
    expect(minute.readout).not.toContain(' pk ')
    await info.attach('bars-1min-hover.png', { body: await chart.screenshot(), contentType: 'image/png' })
    assertNoUncaughtErrors(evidence)
  })

  test('a slot with unmeasured minutes is a faded partial bar and says how much was measured', async ({ extension, prepare, evidence }, info) => {
    // 03:05-03:12 is missing: the 03:00-03:15 slot measured 8 of its 15 minutes.
    const hole = [3 * 3600 + 5 * 60, 3 * 3600 + 12 * 60] as const
    await prepare({ scenario: 'live-ready', twitchKind: 'live' })
    await serveBarsPulse(extension.context, barsLivePayload(hole))
    const chart = await openBarsChart(extension.page)
    const full = await probeBars(extension.page)
    expect(full.bars.filter(bar => bar.partial)).toHaveLength(1)
    expect(full.bars[12]!.partial).toBe(true)
    expect(full.bars[12]!.opacity / full.bars[11]!.opacity).toBeCloseTo(8 / 15, 2)

    await extension.page.mouse.move(full.bars[12]!.x, full.bars[12]!.y)
    await expect.poll(async () => (await probeBars(extension.page)).readoutTime).toBe('03:00:00–03:15:00')
    expect((await probeBars(extension.page)).readout).toContain('15-min avg · 8/15 min')
    await info.attach('bars-partial-hover.png', { body: await chart.screenshot(), contentType: 'image/png' })
    assertNoUncaughtErrors(evidence)
  })
})
