import { describe, expect, it } from 'vitest'
import type { PresentationTrend } from '@streampulse/pulse-charts'
import {
  commitPresentationHistory,
  presentationLodScope,
  previousTrendForScope,
} from '../src/ui/presentationHistory.ts'

const trend = (step: number, sampleCount: number): PresentationTrend => ({
  mode: 'overview',
  segments: [{
    points: [{
      presentationMidIndex: sampleCount - 1,
      value: 10,
      sourceStartIndex: 0,
      sourceEndExclusive: sampleCount,
      valueKind: 'average',
    }],
  }],
  pointCount: 1,
  pointBudget: 150,
  step,
  degraded: false,
})

describe('PulseOverviewChart.renderIsPureForPresentationHistory', () => {
  it('reads the last committed trend without mutating it during the next compute', () => {
    const committed = commitPresentationHistory(
      '300:full',
      'overview',
      trend(2, 300),
      trend(2, 300),
      trend(2, 300),
    )
    const first = previousTrendForScope(committed, '300:full', 'viewer')
    const second = previousTrendForScope(committed, '300:full', 'viewer')
    expect(first).toBe(second)
    expect(first?.step).toBe(2)
    expect(committed.viewerTrend.step).toBe(2)
  })
})

describe('PulseOverviewChart.strictModeDoesNotAdvanceLodHistoryTwice', () => {
  it('returns the same previous trend when render is invoked twice before commit', () => {
    const committed = commitPresentationHistory(
      '300:full',
      'overview',
      trend(2, 301),
      trend(2, 301),
      trend(2, 301),
    )
    const a = previousTrendForScope(committed, '300:full', 'chat')
    const b = previousTrendForScope(committed, '300:full', 'chat')
    expect(a).toBe(b)
    expect(a?.step).toBe(2)
  })
})

describe('PulseOverviewChart.viewportChangeResetsCommittedStep', () => {
  it('drops previous trends when the lod scope changes', () => {
    const committed = commitPresentationHistory(
      '300:full',
      'overview',
      trend(2, 400),
      trend(2, 400),
      trend(2, 400),
    )
    expect(previousTrendForScope(committed, '300:0:900', 'viewer')).toBeUndefined()
    expect(presentationLodScope(300, 'full')).not.toBe(presentationLodScope(300, '0:900'))
  })
})

describe('PulseOverviewChart.liveAppendUsesLastCommittedStep', () => {
  it('reuses the committed trend for the same viewport scope', () => {
    const committed = commitPresentationHistory(
      presentationLodScope(300, 'full'),
      'overview',
      trend(2, 300),
      trend(2, 300),
      trend(2, 300),
    )
    const previous = previousTrendForScope(
      committed,
      presentationLodScope(300, 'full'),
      'emote',
    )
    expect(previous?.step).toBe(2)
    expect(previous?.segments[0]?.points[0]?.sourceEndExclusive).toBe(300)
  })
})
