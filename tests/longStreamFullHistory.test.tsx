import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  describeRollupGap,
  findChartIndexByOffset,
  hasFullTimelineRollups,
  prepareChartRollups,
  rollupSeries,
} from '../src/ui/chatActivityEmotes.ts'
import { firstActiveRollupOffset, firstViewerOffsetSeconds } from '../src/ui/chartRollupUtils.ts'
import { panViewport, resolveViewport, viewportBuckets } from '../src/ui/chartViewport.ts'
import { EXTENSION_CHART_MAX_POINTS } from '../src/ui/extensionChartPoints.ts'
import { makeFullHistoryActivation } from '../src/shared/fullHistoryAuth.ts'
import { PulseOverviewChart } from '../src/ui/PulseOverviewChart.tsx'
import type { ExtensionRollup, PulsePayload } from '../src/shared/messages.ts'

/**
 * 33h live stream with complete, validated Full history (the Jynxzi report):
 * the backend's ?window=full returns every minute, 2031 one-minute rollups.
 * The client used to keep only the last 480 of them, so 76% of the Full chart
 * was missing buckets, a stream-start ramp was painted over that hole, and
 * bucket spacing produced a false "Missing chat data" notice.
 */
const MINUTES = 2031
const CURRENT_OFFSET_SECONDS = MINUTES * 60 + 30 // live: the open minute is not a rollup yet
const STRONGEST_MOMENT_SECONDS = 18 * 60 + 13

function longStreamPayload(): PulsePayload {
  const fullRollups: ExtensionRollup[] = Array.from({ length: MINUTES }, (_, minute) => {
    const chatCount = minute === 18 ? 900 : minute % 240 === 120 ? 500 : 60 + (minute * 37) % 50
    const totalEmoteCount = Math.round(chatCount / 2)
    return {
      offsetSeconds: minute * 60,
      chatCount,
      totalEmoteCount,
      sevenTvEmoteCount: Math.round(totalEmoteCount * 0.6),
      viewerCount: 11_000 + (minute * 13) % 400,
      viewerSamples: 1,
      finalized: true,
      topEmotes: [{ id: 'x1', name: 'OMEGALUL', provider: '7tv', count: Math.round(totalEmoteCount * 0.3) }],
    }
  })
  return {
    login: 'jynxzi',
    streamId: '111',
    startedAt: '2026-10-05T12:00:00.000Z',
    isLive: true,
    tracking: true,
    currentOffsetSeconds: CURRENT_OFFSET_SECONDS,
    durationSeconds: CURRENT_OFFSET_SECONDS,
    coverageStartOffsetSeconds: 0,
    coverage: {
      state: 'full_stream_tracked',
      coverageStartOffsetSeconds: 0,
      coverageEndOffsetSeconds: CURRENT_OFFSET_SECONDS,
      hasFullStreamCoverage: true,
      trackedFromStart: true,
      hasGaps: false,
      missingRanges: [],
      canBackfill: false,
      message: '',
    },
    rollups: fullRollups.slice(-60),
    fullRollups,
    lanes: { composite: [], chat: [], seventv: [] },
    peaks: [{ offsetSeconds: STRONGEST_MOMENT_SECONDS, score: 100 }],
    recap: null,
  }
}

function prepare(payload: PulsePayload, chartWindow: '60m' | 'full') {
  return prepareChartRollups(payload, {
    chartWindow,
    currentOffsetSeconds: CURRENT_OFFSET_SECONDS,
    coverageStartOffsetSeconds: 0,
    activation: makeFullHistoryActivation(payload),
  })
}

describe('long stream with validated Full history', () => {
  it('keeps every minute and charts Full with no missing buckets', () => {
    const payload = longStreamPayload()
    expect(hasFullTimelineRollups(payload, makeFullHistoryActivation(payload))).toBe(true)
    const source = rollupSeries(payload, 'full')
    expect(source).toHaveLength(MINUTES)
    expect(source[0]?.offsetSeconds).toBe(0)

    const full = prepare(payload, 'full')
    expect(full).toHaveLength(480)
    expect(full.filter(bucket => bucket.missing)).toHaveLength(0)
    // LiveStatsBand shows "Activity chart from X" only when the first active
    // bucket is more than 10 minutes past coverage start, and "Viewer data
    // from X" from the first viewer sample. Both start at 00:00 here.
    expect(firstActiveRollupOffset(full)).toBe(0)
    expect(firstViewerOffsetSeconds(full)).toBe(0)
  })

  it('does not report bucket spacing as missing chat data', () => {
    const full = prepare(longStreamPayload(), 'full')
    // Buckets alternate 4 and 5 minutes apart on a 33h stream.
    expect(full[5]!.offsetSeconds - full[4]!.offsetSeconds).toBeGreaterThan(120)
    expect(describeRollupGap(full, true)).toBeNull()
  })

  it('lets a 60m range pan back to 05:00 with real minute data', () => {
    const sixty = prepare(longStreamPayload(), '60m')
    const live = resolveViewport({
      durationSeconds: CURRENT_OFFSET_SECONDS,
      zoomSeconds: 3600,
      followEnd: true,
      currentViewport: { startSeconds: 0, endSeconds: CURRENT_OFFSET_SECONDS },
    })
    const viewport = panViewport(live, 5 * 3600 - live.startSeconds, CURRENT_OFFSET_SECONDS)
    expect(viewport).toEqual({ startSeconds: 5 * 3600, endSeconds: 6 * 3600 })
    const visible = viewportBuckets(sixty, viewport, EXTENSION_CHART_MAX_POINTS)
    expect(visible).toHaveLength(60)
    expect(visible[0]?.offsetSeconds).toBe(5 * 3600)
    expect(visible.every(minute => !minute.missing && (minute.chatCount ?? 0) > 0)).toBe(true)
  })

  it('lands a pin on the strongest moment at 00:18:13 in a real bucket', () => {
    const full = prepare(longStreamPayload(), 'full')
    const index = findChartIndexByOffset(
      full.map(bucket => bucket.offsetSeconds),
      STRONGEST_MOMENT_SECONDS,
      { bucketed: true },
    )
    expect(index).not.toBeNull()
    const bucket = full[index!]!
    expect(bucket.missing).toBeFalsy()
    expect(bucket.offsetSeconds).toBeLessThanOrEqual(STRONGEST_MOMENT_SECONDS)
    expect(full[index! + 1]!.offsetSeconds).toBeGreaterThan(STRONGEST_MOMENT_SECONDS)
    expect(bucket.chatCount).toBeGreaterThan(100)
    expect(bucket.viewerCount).toBeGreaterThan(0)
  })
})

describe('describeRollupGap', () => {
  const covered = (offsetSeconds: number): ExtensionRollup => ({ offsetSeconds, chatCount: 10 })
  const missing = (offsetSeconds: number): ExtensionRollup => ({ offsetSeconds, chatCount: 0, missing: true })

  it('reports a run of missing buckets between covered buckets', () => {
    expect(describeRollupGap([covered(0), covered(254), missing(508), missing(762), covered(1016)], true))
      .toBe('Missing chat data from 00:08:28 to 00:16:56')
  })

  it('leaves a missing opening to the coverage-start hint', () => {
    expect(describeRollupGap([missing(0), missing(60), missing(120), covered(180), covered(240)], true)).toBeNull()
  })

  it('reports backend missingRanges once Full densify flags them', () => {
    const rollups = [0, 60, 600, 660].map(covered)
    const payload: PulsePayload = {
      login: 'fixturechan',
      streamId: '7',
      isLive: true,
      tracking: true,
      currentOffsetSeconds: 660,
      coverageStartOffsetSeconds: 0,
      rollups,
      fullRollups: rollups,
      coverage: {
        state: 'missing_ranges_detected',
        coverageStartOffsetSeconds: 0,
        coverageEndOffsetSeconds: 660,
        hasFullStreamCoverage: false,
        trackedFromStart: true,
        hasGaps: true,
        missingRanges: [{ fromOffsetSeconds: 120, toOffsetSeconds: 600 }],
        canBackfill: true,
        message: 'Missing chat data from 00:02:00 to 00:10:00',
      },
      lanes: { composite: [], chat: [], seventv: [] },
      peaks: [],
      recap: null,
    }
    const full = prepareChartRollups(payload, {
      chartWindow: 'full',
      currentOffsetSeconds: 660,
      activation: makeFullHistoryActivation(payload),
    })
    expect(describeRollupGap(full, true)).toBe('Missing chat data from 00:02:00 to 00:10:00')
  })

  it('still reads spacing between raw minute rollups as a hole', () => {
    expect(describeRollupGap([0, 60, 240, 300].map(covered))).toBe('Missing chat data from 00:02:00 to 00:04:00')
    expect(describeRollupGap([0, 60, 120, 180].map(covered))).toBeNull()
  })
})

describe('overview chart over missing buckets', () => {
  function render(rollups: ExtensionRollup[]) {
    return renderToStaticMarkup(
      <PulseOverviewChart rollups={rollups} durationSeconds={rollups.length * 60} isLive />,
    )
  }

  function chatOverviewStartX(markup: string): number {
    const match = markup.match(/<path[^>]*d="M\s*([\d.]+)[^"]*"[^>]*data-chart-path-state="overview"[^>]*data-chart-series="chat"/)
    expect(match).not.toBeNull()
    return Number(match![1])
  }

  it('leaves a missing opening blank under a no-data band instead of ramping over it', () => {
    const rollups: ExtensionRollup[] = Array.from({ length: 60 }, (_, index) => index < 40
      ? { offsetSeconds: index * 60, chatCount: 0, sevenTvEmoteCount: 0, missing: true }
      : { offsetSeconds: index * 60, chatCount: 50 + index, sevenTvEmoteCount: 5, totalEmoteCount: 10 })
    const markup = render(rollups)
    expect(markup.match(/data-chart-no-data=""/g)).toHaveLength(40)
    // The first real bucket (index 40 of 60) sits about two thirds across the
    // plot; a stream-start ramp would start the line at the left padding.
    expect(chatOverviewStartX(markup)).toBeGreaterThan(150)
  })

  it('ends the trend lines where a missing tail of the stream begins', () => {
    // Tracking stopped about 2.8h before Now: the last 40 of 480 Full buckets
    // are missing, ten of the 120 drawn points.
    const rollups: ExtensionRollup[] = Array.from({ length: 480 }, (_, index) => index >= 440
      ? { offsetSeconds: index * 254, chatCount: 0, sevenTvEmoteCount: 0, missing: true }
      : { offsetSeconds: index * 254, chatCount: 60 + (index % 7), sevenTvEmoteCount: 5, totalEmoteCount: 12 })
    const markup = renderToStaticMarkup(<PulseOverviewChart rollups={rollups} durationSeconds={480 * 254} isLive />)
    const bands = [...markup.matchAll(/<rect x="([\d.]+)"[^>]*data-chart-no-data=""/g)].map(match => Number(match[1]))
    expect(bands).toHaveLength(10)
    const noDataStart = Math.min(...bands)
    for (const series of ['chat', 'emotes']) {
      for (const state of ['overview', 'detail']) {
        const d = markup.match(new RegExp(`<path[^>]*d="([^"]+)"[^>]*data-chart-path-state="${state}"[^>]*data-chart-series="${series}"`))?.[1]
        expect(d, `${series} ${state}`).toBeTruthy()
        const numbers = d!.match(/-?[\d.]+/g)!.map(Number)
        const xs = numbers.filter((_, index) => index % 2 === 0)
        expect(Math.max(...xs), `${series} ${state}`).toBeLessThan(noDataStart)
      }
    }
  })

  it('keeps the short stream-start ramp over real quiet buckets', () => {
    const rollups: ExtensionRollup[] = Array.from({ length: 60 }, (_, index) => ({
      offsetSeconds: index * 60,
      chatCount: index < 2 ? 0 : 50 + index,
      sevenTvEmoteCount: 5,
      totalEmoteCount: 10,
    }))
    const markup = render(rollups)
    expect(markup).not.toContain('data-chart-no-data')
    expect(chatOverviewStartX(markup)).toBeLessThan(10)
  })
})
