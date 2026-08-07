import { describe, expect, it } from 'vitest'
import {
  buildCanonicalOffsetScale,
  buildStaticChartGeometry,
  chartPointBudgets,
  inspectionClipAtOffset,
  type MorphTimedValue,
} from '../src/ui/chartMorphGeometry.ts'

const scale = buildCanonicalOffsetScale({
  width: 320,
  padLeft: 4,
  padRight: 12,
  domainStartOffsetSeconds: 0,
  domainEndOffsetSeconds: 600,
})

function geometryOptions(overrides: Partial<Parameters<typeof buildStaticChartGeometry>[2]> = {}) {
  return {
    width: 320,
    padLeft: 4,
    padRight: 12,
    bandTop: 2,
    bandBottom: 100,
    valueToY: (value: number) => 100 - value,
    scale,
    plotCssWidth: 320,
    ...overrides,
  }
}

function timedValues(): MorphTimedValue[] {
  return Array.from({ length: 61 }, (_, index) => ({
    offsetSeconds: index * 10,
    value:
      index === 24 || index === 25
        ? null
        : index === 7
          ? 96
          : index === 17
            ? 3
            : index === 45
              ? 88
              : 12 + (index % 9),
  }))
}

describe('static chart geometry', () => {
  it('scales compact idle/detail budgets without reaching one point per pixel', () => {
    expect([240, 280, 320, 392].map(width => chartPointBudgets(width, 'viewer'))).toEqual([
      { idle: 17, detail: 35 },
      { idle: 20, detail: 40 },
      { idle: 23, detail: 46 },
      { idle: 28, detail: 56 },
    ])
    expect([240, 280, 320, 392].map(width => chartPointBudgets(width, 'activity'))).toEqual([
      { idle: 24, detail: 60 },
      { idle: 28, detail: 70 },
      { idle: 32, detail: 80 },
      { idle: 39, detail: 98 },
    ])
  })

  it('maps offsets through one canonical scale', () => {
    expect(scale.xForOffset(0)).toBe(4)
    expect(scale.xForOffset(300)).toBe(156)
    expect(scale.xForOffset(600)).toBe(308)
    expect(scale.offsetForX(156)).toBe(300)
    expect(scale.xForOffset(9999)).toBe(308)
    expect(scale.offsetForX(-10)).toBe(0)
  })

  it('keeps idle density bounded while retaining bucket extrema and gap edges', () => {
    const values = timedValues()
    const geometry = buildStaticChartGeometry(values, values, geometryOptions({
      idleAnchorCount: 12,
      detailPointBudget: 10,
    }))

    expect(geometry.idleSegments).toHaveLength(2)
    expect(geometry.idleSegments.every(segment => segment.length <= 12)).toBe(true)
    expect(geometry.detailSegments.every(segment => segment.length <= 10)).toBe(true)
    expect(geometry.idleSegments.flat().map(point => point.value)).toContain(96)
    expect(geometry.idleSegments.flat().map(point => point.value)).toContain(3)
    expect(geometry.idleSegments.flat().map(point => point.value)).toContain(88)
    expect((geometry.idleLineD.match(/M/g) ?? []).length).toBe(2)
    expect((geometry.detailLineD.match(/M/g) ?? []).length).toBe(2)
  })

  it('keeps null samples out of both paths instead of bridging them as zeroes', () => {
    const geometry = buildStaticChartGeometry(
      [
        { offsetSeconds: 0, value: 10 },
        { offsetSeconds: 60, value: null },
        { offsetSeconds: 120, value: 20 },
      ],
      [
        { offsetSeconds: 0, value: 10 },
        { offsetSeconds: 60, value: null },
        { offsetSeconds: 120, value: 20 },
      ],
      geometryOptions(),
    )

    expect(geometry.idleSegments).toHaveLength(2)
    expect(geometry.detailSegments).toHaveLength(2)
    expect(geometry.idleLineD).not.toContain('0.00 100.00')
    expect(geometry.detailLineD).not.toContain('0.00 100.00')
  })

  it('does not turn an isolated sample into a fabricated singleton pill', () => {
    const geometry = buildStaticChartGeometry(
      [{ offsetSeconds: 300, value: 42 }],
      [{ offsetSeconds: 300, value: 42 }],
      geometryOptions(),
    )

    expect(geometry.idleLineD).toMatch(/^M/)
    expect(geometry.idleLineD).not.toContain('L')
    expect(geometry.detailLineD).toMatch(/^M/)
    expect(geometry.detailLineD).not.toContain('L')
  })

  it('keeps regular coarse sampled timelines in one continuous subpath', () => {
    for (const cadenceSeconds of [60, 120, 300, 900]) {
      const values = Array.from({ length: 5 }, (_, index) => ({
        offsetSeconds: index * cadenceSeconds,
        value: 10 + index,
      }))
      const geometry = buildStaticChartGeometry(values, values, geometryOptions({
        idleAnchorCount: 20,
        detailPointBudget: 20,
      }))
      expect(geometry.detailSegments).toHaveLength(1)
      expect((geometry.detailLineD.match(/M/g) ?? [])).toHaveLength(1)
      expect(geometry.detailLineD).toContain('L')
    }
  })

  it('uses an explicit missing sample to split a coarse timeline', () => {
    const values = [
      { offsetSeconds: 0, value: 10 },
      { offsetSeconds: 120, value: null, missing: true },
      { offsetSeconds: 240, value: 20 },
    ]
    const geometry = buildStaticChartGeometry(values, values, geometryOptions({
      idleAnchorCount: 20,
      detailPointBudget: 20,
    }))
    expect(geometry.detailSegments).toHaveLength(2)
    expect((geometry.detailLineD.match(/M/g) ?? [])).toHaveLength(2)
  })

  it('keeps invalid timestamps as structural gaps instead of bridging around them', () => {
    const values = [
      { offsetSeconds: 0, value: 10 },
      { offsetSeconds: Number.NaN, value: 15 },
      { offsetSeconds: 120, value: 20 },
    ]
    const geometry = buildStaticChartGeometry(values, values, geometryOptions({
      idleAnchorCount: 20,
      detailPointBudget: 20,
    }))
    expect(geometry.detailSegments).toHaveLength(2)
    expect((geometry.detailLineD.match(/M/g) ?? [])).toHaveLength(2)
  })

  it('splits duplicate, non-increasing, and cadence-gap timestamps', () => {
    const values = [
      { offsetSeconds: 0, value: 10 },
      { offsetSeconds: 60, value: 20 },
      { offsetSeconds: 60, value: 30 },
      { offsetSeconds: 30, value: 40 },
      { offsetSeconds: 120, value: 50 },
      { offsetSeconds: 240, value: 60 },
      { offsetSeconds: 300, value: 70 },
    ]
    const geometry = buildStaticChartGeometry(values, values, geometryOptions({
      idleAnchorCount: 20,
      detailPointBudget: 20,
    }))

    expect(geometry.idleSegments).toHaveLength(4)
    expect(geometry.detailSegments).toHaveLength(4)
    expect(geometry.detailSegments.map(segment => segment.map(point => point.offsetSeconds))).toEqual([
      [0, 60],
      [60],
      [30, 120],
      [240, 300],
    ])
  })

  it('uses exact endpoint values and zero endpoint tangents for curved paths', () => {
    const geometry = buildStaticChartGeometry(
      [
        { offsetSeconds: 0, value: 10 },
        { offsetSeconds: 60, value: 30 },
        { offsetSeconds: 120, value: 20 },
      ],
      [
        { offsetSeconds: 0, value: 10 },
        { offsetSeconds: 60, value: 30 },
        { offsetSeconds: 120, value: 20 },
      ],
      geometryOptions({ idleCurve: 'monotone', detailCurve: 'monotone' }),
    )
    expect(geometry.idleLineD).toMatch(/M4\.00 90\.00 C [^ ]+ 90\.00, /)
    expect(geometry.idleLineD).toMatch(/, [^ ]+ 80\.00, 64\.80 80\.00$/)
    expect(geometry.detailLineD).toContain('C')
  })

  it('retains protected backend offsets through reduction', () => {
    const values = Array.from({ length: 80 }, (_, index) => ({
      offsetSeconds: index * 10,
      value: index === 37 ? 99 : 10 + (index % 4),
    }))
    const geometry = buildStaticChartGeometry(values, values, geometryOptions({
      idleAnchorCount: 8,
      detailPointBudget: 12,
      preserveOffsets: [370],
    }))
    expect(geometry.idleSegments.flat().some(point => point.offsetSeconds === 370)).toBe(true)
    expect(geometry.detailSegments.flat().some(point => point.offsetSeconds === 370)).toBe(true)
  })

  it('keeps detail d immutable while hover changes only clip geometry', () => {
    const values = timedValues()
    const first = buildStaticChartGeometry(values, values, geometryOptions({ detailPointBudget: 10 }))
    const second = buildStaticChartGeometry(values, values, geometryOptions({ detailPointBudget: 10 }))
    const rest = inspectionClipAtOffset(scale, null)
    const hover = inspectionClipAtOffset(scale, 300)
    const scrub = inspectionClipAtOffset(scale, 450)

    expect(second.detailLineD).toBe(first.detailLineD)
    expect(second.idleLineD).toBe(first.idleLineD)
    expect(rest.beforeWidth).toBe(0)
    expect(rest.afterWidth).toBe(0)
    expect(hover.cursorX).toBe(scale.xForOffset(300))
    expect(hover.beforeWidth).toBeGreaterThan(0)
    expect(hover.afterWidth).toBeGreaterThan(0)
    expect(scrub.cursorX).not.toBe(hover.cursorX)
    expect(scrub.beforeWidth).not.toBe(hover.beforeWidth)
    expect(scrub.afterWidth).not.toBe(hover.afterWidth)
  })
})
