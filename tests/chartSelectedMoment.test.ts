import { describe, expect, it } from 'vitest'
import {
  chartPinPeakToleranceSeconds,
  inspectionHeatPointFromRollup,
  resolvePinnedChartSelection,
  resolvePinnedMomentPoint,
} from '../src/ui/chartSelectedMoment.ts'
import type { ExtensionRollup } from '../src/shared/messages.ts'

describe('resolvePinnedMomentPoint', () => {
  const heatPoints = [
    {
      minuteTs: '2026-01-01T00:02:00.000Z',
      offsetSeconds: 120,
      score: 80,
      estimated: false,
      reason: 'chat_spike' as const,
      reasonLabel: 'Chat spike',
      chatCount: 200,
      emoteCount: 55,
      topEmotes: [],
      collecting: false,
    },
  ]

  it('returns matching heat point when pin aligns with a peak', () => {
    const point = resolvePinnedMomentPoint({
      pinOffsetSeconds: 125,
      heatPoints,
    })
    expect(point?.offsetSeconds).toBe(120)
    expect(point?.reasonLabel).toBe('Chat spike')
  })

  it('does not synthesize a locally scored moment when pin is off-peak', () => {
    const point = resolvePinnedMomentPoint({
      pinOffsetSeconds: 60,
      heatPoints: [],
    })
    expect(point).toBeNull()
  })

  it('returns null when unpinned', () => {
    expect(
      resolvePinnedMomentPoint({
        pinOffsetSeconds: null,
        heatPoints,
      }),
    ).toBeNull()
  })

  it('honors wider tolerance for downsampled full-stream buckets', () => {
    const point = resolvePinnedMomentPoint({
      pinOffsetSeconds: 300,
      heatPoints,
      toleranceSeconds: chartPinPeakToleranceSeconds(240),
    })
    // 240 minutes → 2-min buckets → 120s tolerance; peak at 120 is 180s away → miss
    expect(point).toBeNull()

    const near = resolvePinnedMomentPoint({
      pinOffsetSeconds: 200,
      heatPoints,
      toleranceSeconds: chartPinPeakToleranceSeconds(240),
    })
    expect(near?.offsetSeconds).toBe(120)
  })
})

describe('resolvePinnedChartSelection', () => {
  const heatPoints = [
    {
      minuteTs: '2026-01-01T00:02:00.000Z',
      offsetSeconds: 120,
      score: 80,
      estimated: false,
      reason: 'chat_spike' as const,
      reasonLabel: 'Chat spike',
      chatCount: 200,
      emoteCount: 55,
      topEmotes: [],
      collecting: false,
    },
  ]

  const rollups: ExtensionRollup[] = [
    {
      offsetSeconds: 60,
      chatCount: 12,
      sevenTvEmoteCount: 3,
      totalEmoteCount: 4,
      viewerCount: 1_000,
      topEmotes: [{ name: 'KEKW', count: 3, provider: 'seventv', id: 'e1' }],
    },
    {
      offsetSeconds: 120,
      chatCount: 200,
      sevenTvEmoteCount: 40,
      totalEmoteCount: 55,
      viewerCount: 1_200,
    },
    {
      offsetSeconds: 600,
      chatCount: 18,
      sevenTvEmoteCount: 2,
      totalEmoteCount: 5,
      viewerCount: 900,
      topEmotes: [{ name: 'KEKW', count: 2, provider: 'seventv', id: 'e1' }],
    },
  ]

  it('prefers backend peak over rollup inspection', () => {
    const selection = resolvePinnedChartSelection({
      pinOffsetSeconds: 125,
      heatPoints,
      rollups,
      startedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(selection?.kind).toBe('peak')
    expect(selection?.point.reasonLabel).toBe('Chat spike')
    expect(selection?.point.estimated).toBe(false)
  })

  it('falls back to honest selected-minute inspection off-peak', () => {
    const selection = resolvePinnedChartSelection({
      pinOffsetSeconds: 600,
      heatPoints,
      rollups,
      startedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(selection?.kind).toBe('minute')
    expect(selection?.point.estimated).toBe(true)
    expect(selection?.point.reasonLabel).toBe('Selected minute')
    expect(selection?.point.chatCount).toBe(18)
    expect(selection?.point.emoteCount).toBe(5)
    expect(selection?.point.topEmotes[0]?.name).toBe('KEKW')
  })
})

describe('chartPinPeakToleranceSeconds', () => {
  it('stays at 90s when chart is 1:1 with minutes', () => {
    expect(chartPinPeakToleranceSeconds(90)).toBe(90)
    expect(chartPinPeakToleranceSeconds(120)).toBe(90)
  })

  it('grows with downsample bucket width', () => {
    expect(chartPinPeakToleranceSeconds(240)).toBe(120)
    expect(chartPinPeakToleranceSeconds(600)).toBe(300)
  })
})

describe('inspectionHeatPointFromRollup', () => {
  it('marks inspection as estimated manual selection', () => {
    const point = inspectionHeatPointFromRollup(
      { offsetSeconds: 2220, chatCount: 80, totalEmoteCount: 20, sevenTvEmoteCount: 10 },
      '2026-01-01T00:00:00.000Z',
    )
    expect(point.estimated).toBe(true)
    expect(point.score).toBe(0)
    expect(point.offsetSeconds).toBe(2220)
    expect(point.reason).toBe('manual')
  })
})
