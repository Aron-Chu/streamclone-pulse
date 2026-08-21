import { describe, expect, it } from 'vitest'

import { deriveChartGameSegments, gameSegmentPlotBounds } from '@streampulse/analytics-console/utils/gameSegmentChart'

describe('deriveChartGameSegments', () => {
  it('uses API segments when present', () => {
    const apiSegments = [
      {
        id: 1,
        streamId: 's1',
        gameName: 'VALORANT',
        categoryId: '516575',
        boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/516575-210x280.jpg',
        offsetSeconds: 0,
        durationSeconds: 1200,
        createdAt: new Date(0).toISOString(),
      },
    ]
    const got = deriveChartGameSegments('s1', { stream: { category: 'Fortnite' }, rollups: [] }, apiSegments)
    expect(got).toEqual(apiSegments)
    expect(got[0]).toMatchObject({
      categoryId: '516575',
      boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/516575-210x280.jpg',
    })
  })

  it('returns empty when category fallback is disabled for public portal', () => {
    const rollups = Array.from({ length: 10 }, (_, index) => ({
      minuteTs: new Date(Date.parse('2026-07-02T19:07:58Z') + index * 60_000).toISOString(),
    }))
    const got = deriveChartGameSegments(
      's1',
      { stream: { category: 'Fortnite' }, rollups },
      [],
      { allowCategoryFallback: false },
    )
    expect(got).toEqual([])
  })

  it('falls back to one category span when games API is empty and fallback allowed', () => {
    const rollups = Array.from({ length: 10 }, (_, index) => ({
      minuteTs: new Date(Date.parse('2026-07-02T19:07:58Z') + index * 60_000).toISOString(),
    }))
    const got = deriveChartGameSegments(
      's1',
      { stream: { category: 'Fortnite' }, rollups },
      [],
    )
    expect(got).toHaveLength(1)
    expect(got[0]?.gameName).toBe('Fortnite')
    expect(got[0]?.offsetSeconds).toBe(0)
    expect(got[0]?.source).toBe('category_fallback')
  })

  it('returns empty when category fallback is disabled', () => {
    const rollups = Array.from({ length: 10 }, (_, index) => ({
      minuteTs: new Date(Date.parse('2026-07-02T19:07:58Z') + index * 60_000).toISOString(),
    }))
    const got = deriveChartGameSegments(
      's1',
      { stream: { category: 'Fortnite' }, rollups },
      [],
      { allowCategoryFallback: false },
    )
    expect(got).toEqual([])
  })

  it('returns empty when category is missing', () => {
    expect(deriveChartGameSegments('s1', { stream: {}, rollups: [] }, [])).toEqual([])
  })
})

describe('gameSegmentPlotBounds', () => {
  const rollups = Array.from({ length: 550 }, (_, index) => ({
    minuteTs: new Date(Date.parse('2026-07-02T19:07:58Z') + index * 60_000).toISOString(),
  }))

  it('maps absolute stream offsets onto downsampled chart window', () => {
    const first = gameSegmentPlotBounds(
      { offsetSeconds: 0, durationSeconds: 12645 },
      rollups,
      '2026-07-02T19:07:58Z',
      90,
      876,
    )
    const second = gameSegmentPlotBounds(
      { offsetSeconds: 12645, durationSeconds: 10859 },
      rollups,
      '2026-07-02T19:07:58Z',
      90,
      876,
    )
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(first!.endX).toBeLessThanOrEqual(second!.startX + 1)
    expect(first!.textWidth).toBeGreaterThan(30)
    expect(second!.textWidth).toBeGreaterThan(30)
  })

  it('returns null when segment ends before visible chart window', () => {
    const bounds = gameSegmentPlotBounds(
      { offsetSeconds: 0, durationSeconds: 60 },
      rollups,
      '2026-07-02T12:00:00Z',
      90,
      876,
    )
    expect(bounds).toBeNull()
  })
})
