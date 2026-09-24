import { describe, expect, it } from 'vitest'
import {
  buildViewerGeometry,
  buildViewerTimestampScale,
  projectValuesToTimestamps,
  viewerDetailPointBudget,
  viewerIdlePointBudget,
} from '../src/viewerGeometry.ts'

const geometryOptions = {
  width: 1000,
  padLeft: 90,
  padRight: 34,
  bandTop: 34,
  bandBottom: 320,
  plotCssWidth: 876,
  valueToY: (value: number) => 320 - value,
}

function minute(index: number): string {
  return new Date(Date.parse('2026-07-31T00:00:00.000Z') + index * 60_000).toISOString()
}

function second(offset: number): string {
  return new Date(Date.parse('2026-07-31T00:00:00.000Z') + offset * 1000).toISOString()
}

describe('viewer static geometry', () => {
  it('renders a lone sampled zero as a short bucket stroke instead of a point', () => {
    const geometry = buildViewerGeometry(
      [{ minuteTs: minute(0), value: 0 }],
      [{ minuteTs: minute(0), value: 0 }],
      geometryOptions,
    )

    expect(geometry.idlePathD).toBe('M87.00 320.00 L93.00 320.00')
    expect(geometry.detailPathD).toBe('M87.00 320.00 L93.00 320.00')
    expect(geometry.idlePathD).not.toContain('A')
  })

  it('uses one timestamp domain and preserves independent null gaps', () => {
    const geometry = buildViewerGeometry(
      [
        { minuteTs: minute(0), value: 80 },
        { minuteTs: minute(1), value: 140 },
        { minuteTs: minute(2), value: null },
        { minuteTs: minute(3), value: 160 },
      ],
      [
        { minuteTs: minute(0), value: 100 },
        { minuteTs: minute(1), value: null },
        { minuteTs: minute(2), value: 300 },
        { minuteTs: minute(3), value: 180 },
      ],
      geometryOptions,
    )

    expect(geometry.detailPoints.map(point => point.x)).toEqual([90, 382, 674, 966])
    expect(geometry.detailPoints[1]?.value).toBeNull()
    expect(geometry.overviewPoints[2]?.value).toBeNull()
    expect(geometry.detailSegments).toHaveLength(2)
    expect(geometry.overviewSegments).toHaveLength(2)
    expect(geometry.scale.xForTimestamp(minute(2))).toBeCloseTo(674, 5)
    expect(geometry.idlePathD).not.toContain('M674.00')
    expect(geometry.detailPathD).toContain('M674.00')
  })

  it('keeps idle density near the CSS-width budget while preserving extrema', () => {
    const overview = Array.from({ length: 400 }, (_, index) => ({
      minuteTs: minute(index),
      value: index === 61 ? 1000 : index === 278 ? 20 : 100,
    }))
    const geometry = buildViewerGeometry(overview, overview, geometryOptions)
    const idle = geometry.overviewSegments[0]!
    const detail = geometry.detailSegments[0]!

    expect(idle.length).toBeLessThanOrEqual(viewerIdlePointBudget(876))
    expect(idle.length).toBeGreaterThan(24)
    expect(idle.some(point => point.value === 1000)).toBe(true)
    expect(idle.some(point => point.value === 20)).toBe(true)
    expect(detail.length).toBeLessThanOrEqual(viewerDetailPointBudget(876))
    expect(geometry.overviewPoints[0]?.minuteTs).toBe(minute(0))
    expect(geometry.overviewPoints.at(-1)?.minuteTs).toBe(minute(399))
  })

  it('averages ordinary overview noise while leaving zoom detail and record extrema exact', () => {
    const overview = Array.from({ length: 400 }, (_, index) => ({
      minuteTs: minute(index),
      value: index === 120 ? 500 : index === 280 ? 20 : index % 2 === 0 ? 90 : 110,
    }))
    const geometry = buildViewerGeometry(overview, overview, geometryOptions)
    const idle = geometry.overviewSegments[0]!
    const detail = geometry.detailSegments[0]!

    expect(idle.some(point => point.value === 500)).toBe(true)
    expect(idle.some(point => point.value === 20)).toBe(true)
    expect(idle.some(point => point.value !== null && point.value > 90 && point.value < 110)).toBe(true)
    expect(detail.some(point => point.value === 90)).toBe(true)
    expect(detail.some(point => point.value === 110)).toBe(true)
  })

  it('budgets display points by measured CSS plot width without rendering every minute', () => {
    const source = Array.from({ length: 600 }, (_, index) => ({
      minuteTs: minute(index),
      value: 100 + ((index * 17) % 31),
    }))

    for (const cssWidth of [480, 720, 876, 1200]) {
      const geometry = buildViewerGeometry(source, source, {
        ...geometryOptions,
        plotCssWidth: cssWidth,
      })
      const idleCount = geometry.overviewSegments.reduce((sum, segment) => sum + segment.length, 0)
      const detailCount = geometry.detailSegments.reduce((sum, segment) => sum + segment.length, 0)
      expect(idleCount).toBeLessThanOrEqual(viewerIdlePointBudget(cssWidth))
      expect(detailCount).toBeLessThanOrEqual(viewerDetailPointBudget(cssWidth))
      if (cssWidth <= 500) expect(detailCount).toBeLessThan(source.length)
    }
  })

  it('breaks timestamp gaps and preserves raw endpoints and prominent extrema', () => {
    const values = [100, 120, 900, 110, 100]
    const source = [
      { minuteTs: minute(0), value: 100 },
      { minuteTs: minute(1), value: 120 },
      { minuteTs: minute(2), value: 900 },
      { minuteTs: minute(10), value: 110 },
      { minuteTs: minute(11), value: 100 },
    ]
    const geometry = buildViewerGeometry(source, source, {
      ...geometryOptions,
      bandTop: 0,
      bandBottom: 1000,
      valueToY: value => 1000 - value,
      plotCssWidth: 480,
    })

    expect(geometry.detailSegments).toHaveLength(2)
    expect(geometry.detailPoints.map(point => point.value)).toEqual(values)
    expect(geometry.detailPoints[0]?.y).toBe(900)
    expect(geometry.detailPoints[2]?.y).toBe(100)
    expect(geometry.detailPoints[4]?.y).toBe(900)

    const irregular = [0, 30, 90, 270, 330].map((offset, index) => ({
      minuteTs: second(offset),
      value: 200 + index,
    }))
    const irregularGeometry = buildViewerGeometry(irregular, irregular, geometryOptions)
    // Median cadence is 60s, so the 180s jump exceeds max(150s, 2.5x cadence).
    expect(irregularGeometry.detailSegments).toHaveLength(2)

    expect(projectValuesToTimestamps([
      { minuteTs: second(0), value: 10 },
      { minuteTs: second(60), value: 20 },
      { minuteTs: second(120), value: null },
      { minuteTs: second(300), value: 40 },
      { minuteTs: second(360), value: 50 },
    ], [second(180), second(210)])).toEqual([null, null])
  })

  it('keeps a two-point segment linear and does not overshoot fitted segments', () => {
    const source = [
      { minuteTs: minute(0), value: 100 },
      { minuteTs: minute(1), value: 180 },
      { minuteTs: minute(2), value: 120 },
    ]
    const twoPoint = buildViewerGeometry(source.slice(0, 2), source.slice(0, 2), geometryOptions)
    expect(twoPoint.detailPathD).toContain(' L')
    expect(twoPoint.detailPathD).not.toContain(' C')

    const fitted = buildViewerGeometry(source, source, geometryOptions)
    const segment = fitted.detailSegments[0]!
    const yValues = segment.map(point => point.y!)
    for (let index = 1; index < yValues.length - 1; index++) {
      const low = Math.min(yValues[index - 1]!, yValues[index + 1]!)
      const high = Math.max(yValues[index - 1]!, yValues[index + 1]!)
      expect(yValues[index]).toBeGreaterThanOrEqual(geometryOptions.bandTop)
      expect(yValues[index]).toBeLessThanOrEqual(geometryOptions.bandBottom)
      expect(low).toBeLessThanOrEqual(high)
    }

    const curvePattern = /C\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?),\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?),\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g
    const curves = [...fitted.detailPathD.matchAll(curvePattern)]
    expect(curves[0]?.[2]).toBe(String(segment[0]!.y!.toFixed(2)))
    expect(curves.at(-1)?.[4]).toBe(String(segment.at(-1)!.y!.toFixed(2)))
    curves.forEach((curve, index) => {
      const low = Math.min(segment[index]!.y!, segment[index + 1]!.y!)
      const high = Math.max(segment[index]!.y!, segment[index + 1]!.y!)
      expect(Number(curve[2])).toBeGreaterThanOrEqual(low)
      expect(Number(curve[2])).toBeLessThanOrEqual(high)
      expect(Number(curve[4])).toBeGreaterThanOrEqual(low)
      expect(Number(curve[4])).toBeLessThanOrEqual(high)
    })
  })

  it('builds immutable detail geometry independently from hover coordinates', () => {
    const detail = Array.from({ length: 80 }, (_, index) => ({
      minuteTs: minute(index),
      value: 100 + (index % 7) * 10,
    }))
    const geometry = buildViewerGeometry(detail.slice(0, 20), detail, geometryOptions)
    const detailD = geometry.detailPathD
    const firstCursorX = geometry.scale.xForTimestamp(minute(10))
    const secondCursorX = geometry.scale.xForTimestamp(minute(50))

    expect(firstCursorX).not.toBe(secondCursorX)
    expect(geometry.detailPathD).toBe(detailD)
    expect(geometry.idlePathD).not.toBe(detailD)
  })

  it('maps invalid timestamps through the same bounded fallback scale', () => {
    const scale = buildViewerTimestampScale(['bad-a', 'bad-b'], {
      width: 100,
      padLeft: 10,
      padRight: 10,
    })
    expect(scale.xForTimestamp('bad-a', 0, 2)).toBe(10)
    expect(scale.xForTimestamp('bad-b', 1, 2)).toBe(90)
    expect(scale.timestampAtX(50)).toBeNull()
  })
})
