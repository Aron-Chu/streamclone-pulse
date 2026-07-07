import { describe, expect, it } from 'vitest'
import {
  classifyCurrentMoment,
  findNearestMomentWithin,
  findNearestTimelineBucket,
  normalizeTimelineValues,
  seekOffsetFromGraphClick,
} from '../src/vod/vodCurrentMoment.ts'

describe('vodCurrentMoment', () => {
  const points = [
    { offsetSeconds: 0, chatPerMin: 10, score: 5 },
    { offsetSeconds: 60, chatPerMin: 500, score: 80, emotesPerMin: 120 },
    { offsetSeconds: 120, chatPerMin: 30, score: 10 },
  ]

  it('finds nearest timeline bucket', () => {
    expect(findNearestTimelineBucket(points, 58)?.offsetSeconds).toBe(60)
  })

  it('finds nearest moment within window', () => {
    const moments = [{ offsetSeconds: 300, label: 'Viewer spike', score: 40 }]
    expect(findNearestMomentWithin(moments, 330, 60)?.offsetSeconds).toBe(300)
  })

  it('classifies at peak when near top moment', () => {
    const insight = classifyCurrentMoment(points[1], { offsetSeconds: 62, label: 'Viewer spike' }, 62)
    expect(insight.label).toBe('At peak')
  })

  it('classifies chat surge from bucket', () => {
    const insight = classifyCurrentMoment(points[1], null, 60)
    expect(insight.label).toBe('At peak')
  })

  it('normalizes timeline without divide-by-zero', () => {
    expect(normalizeTimelineValues([{ offsetSeconds: 0 }, { offsetSeconds: 60 }])).toEqual([0, 0])
  })

  it('maps graph click to seek offset', () => {
    const rect = { left: 0, width: 100 } as DOMRect
    expect(seekOffsetFromGraphClick(50, rect, 200)).toBe(100)
  })
})
