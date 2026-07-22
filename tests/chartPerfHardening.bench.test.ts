import { describe, expect, it } from 'vitest'
import {
  buildEmoteCountIndex,
  buildEmoteOverlaySeries,
  buildSelectedEmoteSeries,
  emoteCountAtRollup,
  emoteSelectionKey,
  prepareChartRollups,
} from '../src/ui/chatActivityEmotes.ts'
import type { ExtensionEmote, ExtensionRollup, PulsePayload } from '../src/shared/messages.ts'

function makeRollups(minutes: number, emoteCount: number): ExtensionRollup[] {
  const emotes: ExtensionEmote[] = Array.from({ length: emoteCount }, (_, i) => ({
    id: `e${i}`,
    name: `Emote${i}`,
    provider: 'seventv',
    count: 1 + (i % 5),
  }))
  return Array.from({ length: minutes }, (_, minute) => ({
    offsetSeconds: minute * 60,
    chatCount: 10 + (minute % 7),
    sevenTvEmoteCount: 3 + (minute % 4),
    totalEmoteCount: 5 + (minute % 6),
    viewerCount: 1000 + minute,
    topEmotes: emotes.map((emote, i) => ({
      ...emote,
      count: ((minute + i) % 9) + 1,
    })),
  }))
}

function basePayload(rollups: ExtensionRollup[]): PulsePayload {
  return {
    login: 'bench',
    isLive: true,
    tracking: true,
    currentOffsetSeconds: (rollups.length - 1) * 60,
    rollups: rollups.slice(-60),
    fullRollups: rollups,
    lanes: { composite: [], chat: [], seventv: [] },
    recap: null,
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

function timeMs(fn: () => void, iterations: number): number {
  const samples: number[] = []
  // Warmup
  for (let i = 0; i < 3; i += 1) fn()
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now()
    fn()
    samples.push(performance.now() - start)
  }
  return median(samples)
}

describe('chart performance hardening benchmarks', () => {
  it('indexed emote series preserves output and reports steady-state timing', () => {
    const rollups = makeRollups(480, 12)
    const selected = rollups[0]!.topEmotes!.slice(0, 6)

    const index = buildEmoteCountIndex(rollups)
    for (const emote of selected) {
      const expected = rollups.map(rollup => emoteCountAtRollup(rollup, emote))
      expect(index.get(emoteSelectionKey(emote))).toEqual(expected)
    }

    const naiveMs = timeMs(() => {
      for (const emote of selected) {
        for (const rollup of rollups) {
          emoteCountAtRollup(rollup, emote)
        }
      }
    }, 25)

    const indexedBuildMs = timeMs(() => {
      buildEmoteCountIndex(rollups)
    }, 25)

    const indexedMs = timeMs(() => {
      for (const emote of selected) {
        const key = emoteSelectionKey(emote)
        const series = index.get(key)
        expect(series?.length).toBe(rollups.length)
      }
    }, 25)

    // Also exercise production helpers that should use the index.
    const overlayMs = timeMs(() => {
      buildEmoteOverlaySeries(rollups.slice(-120), selected, rollups)
      for (const emote of selected) {
        buildSelectedEmoteSeries(rollups, emote)
      }
    }, 15)

    const prepareColdMs = timeMs(() => {
      const payload = basePayload(rollups)
      prepareChartRollups(payload, {
        chartWindow: 'full',
        currentOffsetSeconds: (rollups.length - 1) * 60,
      })
    }, 12)

    const cachedPayload = basePayload(rollups)
    prepareChartRollups(cachedPayload, {
      chartWindow: 'full',
      currentOffsetSeconds: (rollups.length - 1) * 60,
    })
    const prepareCachedMs = timeMs(() => {
      prepareChartRollups(cachedPayload, {
        chartWindow: 'full',
        currentOffsetSeconds: (rollups.length - 1) * 60,
      })
    }, 40)

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        benchmark: 'chart-perf-hardening',
        naiveScanMedianMs: Number(naiveMs.toFixed(3)),
         indexedBuildMedianMs: Number(indexedBuildMs.toFixed(3)),
        overlayHelpersMedianMs: Number(overlayMs.toFixed(3)),
        prepareChartRollupsColdMedianMs: Number(prepareColdMs.toFixed(3)),
        prepareChartRollupsCachedMedianMs: Number(prepareCachedMs.toFixed(3)),
        prepareCacheSpeedup: Number((prepareColdMs / Math.max(prepareCachedMs, 0.001)).toFixed(2)),
        speedupVsNaive: Number((naiveMs / Math.max(indexedMs, 0.001)).toFixed(2)),
      }),
    )

    expect(indexedMs).toBeLessThan(naiveMs)
    expect(prepareCachedMs).toBeLessThan(prepareColdMs)
  })
})
