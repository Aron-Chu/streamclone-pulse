import { readFileSync } from 'node:fs'
import type { BrowserContext, Locator, Page, Route, TestInfo } from '@playwright/test'
import { test, expect } from '../helpers/testFixtures.ts'
import { PULSE_ROOT_ID, assertNoUncaughtErrors, waitForPulseRoot } from '../helpers/assertions.ts'
import { openTwitchChannel } from '../helpers/mockTwitch.ts'

/**
 * Codex audit (2026-10-07) rows for #70's long-stream charts, which it could
 * only check by eye on one archived stream:
 * - Full is drawn from 00:00 to the end, with no "Activity chart from" or
 *   "Viewer data from" header, live and on the offline recap (Past streams).
 * - A real gap is blank lines under dim bands, and "Missing chat data from …
 *   to …" appears for it and only for it.
 * - Every zoomed range (15m to 4h) shows the gap the same way.
 *
 * Payloads are built per test and served for both the channel route and the
 * worker's by-stream ?window=full request, so the chart sees one consistent
 * stream whichever request lands first.
 */

type Hole = readonly [fromOffsetSeconds: number, toOffsetSeconds: number]

const LONG_STREAM_SECONDS = 44_820 // 12h27m
const SIX_HOURS = 21_600

function readFixture(name: string) {
  return JSON.parse(readFileSync(new URL(`../fixtures/api/${name}`, import.meta.url), 'utf8'))
}

function minuteRollups(duration: number, hole?: Hole) {
  return Array.from({ length: Math.floor(duration / 60) }, (_, index) => ({
    offsetSeconds: index * 60,
    chatCount: 40 + (index * 7) % 23,
    totalEmoteCount: 12 + index % 5,
    sevenTvEmoteCount: 4,
    viewerCount: 900 + index % 50,
    viewerSamples: 1,
    finalized: true,
    topEmotes: [],
  })).filter(rollup => !hole || rollup.offsetSeconds < hole[0] || rollup.offsetSeconds >= hole[1])
}

function coverageFor(base: Record<string, unknown>, duration: number, hole?: Hole) {
  return {
    ...base,
    state: hole ? 'missing_ranges_detected' : 'full_stream_tracked',
    coverageStartOffsetSeconds: 0,
    coverageEndOffsetSeconds: duration,
    hasFullStreamCoverage: !hole,
    trackedFromStart: true,
    hasGaps: Boolean(hole),
    missingRanges: hole ? [{ fromOffsetSeconds: hole[0], toOffsetSeconds: hole[1] }] : [],
    canBackfill: false,
  }
}

function livePayload(duration: number, hole?: Hole) {
  const fixture = readFixture('pulse-live-ready.json')
  const rollups = minuteRollups(duration, hole)
  return {
    ...fixture,
    startedAt: new Date(Date.now() - duration * 1000).toISOString(),
    currentOffsetSeconds: duration,
    coverageStartOffsetSeconds: 0,
    rollups: rollups.slice(-60),
    fullRollups: rollups,
    peaks: [],
    games: [],
    coverage: coverageFor(fixture.coverage, duration, hole),
  }
}

/** The offline channel's last-stream recap: the "Past streams" chart. */
function recapPayload(duration: number, hole?: Hole) {
  const fixture = readFixture('pulse-offline.json')
  const rollups = minuteRollups(duration, hole)
  const startedAt = Date.parse(fixture.startedAt)
  return {
    ...fixture,
    endedAt: new Date(startedAt + duration * 1000).toISOString(),
    durationSeconds: duration,
    rollups: rollups.slice(-60),
    fullRollups: rollups,
    peaks: [],
    games: [],
    coverage: coverageFor(fixture.coverage, duration, hole),
    recap: { ...fixture.recap, durationSeconds: duration, topMoments: [] },
  }
}

async function servePulse(context: BrowserContext, payload: unknown): Promise<void> {
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

interface ChartGeometry {
  viewportStart: number
  viewportEnd: number
  bands: Array<{ x: number; width: number; opacity: number }>
  chat: string | null
  emotes: string | null
}

async function chartGeometry(chart: Locator): Promise<ChartGeometry> {
  return chart.evaluate(svg => {
    const path = (series: string) => svg.querySelector(`path[data-chart-path-state="overview"][data-chart-series="${series}"]`)?.getAttribute('d') ?? null
    return {
      viewportStart: Number(svg.getAttribute('data-chart-viewport-start')),
      viewportEnd: Number(svg.getAttribute('data-chart-viewport-end')),
      bands: Array.from(svg.querySelectorAll('rect[data-chart-no-data]')).map(rect => ({
        x: Number(rect.getAttribute('x')),
        width: Number(rect.getAttribute('width')),
        opacity: Number(rect.getAttribute('opacity') ?? 1),
      })),
      chat: path('chat'),
      emotes: path('emotes'),
    }
  })
}

const xsOf = (d: string): number[] => (d.match(/-?[\d.]+/g) ?? []).map(Number).filter((_, index) => index % 2 === 0)

/**
 * The gap is drawn: fully missing points carry the full no-data shade and no
 * chat or emote x lands inside them; with real data on both sides the chat
 * line breaks into two runs instead of joining across.
 */
function expectGapDrawn(geometry: ChartGeometry, label: string, dataOnBothSides: boolean): void {
  expect(geometry.bands.length, label).toBeGreaterThan(0)
  const solid = geometry.bands.filter(band => band.opacity >= 0.5)
  expect(solid.length, label).toBeGreaterThan(0)
  const from = Math.min(...solid.map(band => band.x))
  const to = Math.max(...solid.map(band => band.x + band.width))
  for (const d of [geometry.chat, geometry.emotes]) {
    expect(d, label).toBeTruthy()
    expect(xsOf(d!).some(x => x > from + 0.5 && x < to - 0.5), label).toBe(false)
  }
  if (dataOnBothSides) {
    expect(geometry.chat!.match(/M/g)?.length, label).toBeGreaterThanOrEqual(2)
    expect(xsOf(geometry.chat!).some(x => x <= from + 0.5), label).toBe(true)
    expect(xsOf(geometry.chat!).some(x => x >= to - 0.5), label).toBe(true)
  }
}

async function shadowText(page: Page): Promise<string> {
  return page.evaluate(id => document.getElementById(id)?.shadowRoot?.textContent ?? '', PULSE_ROOT_ID)
}

async function attachChart(info: TestInfo, chart: Locator, name: string, geometry?: ChartGeometry): Promise<void> {
  await info.attach(`${name}.png`, { body: await chart.screenshot(), contentType: 'image/png' })
  if (geometry) {
    await info.attach(`${name}.json`, {
      body: JSON.stringify({ ...geometry, chat: geometry.chat?.slice(0, 400), emotes: geometry.emotes?.slice(0, 400) }, null, 2),
      contentType: 'application/json',
    })
  }
}

async function openLive(page: Page) {
  await openTwitchChannel(page)
  await waitForPulseRoot(page)
  const root = page.locator(`#${PULSE_ROOT_ID}`)
  return { root, chart: root.locator('svg[data-testid="pulse-overview-chart"]').first() }
}

async function openRecap(page: Page) {
  await openTwitchChannel(page)
  await waitForPulseRoot(page)
  const root = page.locator(`#${PULSE_ROOT_ID}`)
  return { root, chart: root.locator('svg[data-testid="pulse-overview-chart"]').first() }
}

/**
 * The partial-history header the audit row forbids: "Activity chart from X"
 * at all, or "Viewer data from" any time but 00:00:00. A live panel with
 * viewer samples from the start still says "Viewer data from 00:00:00 ·
 * sampling now"; that is the full-history state, not the late-start header.
 */
async function expectNoPartialHistoryHeader(page: Page): Promise<void> {
  const text = await shadowText(page)
  expect(text).not.toContain('Activity chart from')
  for (const match of text.matchAll(/Viewer data(?: from)? (\d{2}:\d{2}:\d{2})/g)) expect(match[1]).toBe('00:00:00')
}

test.describe('long-stream charts (Codex audit #70)', () => {
  test('live 12h27m Full is drawn from 00:00 to the end with no partial-history header', async ({ extension, prepare, evidence }, info) => {
    await prepare({ scenario: 'live-ready', twitchKind: 'live' })
    await servePulse(extension.context, livePayload(LONG_STREAM_SECONDS))
    const { root, chart } = await openLive(extension.page)
    await expect(root.getByRole('combobox', { name: 'Chart time range' })).toContainText('Full stream')
    await expect(chart).toHaveAttribute('data-chart-viewport-start', '0')
    await expect.poll(async () => Number(await chart.getAttribute('data-chart-viewport-end'))).toBeGreaterThanOrEqual(LONG_STREAM_SECONDS - 60)
    expect(Number(await chart.getAttribute('data-chart-viewport-end'))).toBeLessThanOrEqual(LONG_STREAM_SECONDS + 60)
    const geometry = await chartGeometry(chart)
    // The chat line itself starts at the left edge: no blank opening, no bands.
    expect(geometry.bands).toHaveLength(0)
    expect(Math.min(...xsOf(geometry.chat!))).toBeLessThan(10)
    await expectNoPartialHistoryHeader(extension.page)
    expect(await shadowText(extension.page)).not.toContain('Missing chat data')
    await attachChart(info, chart, 'live-12h27m-full', geometry)
    assertNoUncaughtErrors(evidence)
  })

  test('recap (Past streams) 12h27m Full is drawn from 00:00 to the end with no partial-history header', async ({ extension, prepare, evidence }, info) => {
    await prepare({ scenario: 'offline', twitchKind: 'offline' })
    await servePulse(extension.context, recapPayload(LONG_STREAM_SECONDS))
    const { chart } = await openRecap(extension.page)
    await expect(chart).toBeVisible()
    await expect(chart).toHaveAttribute('data-chart-viewport-start', '0')
    await expect.poll(async () => Number(await chart.getAttribute('data-chart-viewport-end'))).toBeGreaterThanOrEqual(LONG_STREAM_SECONDS - 60)
    expect(Number(await chart.getAttribute('data-chart-viewport-end'))).toBeLessThanOrEqual(LONG_STREAM_SECONDS + 120)
    const geometry = await chartGeometry(chart)
    expect(geometry.bands).toHaveLength(0)
    expect(Math.min(...xsOf(geometry.chat!))).toBeLessThan(10)
    await expectNoPartialHistoryHeader(extension.page)
    expect(await shadowText(extension.page)).not.toContain('Missing chat data')
    await attachChart(info, chart, 'recap-12h27m-full', geometry)
    assertNoUncaughtErrors(evidence)
  })

  for (const surface of ['live', 'recap'] as const) {
    test(`${surface}: a real 03:00-03:30 gap is blank lines under dim bands with a truthful notice`, async ({ extension, prepare, evidence }, info) => {
      const hole: Hole = [3 * 3600, 3 * 3600 + 30 * 60]
      await prepare(surface === 'live' ? { scenario: 'live-ready', twitchKind: 'live' } : { scenario: 'offline', twitchKind: 'offline' })
      await servePulse(extension.context, surface === 'live' ? livePayload(SIX_HOURS, hole) : recapPayload(SIX_HOURS, hole))
      const { root, chart } = surface === 'live' ? await openLive(extension.page) : await openRecap(extension.page)
      await expect(chart).toBeVisible()
      await expect(root.getByText('Missing chat data from 03:00:00 to 03:30:00', { exact: true })).toBeVisible()
      await expect.poll(async () => (await chartGeometry(chart)).bands.length).toBeGreaterThan(0)
      const geometry = await chartGeometry(chart)
      expect(geometry.viewportStart).toBe(0)
      expectGapDrawn(geometry, `${surface} Full`, true)
      // The bands sit at the hole: 3h to 3.5h of a 6h axis is the middle half-twelfth.
      const plot = await chart.locator('[data-chart-scrubber="true"]').evaluate(rect => ({
        x: Number(rect.getAttribute('x')), width: Number(rect.getAttribute('width')),
      }))
      const solid = geometry.bands.filter(band => band.opacity >= 0.5)
      const from = (Math.min(...solid.map(band => band.x)) - plot.x) / plot.width
      const to = (Math.max(...solid.map(band => band.x + band.width)) - plot.x) / plot.width
      expect(from).toBeGreaterThan(0.5 - 0.02)
      expect(from).toBeLessThan(0.5 + 0.02)
      expect(to).toBeGreaterThan(7 / 12 - 0.02)
      expect(to).toBeLessThan(7 / 12 + 0.02)
      await expectNoPartialHistoryHeader(extension.page)
      await attachChart(info, chart, `${surface}-gap-03h00-03h30`, geometry)
      assertNoUncaughtErrors(evidence)
    })

    test(`${surface}: the same 6h stream with no gap shows no bands and no notice`, async ({ extension, prepare, evidence }, info) => {
      await prepare(surface === 'live' ? { scenario: 'live-ready', twitchKind: 'live' } : { scenario: 'offline', twitchKind: 'offline' })
      await servePulse(extension.context, surface === 'live' ? livePayload(SIX_HOURS) : recapPayload(SIX_HOURS))
      const { chart } = surface === 'live' ? await openLive(extension.page) : await openRecap(extension.page)
      await expect(chart).toBeVisible()
      await expect.poll(async () => Number(await chart.getAttribute('data-chart-viewport-end'))).toBeGreaterThanOrEqual(SIX_HOURS - 60)
      const geometry = await chartGeometry(chart)
      expect(geometry.bands).toHaveLength(0)
      expect(geometry.chat!.match(/M/g)).toHaveLength(1)
      expect(await shadowText(extension.page)).not.toContain('Missing chat data')
      await attachChart(info, chart, `${surface}-no-gap`, geometry)
      assertNoUncaughtErrors(evidence)
    })
  }

  test('live: every zoomed range from 15m to 4h shows a gap the same way', async ({ extension, prepare, evidence }, info) => {
    // A 10-minute hole 10 minutes before Now, so each range (which follows Now)
    // holds the hole: 15m sees real minutes only after it, the rest on both sides.
    const hole: Hole = [SIX_HOURS - 20 * 60, SIX_HOURS - 10 * 60]
    await prepare({ scenario: 'live-ready', twitchKind: 'live' })
    await servePulse(extension.context, livePayload(SIX_HOURS, hole))
    const { root, chart } = await openLive(extension.page)
    const range = root.getByRole('combobox', { name: 'Chart time range' })
    await expect(root.getByText('Missing chat data from 05:40:00 to 05:50:00', { exact: true })).toBeVisible()
    for (const [label, seconds] of [['15 min', 900], ['30 min', 1800], ['1 hour', 3600], ['2 hours', 7200], ['4 hours', 14_400], ['Full stream', SIX_HOURS]] as const) {
      await range.click()
      await root.getByRole('option', { name: label, exact: true }).click()
      await expect(range).toContainText(label)
      await expect.poll(async () => {
        const { viewportStart, viewportEnd } = await chartGeometry(chart)
        return viewportEnd - viewportStart
      }).toBeCloseTo(seconds, -1)
      const geometry = await chartGeometry(chart)
      expect(geometry.viewportStart, label).toBeLessThan(hole[1])
      expectGapDrawn(geometry, label, seconds > 900)
      if (seconds === 900) {
        // 15m starts at 05:45, inside the hole: the line starts after it.
        const solid = geometry.bands.filter(band => band.opacity >= 0.5)
        const to = Math.max(...solid.map(band => band.x + band.width))
        expect(Math.min(...xsOf(geometry.chat!)), label).toBeGreaterThanOrEqual(to - 0.5)
      }
      await attachChart(info, chart, `range-${seconds}s-gap`, geometry)
    }
    assertNoUncaughtErrors(evidence)
  })
})
