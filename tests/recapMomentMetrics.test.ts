import { describe, expect, it } from 'vitest'
import {
  recapMomentToLiveHeatPoint,
  resolveRecapMomentMetrics,
  rollupAtOffset,
  rollupEmoteCount,
  viewerDeltaAtOffset,
} from '../src/ui/recapMomentMetrics.ts'

describe('recapMomentMetrics', () => {
  it('prefers backend moment metrics when present', () => {
    const metrics = resolveRecapMomentMetrics(
      {
        offsetSeconds: 120,
        score: 30,
        reasons: ['viewer_spike'],
        chatCount: 42,
        emoteCount: 15,
        viewerCount: 9000,
      },
      [],
    )
    expect(metrics).toEqual({ chatCount: 42, emoteCount: 15, viewerCount: 9000 })
  })

  it('falls back to rollup and peak data by offset', () => {
    const metrics = resolveRecapMomentMetrics(
      { offsetSeconds: 300, score: 34, reasons: ['viewer_spike'] },
      [
        { offsetSeconds: 240, chatCount: 10, sevenTvEmoteCount: 2 },
        { offsetSeconds: 300, chatCount: 88, sevenTvEmoteCount: 12, viewerCount: 53600 },
      ],
      [{ offsetSeconds: 300, score: 34, reasons: ['viewer_spike'], dominantSignal: 'viewers', chatCount: 99, emoteCount: 20 }],
    )
    expect(metrics.chatCount).toBe(99)
    expect(metrics.emoteCount).toBe(20)
    expect(metrics.viewerCount).toBe(53600)
  })

  it('merges rollup chat and emotes when moment only has viewerCount', () => {
    const metrics = resolveRecapMomentMetrics(
      { offsetSeconds: 2760, score: 54, reasons: ['viewer_spike'], viewerCount: 42000 },
      [{ offsetSeconds: 2760, chatCount: 412, sevenTvEmoteCount: 88, viewerCount: 42000 }],
    )
    expect(metrics.chatCount).toBe(412)
    expect(metrics.emoteCount).toBe(88)
    expect(metrics.viewerCount).toBe(42000)
  })

  it('computes viewer delta from prior rollup within two minutes', () => {
    const rollups = [
      { offsetSeconds: 2692, chatCount: 445, sevenTvEmoteCount: 352, viewerCount: 18419 },
      { offsetSeconds: 2752, viewerCount: 18825 },
    ]
    expect(viewerDeltaAtOffset(rollups, 2752)).toBe(406)
  })

  it('includes viewer delta on recap heat points', () => {
    const point = recapMomentToLiveHeatPoint(
      { offsetSeconds: 2760, score: 54, reasons: ['viewer_spike'], viewerCount: 18825 },
      [],
      undefined,
      [
        { offsetSeconds: 2692, viewerCount: 18419 },
        { offsetSeconds: 2760, viewerCount: 18825 },
      ],
    )
    expect(point.viewerCount).toBe(18825)
    expect(point.viewerDelta).toBe(406)
  })

  it('finds nearest rollup within one minute', () => {
    const rollup = rollupAtOffset(
      [{ offsetSeconds: 15840, chatCount: 55, sevenTvEmoteCount: 8, viewerCount: 12000 }],
      15838,
    )
    expect(rollup?.chatCount).toBe(55)
    expect(rollupEmoteCount(rollup)).toBe(8)
  })

  it('falls back to rollup topEmotes for viewer spike rows without moment emotes', () => {
    const point = recapMomentToLiveHeatPoint(
      { offsetSeconds: 300, score: 34, reasons: ['viewer_spike'] },
      [],
      undefined,
      [
        {
          offsetSeconds: 300,
          chatCount: 88,
          sevenTvEmoteCount: 12,
          topEmotes: [
            { name: 'KEKW', count: 42, provider: '7TV' },
            { name: 'LUL', count: 18, provider: '7TV' },
          ],
        },
      ],
    )
    expect(point.topEmotes).toHaveLength(2)
    expect(point.topEmotes[0]?.name).toBe('KEKW')
    expect(point.topEmotes[0]?.count).toBe(42)
  })
})
