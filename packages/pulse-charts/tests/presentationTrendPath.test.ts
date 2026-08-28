import { describe, expect, it } from 'vitest'
import {
  buildPresentationTrend,
  presentationTrendPathD,
} from '../src/presentationTrend.ts'

describe('presentationTrendPathD', () => {
  it('emits a monotone path per contiguous segment and never uses mid-index as identity', () => {
    const values = Array.from({ length: 40 }, (_, index) => 10 + (index % 5))
    const trend = buildPresentationTrend(values, { plotWidth: 300, mode: 'overview' })
    const path = presentationTrendPathD(trend, {
      xForIndex: (index) => index * 4,
      yForValue: (value) => 100 - value,
    })
    expect(path.startsWith('M')).toBe(true)
    expect(path).toContain('C')
    expect(trend.segments[0]?.points[0]?.valueKind).toBe('average')
  })

  it('keeps the LOD step and a drawable path when a live minute appends', () => {
    const base = Array.from({ length: 300 }, (_, index) => 20 + (index % 9))
    const first = buildPresentationTrend(base, { plotWidth: 400, mode: 'overview' })
    const second = buildPresentationTrend([...base, 44], {
      plotWidth: 400,
      mode: 'overview',
      previousTrend: first,
    })
    const secondPath = presentationTrendPathD(second, {
      xForIndex: (index) => index,
      yForValue: (value) => value,
    })
    expect(second.step).toBe(first.step)
    expect(secondPath.startsWith('M')).toBe(true)
  })
})
