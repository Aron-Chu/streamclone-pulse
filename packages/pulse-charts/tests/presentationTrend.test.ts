import { describe, expect, it } from 'vitest'
import { composeRenderView } from '../src/renderView.ts'
import {
  buildPresentationTrend,
  decimatePresentationPoints,
  monotoneCubicPath,
  presentationPointBudget,
  resolvePresentationStep,
  resolveSemanticLodMode,
  selectRepresentativeSegments,
  type PresentationTrendPoint,
} from '../src/presentationTrend.ts'

function seriesWithGap(length: number, gapStart: number, gapEnd: number): Array<number | null> {
  return Array.from({ length }, (_, index) =>
    index >= gapStart && index < gapEnd ? null : 100 + (index % 17),
  )
}

describe('trendRenderView_doesNotExceedPixelBudget', () => {
  it('keeps a 1440-minute signal in 300px under the presentation budget', () => {
    const values = Array.from({ length: 1440 }, (_, index) => 50 + Math.sin(index / 20) * 10)
    const trend = buildPresentationTrend(values, {
      plotWidth: 300,
      sampleCount: 1440,
      mode: 'overview',
    })
    expect(trend.pointCount).toBeLessThanOrEqual(trend.pointBudget)
    expect(trend.pointBudget).toBe(presentationPointBudget(300, 'overview'))
    expect(trend.pointCount).toBeLessThanOrEqual(Math.ceil(300 / 2))
  })
})

describe('trendRenderView_preservesNullGaps', () => {
  it('never bridges a null interval with a continuous segment', () => {
    const values = seriesWithGap(120, 40, 55)
    const trend = buildPresentationTrend(values, { plotWidth: 300, mode: 'overview' })
    expect(trend.segments.length).toBeGreaterThanOrEqual(2)
    for (const segment of trend.segments) {
      for (let i = 1; i < segment.points.length; i++) {
        const prev = segment.points[i - 1]!
        const next = segment.points[i]!
        // Contiguous presentation points must not span the null gap indices.
        const spansGap = prev.sourceEndExclusive <= 40 && next.sourceStartIndex >= 55
          ? false
          : prev.sourceEndExclusive < next.sourceStartIndex
            && [...Array(next.sourceStartIndex - prev.sourceEndExclusive)].some((_, offset) => {
              const index = prev.sourceEndExclusive + offset
              return index >= 40 && index < 55
            })
        expect(spansGap).toBe(false)
      }
    }
  })
})

describe('trendRenderView_doesNotInventExtrema', () => {
  it('keeps monotone control points inside adjacent source y envelope', () => {
    const points = [
      { x: 0, y: 10 },
      { x: 10, y: 30 },
      { x: 20, y: 12 },
      { x: 30, y: 28 },
    ]
    const path = monotoneCubicPath(points)
    expect(path).toContain('C')
    // Sample cubic at t=0.5 for each segment via control-point clamp contract:
    // path must only emit C commands whose mid-y stays between segment ends.
    const commands = path.match(/C [\d.-]+ ([\d.-]+), [\d.-]+ ([\d.-]+), [\d.-]+ ([\d.-]+)/g) ?? []
    expect(commands.length).toBe(3)
    for (let i = 0; i < commands.length; i++) {
      const match = /C [\d.-]+ ([\d.-]+), [\d.-]+ ([\d.-]+), [\d.-]+ ([\d.-]+)/.exec(commands[i]!)
      expect(match).toBeTruthy()
      const cp1y = Number(match![1])
      const cp2y = Number(match![2])
      const endY = Number(match![3])
      const startY = points[i]!.y
      const low = Math.min(startY, endY)
      const high = Math.max(startY, endY)
      expect(cp1y).toBeGreaterThanOrEqual(low - 1e-6)
      expect(cp1y).toBeLessThanOrEqual(high + 1e-6)
      expect(cp2y).toBeGreaterThanOrEqual(low - 1e-6)
      expect(cp2y).toBeLessThanOrEqual(high + 1e-6)
    }
  })
})

describe('trendRenderView_keepsAnalyticalBucketsUntouched', () => {
  it('does not mutate composeRenderView output when building presentation geometry', () => {
    const values = Array.from({ length: 200 }, (_, index) => index)
    const analytical = composeRenderView({ viewers: values }, 40)
    const before = JSON.stringify(analytical)
    buildPresentationTrend(values, { plotWidth: 300, mode: 'overview' })
    expect(JSON.stringify(analytical)).toBe(before)
  })
})

describe('trendRenderView_doesNotAssignAverageToPeakMinute', () => {
  it('retains interval presentation identity and never inherits peak.index', () => {
    const values = Array.from({ length: 100 }, () => 1)
    values[77] = 500
    const trend = buildPresentationTrend(values, { plotWidth: 200, mode: 'overview' })
    for (const segment of trend.segments) {
      for (const point of segment.points) {
        expect(point.valueKind).toBe('average')
        // Average of a multi-minute bucket must not equal the peak-only identity.
        if (point.sourceEndExclusive - point.sourceStartIndex > 1) {
          expect(point.presentationMidIndex).not.toBe(77)
          expect(point.value).toBeLessThan(500)
        }
      }
    }
  })
})

describe('trendRenderView_isStableWhenLiveSampleAppends', () => {
  it('keeps historical presentation points stable except for the final open bucket', () => {
    const base = Array.from({ length: 240 }, (_, index) => 40 + (index % 11))
    const first = buildPresentationTrend(base, { plotWidth: 300, mode: 'overview' })
    const appended = buildPresentationTrend([...base, 55], {
      plotWidth: 300,
      mode: 'overview',
      previousStep: first.step,
    })

    const committed = (segments: typeof first.segments) =>
      segments.flatMap((segment) =>
        segment.points.filter((point) => point.sourceEndExclusive <= base.length - 2),
      )

    expect(JSON.stringify(committed(appended.segments))).toBe(JSON.stringify(committed(first.segments)))
  })
})

describe('trendRenderView_preservesObservedZero', () => {
  it('plots observed zero and keeps null as a gap', () => {
    const values: Array<number | null> = [0, 0, null, 0]
    const trend = buildPresentationTrend(values, { plotWidth: 100, mode: 'exact' })
    expect(trend.segments).toHaveLength(2)
    expect(trend.segments[0]?.points.every((point) => point.value === 0)).toBe(true)
    expect(trend.segments[1]?.points[0]?.value).toBe(0)
  })
})

describe('semanticLodHysteresis', () => {
  it('does not flicker near overview/intermediate boundary', () => {
    expect(resolveSemanticLodMode({ samplesPerPixel: 1.4 })).toBe('overview')
    expect(resolveSemanticLodMode({ samplesPerPixel: 1.2, previous: 'overview' })).toBe('overview')
    expect(resolveSemanticLodMode({ samplesPerPixel: 1.0, previous: 'overview' })).toBe('intermediate')
  })
})

describe('decimatePresentationPoints', () => {
  it('preserves endpoints', () => {
    const points: PresentationTrendPoint[] = Array.from({ length: 20 }, (_, index) => ({
      presentationMidIndex: index,
      value: index,
      sourceStartIndex: index,
      sourceEndExclusive: index + 1,
      valueKind: 'average',
    }))
    const out = decimatePresentationPoints(points, 5)
    expect(out[0]).toEqual(points[0])
    expect(out[out.length - 1]).toEqual(points[19])
    expect(out.length).toBeLessThanOrEqual(5)
  })
})

function segmentBridgesNulls(
  values: readonly (number | null | undefined)[],
  segment: { points: PresentationTrendPoint[] },
): boolean {
  for (let i = 1; i < segment.points.length; i++) {
    const prev = segment.points[i - 1]!
    const next = segment.points[i]!
    for (let index = prev.sourceEndExclusive; index < next.sourceStartIndex; index++) {
      if (!Number.isFinite(values[index] as number)) return true
    }
  }
  return false
}

describe('presentationTrend.enforcesGlobalBudgetAcrossGaps', () => {
  it('caps pointCount across a 12–24h alternating observed/null series', () => {
    const length = 18 * 60
    const values: Array<number | null> = Array.from({ length }, (_, index) =>
      index % 2 === 0 ? 40 + (index % 13) : null,
    )
    const options = { plotWidth: 300, sampleCount: length, mode: 'overview' as const }
    const first = buildPresentationTrend(values, options)
    const second = buildPresentationTrend(values, options)

    expect(first.mode).toBe('overview')
    expect(first.pointCount).toBeLessThanOrEqual(first.pointBudget)
    expect(first.pointCount).toBeLessThanOrEqual(presentationPointBudget(300, 'overview'))
    expect(first.degraded).toBe(true)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))

    for (const segment of first.segments) {
      expect(segmentBridgesNulls(values, segment)).toBe(false)
      for (const point of segment.points) {
        for (let index = point.sourceStartIndex; index < point.sourceEndExclusive; index++) {
          expect(values[index]).not.toBeNull()
          expect(Number.isFinite(values[index] as number)).toBe(true)
        }
      }
    }
  })
})

describe('presentationTrend.doesNotBridgeBoundaryGap', () => {
  it('splits when a one-minute null sits on an overview LOD bucket boundary', () => {
    const length = 400
    const values: Array<number | null> = Array.from({ length }, (_, index) => 50 + (index % 9))
    const probe = buildPresentationTrend(values, {
      plotWidth: 300,
      sampleCount: length,
      mode: 'overview',
    })
    expect(probe.mode).toBe('overview')
    expect(probe.step).toBeGreaterThan(1)

    const boundary = probe.step
    values[boundary] = null
    const trend = buildPresentationTrend(values, {
      plotWidth: 300,
      sampleCount: length,
      mode: 'overview',
      previousStep: probe.step,
    })

    expect(trend.mode).toBe('overview')
    expect(trend.segments.length).toBeGreaterThanOrEqual(2)
    const left = trend.segments.find((segment) =>
      segment.points.some((point) => point.sourceEndExclusive <= boundary),
    )
    const right = trend.segments.find((segment) =>
      segment.points.some((point) => point.sourceStartIndex > boundary),
    )
    expect(left).toBeTruthy()
    expect(right).toBeTruthy()
    expect(left).not.toBe(right)
    for (const segment of trend.segments) {
      expect(segmentBridgesNulls(values, segment)).toBe(false)
      expect(
        segment.points.some(
          (point) => point.sourceStartIndex <= boundary && point.sourceEndExclusive > boundary,
        ),
      ).toBe(false)
    }
  })
})

describe('presentationTrend.staysStableAcrossBudgetThreshold', () => {
  it('keeps step and historical coordinates across a 300→301 append', () => {
    const plotWidth = 300
    const budget = presentationPointBudget(plotWidth, 'overview')
    const count = budget * 2
    expect(resolvePresentationStep(count, budget)).toBe(2)
    expect(resolvePresentationStep(count + 1, budget)).toBe(3)

    const base = Array.from({ length: count }, (_, index) => 30 + (index % 11))
    const first = buildPresentationTrend(base, {
      plotWidth,
      sampleCount: count,
      mode: 'overview',
    })
    expect(first.step).toBe(2)
    const appended = buildPresentationTrend([...base, 44], {
      plotWidth,
      sampleCount: count + 1,
      mode: 'overview',
      previousStep: first.step,
    })
    expect(appended.step).toBe(2)
    expect(appended.pointCount).toBeLessThanOrEqual(appended.pointBudget)

    const committed = (segments: typeof first.segments) =>
      segments.flatMap((segment) =>
        segment.points.filter((point) => point.sourceEndExclusive <= count - first.step),
      )
    expect(JSON.stringify(committed(appended.segments))).toBe(JSON.stringify(committed(first.segments)))
  })
})

describe('presentationTrend.doesNotOscillateNearLodBoundary', () => {
  it('does not refine step when count drops back across the coarsen threshold', () => {
    const plotWidth = 300
    const budget = presentationPointBudget(plotWidth, 'overview')
    const count = budget * 2
    const atThreshold = Array.from({ length: count + 1 }, (_, index) => 20 + (index % 7))
    const first = buildPresentationTrend(atThreshold, {
      plotWidth,
      sampleCount: atThreshold.length,
      mode: 'overview',
    })
    const coarsened = buildPresentationTrend(
      [...atThreshold, 21, 22, 23, 24],
      {
        plotWidth,
        sampleCount: atThreshold.length + 4,
        mode: 'overview',
        previousStep: first.step,
      },
    )
    const back = buildPresentationTrend(atThreshold, {
      plotWidth,
      sampleCount: atThreshold.length,
      mode: 'overview',
      previousStep: coarsened.step,
    })
    expect(back.step).toBe(coarsened.step)
    expect(resolvePresentationStep(count + 1, budget, coarsened.step)).toBe(coarsened.step)
  })
})

describe('presentationTrend.preservesHistoricalCoordinatesDuringOrdinaryAppend', () => {
  it('leaves historical presentation mids unchanged when one sample appends', () => {
    const base = Array.from({ length: 360 }, (_, index) => 12 + (index % 19))
    const first = buildPresentationTrend(base, { plotWidth: 300, mode: 'overview' })
    const appended = buildPresentationTrend([...base, 18], {
      plotWidth: 300,
      mode: 'overview',
      previousStep: first.step,
    })
    expect(appended.step).toBe(first.step)
    const historical = (segments: typeof first.segments) =>
      segments.flatMap((segment) =>
        segment.points
          .filter((point) => point.sourceEndExclusive <= base.length - first.step)
          .map((point) => [point.presentationMidIndex, point.value, point.sourceStartIndex]),
      )
    expect(historical(appended.segments)).toEqual(historical(first.segments))
  })
})

function flattenMids(trend: { segments: Array<{ points: Array<{ presentationMidIndex: number; sourceStartIndex: number; sourceEndExclusive: number; value: number }> }> }) {
  return trend.segments.flatMap((segment) =>
    segment.points.map((point) => [
      point.presentationMidIndex,
      point.sourceStartIndex,
      point.sourceEndExclusive,
      point.value,
    ]),
  )
}

describe('PresentationTrend.redistributesRemainderUntilBudgetFilled', () => {
  it('keeps giving leftover points to eligible segments until the budget is filled', () => {
    const values: Array<number | null> = []
    for (let i = 0; i < 9; i++) {
      values.push(10 + i)
      values.push(null)
    }
    for (let i = 0; i < 100; i++) values.push(40 + (i % 5))
    const trend = buildPresentationTrend(values, { plotWidth: 12, mode: 'exact' })
    expect(trend.pointCount).toBeLessThanOrEqual(trend.pointBudget)
    expect(trend.pointCount).toBe(trend.pointBudget)
  })
})

describe('PresentationTrend.singleRepresentativeIsCoverageAware', () => {
  it('picks the longest observed segment, not always the first, when only one point fits', () => {
    const segments = [
      { points: [{ presentationMidIndex: 0, value: 1, sourceStartIndex: 0, sourceEndExclusive: 1, valueKind: 'average' as const }] },
      { points: [{ presentationMidIndex: 2, value: 2, sourceStartIndex: 2, sourceEndExclusive: 3, valueKind: 'average' as const }] },
      {
        points: [{
          presentationMidIndex: 22,
          value: 50,
          sourceStartIndex: 4,
          sourceEndExclusive: 44,
          valueKind: 'average' as const,
        }],
      },
      { points: [{ presentationMidIndex: 46, value: 3, sourceStartIndex: 46, sourceEndExclusive: 47, valueKind: 'average' as const }] },
      { points: [{ presentationMidIndex: 48, value: 4, sourceStartIndex: 48, sourceEndExclusive: 49, valueKind: 'average' as const }] },
    ]
    const kept = selectRepresentativeSegments(segments, 1)
    expect(kept).toHaveLength(1)
    expect(kept[0]?.points[0]?.sourceStartIndex).toBe(4)
    expect(kept[0]?.points[0]?.sourceEndExclusive).toBe(44)
  })
})

describe('PresentationTrend.append300To301IsStable', () => {
  it('keeps historical presentation identity across a 300→301 append', () => {
    const plotWidth = 300
    const count = presentationPointBudget(plotWidth, 'overview') * 2
    const base = Array.from({ length: count }, (_, index) => 30 + (index % 11))
    const first = buildPresentationTrend(base, { plotWidth, mode: 'overview' })
    const appended = buildPresentationTrend([...base, 44], {
      plotWidth,
      mode: 'overview',
      previousTrend: first,
    })
    expect(appended.pointCount).toBeLessThanOrEqual(appended.pointBudget)
    const committed = (current: typeof first) =>
      flattenMids(current).filter((row) => {
        const start = Number(row[1])
        const end = Number(row[2])
        return start >= first.step * 6 && end <= count - first.step * 6
      })
    expect(committed(appended)).toEqual(committed(first))
  })
})

describe('PresentationTrend.append301To302DoesNotGloballyReshuffle', () => {
  it('does not rebuild the whole history when a second minute appends after the budget threshold', () => {
    const plotWidth = 300
    const count = presentationPointBudget(plotWidth, 'overview') * 2
    const base = Array.from({ length: count }, (_, index) => 21 + (index % 9))
    const first = buildPresentationTrend(base, { plotWidth, mode: 'overview' })
    const at301 = buildPresentationTrend([...base, 22], {
      plotWidth,
      mode: 'overview',
      previousTrend: first,
    })
    const at302 = buildPresentationTrend([...base, 22, 23], {
      plotWidth,
      mode: 'overview',
      previousTrend: at301,
    })
    const historical = (trend: typeof first) =>
      flattenMids(trend).filter((row) => Number(row[2]) <= count - 4)
    expect(historical(at302)).toEqual(historical(at301))
    expect(at302.pointCount).toBeLessThanOrEqual(at302.pointBudget)
  })
})

describe('PresentationTrend.longLiveAppendChangesOnlyBoundedRegion', () => {
  it('confines unavoidable coarsening to the oldest prefix and the open tail', () => {
    const plotWidth = 200
    let values = Array.from({ length: 400 }, (_, index) => 15 + (index % 13))
    let trend = buildPresentationTrend(values, { plotWidth, mode: 'overview' })
    const middleStart = 80
    const middleEnd = 200
    for (let i = 0; i < 40; i++) {
      values = [...values, 18 + (i % 5)]
      const next = buildPresentationTrend(values, {
        plotWidth,
        mode: 'overview',
        previousTrend: trend,
      })
      const middle = (current: typeof trend) =>
        flattenMids(current).filter((row) => {
          const start = Number(row[1])
          const end = Number(row[2])
          return start >= middleStart && end <= middleEnd
        })
      expect(middle(next)).toEqual(middle(trend))
      expect(next.pointCount).toBeLessThanOrEqual(next.pointBudget)
      trend = next
    }
  })
})

describe('PresentationTrend.fragmented24hNeverExceedsGlobalBudget', () => {
  it('keeps a gappy 1440-minute signal at or under the point budget', () => {
    const values = Array.from({ length: 1440 }, (_, index) =>
      index % 7 === 3 ? null : 20 + (index % 23),
    )
    const trend = buildPresentationTrend(values, { plotWidth: 300, mode: 'overview' })
    expect(trend.pointCount).toBeLessThanOrEqual(trend.pointBudget)
  })
})

describe('PresentationTrend.neverBridgesBoundaryGap', () => {
  it('splits when a one-minute null lands on an LOD bucket boundary', () => {
    const values = [
      ...Array.from({ length: 20 }, () => 10),
      null,
      ...Array.from({ length: 20 }, () => 12),
    ]
    const trend = buildPresentationTrend(values, { plotWidth: 80, mode: 'overview' })
    expect(trend.segments.length).toBeGreaterThanOrEqual(2)
    for (const segment of trend.segments) {
      for (let i = 1; i < segment.points.length; i++) {
        const prev = segment.points[i - 1]!
        const next = segment.points[i]!
        expect(next.sourceStartIndex).toBeGreaterThanOrEqual(prev.sourceEndExclusive)
        const spannedNull = values
          .slice(prev.sourceEndExclusive, next.sourceStartIndex)
          .some((value) => value == null)
        expect(spannedNull).toBe(false)
      }
    }
  })
})

describe('PresentationTrend.observedZeroSurvives', () => {
  it('keeps observed zeros in the presentation path', () => {
    const values = [4, 0, 6, 0, 8]
    const trend = buildPresentationTrend(values, { plotWidth: 400, mode: 'exact' })
    const zeros = trend.segments.flatMap((segment) => segment.points.filter((point) => point.value === 0))
    expect(zeros.length).toBe(2)
  })
})

describe('PresentationTrend.outputIsDeterministic', () => {
  it('returns identical geometry for the same inputs', () => {
    const values = Array.from({ length: 480 }, (_, index) => (index % 11 === 0 ? null : 8 + (index % 17)))
    const a = buildPresentationTrend(values, { plotWidth: 240, mode: 'overview' })
    const b = buildPresentationTrend(values, { plotWidth: 240, mode: 'overview' })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

describe('ChartMotion.neverOvershootsSourceExtrema', () => {
  it('keeps monotone control points inside adjacent source y envelope', () => {
    const points = [
      { x: 0, y: 10 },
      { x: 10, y: 30 },
      { x: 20, y: 12 },
      { x: 30, y: 28 },
    ]
    const path = monotoneCubicPath(points)
    const commands = path.match(/C [\d.-]+ ([\d.-]+), [\d.-]+ ([\d.-]+), [\d.-]+ ([\d.-]+)/g) ?? []
    expect(commands.length).toBe(3)
    for (let i = 0; i < commands.length; i++) {
      const match = /C [\d.-]+ ([\d.-]+), [\d.-]+ ([\d.-]+), [\d.-]+ ([\d.-]+)/.exec(commands[i]!)
      const cp1y = Number(match![1])
      const cp2y = Number(match![2])
      const endY = Number(match![3])
      const startY = points[i]!.y
      const low = Math.min(startY, endY)
      const high = Math.max(startY, endY)
      expect(cp1y).toBeGreaterThanOrEqual(low - 1e-6)
      expect(cp1y).toBeLessThanOrEqual(high + 1e-6)
      expect(cp2y).toBeGreaterThanOrEqual(low - 1e-6)
      expect(cp2y).toBeLessThanOrEqual(high + 1e-6)
    }
  })
})

describe('ChartMotion.neverConnectsAcrossGap', () => {
  it('emits separate segments around a null gap', () => {
    const values = [10, 12, null, 14, 16]
    const trend = buildPresentationTrend(values, { plotWidth: 400, mode: 'exact' })
    expect(trend.segments).toHaveLength(2)
  })
})

describe('ChartMotion.liveAppendDoesNotRestartWholePath', () => {
  it('reuses historical presentation points on append', () => {
    const base = Array.from({ length: 80 }, (_, index) => 10 + (index % 5))
    const first = buildPresentationTrend(base, { plotWidth: 200, mode: 'overview' })
    const next = buildPresentationTrend([...base, 12], {
      plotWidth: 200,
      mode: 'overview',
      previousTrend: first,
    })
    const middle = (trend: typeof first) =>
      flattenMids(trend).filter((row) => Number(row[1]) >= 10 && Number(row[2]) <= 50)
    expect(middle(next)).toEqual(middle(first))
  })
})
