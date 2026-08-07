import { describe, expect, it } from 'vitest'
import { buildLinearLine, decimateLinePoints } from '../src/lib/adaptiveChartGeometry'

describe('adaptive chart geometry', () => {
  it('renders full-resolution points as an M/L path', () => {
    expect(
      buildLinearLine([
        { x: 0, y: 10 },
        { x: 50, y: 40.5 },
        { x: 100, y: 20 },
      ]),
    ).toBe('M 0.00 10.00 L 50.00 40.50 L 100.00 20.00')
  })

  it('reduces the rest path while retaining endpoints and a strong local peak', () => {
    const points = Array.from({ length: 10 }, (_, index) => ({
      x: index,
      y: index === 4 ? 100 : 0,
    }))

    const reduced = decimateLinePoints(points, 5)

    expect(reduced.length).toBeLessThanOrEqual(5)
    expect(reduced[0]).toEqual(points[0])
    expect(reduced.at(-1)).toEqual(points.at(-1))
    expect(reduced).toContainEqual(points[4])
  })
})
