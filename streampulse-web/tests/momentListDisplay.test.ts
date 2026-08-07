import { describe, expect, it } from 'vitest'

import {
  collapseListSlice,
  collapsedVisibleCount,
  enrichRecapMomentsFromHeatmap,
  momentRankAccent,
  momentReasonChipTone,
  momentScoreTone,
  MOMENTS_INITIAL_VISIBLE,
  MOMENTS_MAX_VISIBLE,
} from '@streampulse/analytics-console/utils/momentListDisplay'
import type { ReplayHeatmapPoint } from '@streampulse/analytics-console/types/heatmap'

function heatmapPoint(minuteTs: string, score: number, reason: string): ReplayHeatmapPoint {
  return {
    offsetSeconds: 0,
    durationSeconds: 60,
    score,
    confidence: 1,
    reason,
    topEmotes: [],
    vodId: null,
    streamId: 'stream-1',
    minuteTs,
  }
}

describe('momentScoreTone', () => {
  it('maps score tiers to emerald, cyan, and amber', () => {
    expect(momentScoreTone(85).text).toContain('emerald')
    expect(momentScoreTone(65).text).toContain('cyan')
    expect(momentScoreTone(40).text).toContain('amber')
  })
})

describe('momentRankAccent', () => {
  it('gives distinct accents for top three ranks', () => {
    expect(momentRankAccent(0).badge).toContain('amber')
    expect(momentRankAccent(1).badge).toContain('violet')
    expect(momentRankAccent(2).badge).toContain('cyan')
    expect(momentRankAccent(4).badge).toContain('zinc')
  })
})

describe('momentReasonChipTone', () => {
  it('colors chat and emote spike reasons differently', () => {
    expect(momentReasonChipTone('chat_spike').chip).toContain('cyan')
    expect(momentReasonChipTone('twitch_emote_spike').chip).toContain('emerald')
    expect(momentReasonChipTone('viewer_spike').chip).toContain('violet')
  })
})

describe('collapseListSlice', () => {
  const items = Array.from({ length: 25 }, (_, index) => index + 1)

  it('shows initial count when collapsed', () => {
    expect(collapseListSlice(items, false, 5, MOMENTS_MAX_VISIBLE)).toEqual([1, 2, 3, 4, 5])
    expect(collapsedVisibleCount(items.length, false, 5, MOMENTS_MAX_VISIBLE)).toBe(5)
  })

  it('shows up to max when expanded', () => {
    expect(collapseListSlice(items, true, 5, MOMENTS_MAX_VISIBLE)).toHaveLength(MOMENTS_MAX_VISIBLE)
    expect(collapsedVisibleCount(items.length, true, 5, MOMENTS_MAX_VISIBLE)).toBe(MOMENTS_MAX_VISIBLE)
  })
})

describe('enrichRecapMomentsFromHeatmap', () => {
  it('backfills heatmap candidates when recap list is sparse', () => {
    const enriched = enrichRecapMomentsFromHeatmap(
      [{ offsetSeconds: 120, score: 70, reasons: ['chat_spike'] }],
      [
        heatmapPoint('2026-07-07T12:10:00.000Z', 88, 'twitch_emote_spike'),
        heatmapPoint('2026-07-07T12:15:00.000Z', 75, 'chat_spike'),
      ],
      '2026-07-07T12:00:00.000Z',
      undefined,
      MOMENTS_MAX_VISIBLE,
      MOMENTS_INITIAL_VISIBLE,
    )

    expect(enriched.length).toBeGreaterThan(1)
    expect(enriched[0]?.score).toBeGreaterThanOrEqual(enriched[1]?.score ?? 0)
  })

  it('skips backfill when recap already has enough moments', () => {
    const recap = Array.from({ length: 6 }, (_, index) => ({
      offsetSeconds: index * 120,
      score: 90 - index,
      reasons: ['chat_spike'],
    }))
    const enriched = enrichRecapMomentsFromHeatmap(
      recap,
      [heatmapPoint('2026-07-07T12:30:00.000Z', 99, 'chat_spike')],
      '2026-07-07T12:00:00.000Z',
      undefined,
      MOMENTS_MAX_VISIBLE,
      MOMENTS_INITIAL_VISIBLE,
    )
    expect(enriched).toHaveLength(6)
  })
})
