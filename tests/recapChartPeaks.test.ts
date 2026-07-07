import { describe, expect, it } from 'vitest'
import { resolveRecapChartPeakOffsets } from '../src/ui/recapChartPeaks.ts'

describe('resolveRecapChartPeakOffsets', () => {
  it('prefers recap topMoments offsets sorted by score', () => {
    const offsets = resolveRecapChartPeakOffsets(
      [
        { offsetSeconds: 120, score: 80, reasons: ['chat_spike'] },
        { offsetSeconds: 300, score: 95, reasons: ['emote_spike'] },
        { offsetSeconds: 60, score: 70, reasons: ['chat_spike'] },
      ],
      [{ offsetSeconds: 999, score: 50, reasons: ['manual'], dominantSignal: 'chat' }],
    )
    expect(offsets).toEqual([300, 120, 60])
  })

  it('falls back to payload peaks when recap moments are empty', () => {
    const offsets = resolveRecapChartPeakOffsets(
      [],
      [
        { offsetSeconds: 400, score: 60, reasons: ['chat_spike'], dominantSignal: 'chat' },
        { offsetSeconds: 200, score: 90, reasons: ['emote_spike'], dominantSignal: 'emote' },
      ],
    )
    expect(offsets).toEqual([200, 400])
  })

  it('respects the limit parameter', () => {
    const offsets = resolveRecapChartPeakOffsets(
      [
        { offsetSeconds: 1, score: 99, reasons: ['chat_spike'] },
        { offsetSeconds: 2, score: 98, reasons: ['chat_spike'] },
        { offsetSeconds: 3, score: 97, reasons: ['chat_spike'] },
      ],
      undefined,
      2,
    )
    expect(offsets).toEqual([1, 2])
  })
})

describe('mergeRecapMoments', () => {
  it('merges recap moments and peaks with dedupe by offset', async () => {
    const { mergeRecapMoments } = await import('../src/ui/recapChartPeaks.ts')
    const merged = mergeRecapMoments(
      {
        topMoments: [
          { offsetSeconds: 120, score: 80, reasons: ['chat_spike'] },
          { offsetSeconds: 300, score: 95, reasons: ['emote_spike'] },
        ],
        clipCandidates: [{ offsetSeconds: 600, score: 70, reasons: ['manual'] }],
      },
      [{ offsetSeconds: 122, score: 99, reasons: ['chat_spike'], dominantSignal: 'chat' }],
      20,
    )
    expect(merged).toHaveLength(3)
    expect(merged[0]?.offsetSeconds).toBe(122)
    expect(merged[0]?.score).toBe(99)
  })

  it('caps merged moments at the limit', async () => {
    const { mergeRecapMoments } = await import('../src/ui/recapChartPeaks.ts')
    const merged = mergeRecapMoments(
      {
        topMoments: Array.from({ length: 15 }, (_, index) => ({
          offsetSeconds: index * 120,
          score: 100 - index,
          reasons: ['chat_spike'],
          chatCount: 100,
        })),
      },
      Array.from({ length: 15 }, (_, index) => ({
        offsetSeconds: 10_000 + index * 120,
        score: 50 - index,
        reasons: ['chat_spike'],
        dominantSignal: 'chat' as const,
        chatCount: 50,
      })),
      20,
      [{ offsetSeconds: 0, chatCount: 10, sevenTvEmoteCount: 1 }],
    )
    expect(merged).toHaveLength(20)
  })

  it('deprioritizes viewer-only moments when reaction rollups exist', async () => {
    const { mergeRecapMoments } = await import('../src/ui/recapChartPeaks.ts')
    const merged = mergeRecapMoments(
      {
        topMoments: [
          { offsetSeconds: 2760, score: 54, reasons: ['viewer_spike'], viewerCount: 18825 },
          { offsetSeconds: 6840, score: 42, reasons: ['seventv_spike'], chatCount: 680, emoteCount: 692 },
        ],
      },
      [],
      20,
      [{ offsetSeconds: 6840, chatCount: 680, sevenTvEmoteCount: 692 }],
    )
    expect(merged[0]?.offsetSeconds).toBe(6840)
    expect(merged[1]?.offsetSeconds).toBe(2760)
  })
})

describe('resolveRecapSelectionFromOffset', () => {
  it('selects nearest recap moment within tolerance', async () => {
    const { resolveRecapSelectionFromOffset } = await import('../src/ui/recapChartPeaks.ts')
    const resolved = resolveRecapSelectionFromOffset({
      streamId: 'stream-1',
      offsetSeconds: 305,
      moments: [
        { offsetSeconds: 300, score: 95, reasons: ['emote_spike'] },
        { offsetSeconds: 120, score: 80, reasons: ['chat_spike'] },
      ],
      rollups: [{ offsetSeconds: 300, chatCount: 40, sevenTvEmoteCount: 12 }],
      startedAt: '2026-01-01T00:00:00.000Z',
      catalog: [],
    })
    expect(resolved.selectedKey).toBe('stream-1:300:95')
    expect(resolved.overridePoint).toBeNull()
  })

  it('creates synthetic point when no moment is within tolerance', async () => {
    const { resolveRecapSelectionFromOffset } = await import('../src/ui/recapChartPeaks.ts')
    const resolved = resolveRecapSelectionFromOffset({
      streamId: 'stream-1',
      offsetSeconds: 900,
      moments: [{ offsetSeconds: 120, score: 80, reasons: ['chat_spike'] }],
      rollups: [{ offsetSeconds: 900, chatCount: 55, sevenTvEmoteCount: 3 }],
      startedAt: '2026-01-01T00:00:00.000Z',
      catalog: [],
    })
    expect(resolved.selectedKey).toBe('stream-1:900:55')
    expect(resolved.overridePoint?.offsetSeconds).toBe(900)
  })
})

describe('resolveRecapPointFromRollup', () => {
  const moments = [{ offsetSeconds: 13_800, score: 504, reasons: ['emote_spike'] }]

  it('uses clicked rollup offset when nearest moment is outside tolerance', async () => {
    const { resolveRecapPointFromRollup } = await import('../src/ui/recapChartPeaks.ts')
    const point = resolveRecapPointFromRollup({
      rollup: { offsetSeconds: 18_000, chatCount: 620, sevenTvEmoteCount: 400 },
      moments,
      catalog: [],
      startedAt: '2026-01-01T00:00:00.000Z',
      rollups: [{ offsetSeconds: 18_000, chatCount: 620, sevenTvEmoteCount: 400 }],
    })
    expect(point.offsetSeconds).toBe(18_000)
    expect(point.chatCount).toBe(620)
  })

  it('snaps to nearest moment when within tolerance', async () => {
    const { resolveRecapPointFromRollup } = await import('../src/ui/recapChartPeaks.ts')
    const point = resolveRecapPointFromRollup({
      rollup: { offsetSeconds: 13_830, chatCount: 502, sevenTvEmoteCount: 707 },
      moments,
      catalog: [],
      startedAt: '2026-01-01T00:00:00.000Z',
      rollups: [{ offsetSeconds: 13_830, chatCount: 502, sevenTvEmoteCount: 707 }],
      peaks: [{ offsetSeconds: 13_800, score: 504, reasons: ['emote_spike'], dominantSignal: 'emote', emoteCount: 504 }],
    })
    expect(point.offsetSeconds).toBe(13_800)
  })
})

describe('recap highlight heat points', () => {
  it('maps biggest chat spike metadata into selected moment counts', async () => {
    const { recapChatSpikeToHeatPoint } = await import('../src/ui/recapChartPeaks.ts')
    const point = recapChatSpikeToHeatPoint(
      { offsetSeconds: 4500, chatPerMin: 854 },
      [],
      '2026-01-01T00:00:00.000Z',
      [{ offsetSeconds: 4500, chatCount: 854, sevenTvEmoteCount: 12 }],
    )
    expect(point.chatCount).toBe(854)
    expect(point.offsetSeconds).toBe(4500)
    expect(point.reasonLabel).toMatch(/chat/i)
  })

  it('maps top emote burst metadata into selected moment counts and emotes', async () => {
    const { recapEmoteBurstToHeatPoint } = await import('../src/ui/recapChartPeaks.ts')
    const point = recapEmoteBurstToHeatPoint(
      { offsetSeconds: 13_800, code: 'KEKW', count: 504 },
      [{ name: 'KEKW', count: 504, provider: '7TV' }],
      '2026-01-01T00:00:00.000Z',
      [{ offsetSeconds: 13_800, chatCount: 40, sevenTvEmoteCount: 504, topEmotes: [{ name: 'KEKW', count: 504 }] }],
    )
    expect(point.emoteCount).toBe(504)
    expect(point.topEmotes[0]?.name).toBe('KEKW')
    expect(point.topEmotes[0]?.count).toBe(504)
  })
})

describe('recapStreamDurationSeconds', () => {
  it('prefers recap duration over recent rollup window', async () => {
    const { recapStreamDurationSeconds } = await import('../src/ui/recapChartPeaks.ts')
    const seconds = recapStreamDurationSeconds({
      login: 'xqc',
      isLive: false,
      tracking: false,
      currentOffsetSeconds: 600,
      rollups: [{ offsetSeconds: 600, chatCount: 10, sevenTvEmoteCount: 1 }],
      lanes: { composite: [], chat: [], seventv: [] },
      peaks: [],
      recap: {
        streamId: '1',
        login: 'xqc',
        durationSeconds: 45_720,
        totalMessages: 100,
        peakChatPerMin: 40,
        topMoments: [],
        topEmotes: [],
        clipCandidates: [],
      },
    })
    expect(seconds).toBe(45_720)
  })
})
