import { describe, expect, it } from 'vitest'
import { normalizePublicHub } from '../src/lib/publicHub'

const metric = {
  state: 'ready' as const,
  currentPerMin: 25,
  baselinePerMin: 10,
  absoluteDeltaPerMin: 15,
  changePct: 150,
  multiplier: 2.5,
  currentMeasuredMinutes: 5,
  currentExpectedMinutes: 5,
  baselineMeasuredMinutes: 20,
  baselineExpectedMinutes: 20,
  baselineCoveragePct: 100,
}

const eventMetric = {
  ...metric,
  currentMeasuredMinutes: 1,
  currentExpectedMinutes: 1,
}

function rawEventComparison() {
  return {
    baselineKind: 'current_stream_measured_average_before_event' as const,
    eventAt: 1_800_000,
    baselineWindow: {
      start: 300_000,
      end: 1_500_000,
      expectedMinutes: 20,
      measuredMinutes: 20,
      coveragePct: 100,
    },
    chat: { ...eventMetric },
    emotes: { ...eventMetric },
    evidence: {
      ircBound: true,
      eventRollupAvailable: true,
      baselineMeasuredMinutes: 20,
      baselineExpectedMinutes: 20,
      baselineCoveragePct: 100,
    },
  }
}

function normalizeRawEventComparison(comparison: ReturnType<typeof rawEventComparison>) {
  return normalizePublicHub({
    livePulseMoments: [{ offsetSeconds: 60, score: 80, label: 'Chat surge', comparison }],
  }).livePulseMoments[0].comparison
}

describe('public analytics truth contract', () => {
  it('normalizes backend rising channels without ranking from live rows', () => {
    const hub = normalizePublicHub({
      risingChannels: [{
        login: 'xqc',
        viewers: 1000,
        measuredAt: 1_800_000,
        comparison: metric,
        evidence: { ircBound: true, chatObservedLast5m: true, rollupAvailable: true },
      }],
    })
    expect(hub.risingChannels).toHaveLength(1)
    expect(hub.risingChannels?.[0].comparison.absoluteDeltaPerMin).toBe(15)
    expect(hub.topMovers).toEqual([])
  })

  it('rejects a claimed malformed rising list so the legacy label can remain explicit', () => {
    const hub = normalizePublicHub({
      risingChannels: [{ login: '', viewers: -1 }] as never,
    })
    expect(hub.risingChannels).toBeUndefined()
  })

  it('rejects unqualified partial rows from the backend rising list', () => {
    const hub = normalizePublicHub({
      risingChannels: [{
        login: 'xqc',
        viewers: 1000,
        measuredAt: 1_800_000,
        comparison: { ...metric, state: 'partial', reason: 'baseline_partial' },
        evidence: { ircBound: true, chatObservedLast5m: true, rollupAvailable: true },
      }],
    })
    expect(hub.risingChannels).toBeUndefined()
  })

  it('accepts the exact raw backend Live Wire comparison wire shape', () => {
    const comparison = normalizeRawEventComparison(rawEventComparison())
    expect(comparison?.baselineKind).toBe('current_stream_measured_average_before_event')
    expect(comparison?.evidence.eventRollupAvailable).toBe(true)
    expect(comparison?.baselineWindow.measuredMinutes).toBe(20)
    expect(comparison?.baselineWindow.coveragePct).toBe(100)
  })

  it('rejects Live Wire evidence that disagrees with the backend baseline window', () => {
    const comparison = rawEventComparison()
    comparison.evidence.baselineMeasuredMinutes = 19
    comparison.evidence.baselineCoveragePct = 95
    expect(normalizeRawEventComparison(comparison)).toBeUndefined()
  })

  it.each([
    ['chat baseline measured minutes', (value: ReturnType<typeof rawEventComparison>) => { value.chat.baselineMeasuredMinutes = 19 }],
    ['emote baseline expected minutes', (value: ReturnType<typeof rawEventComparison>) => { value.emotes.baselineExpectedMinutes = 21 }],
    ['chat baseline coverage', (value: ReturnType<typeof rawEventComparison>) => { value.chat.baselineCoveragePct = 99 }],
    ['current measured minutes across metrics', (value: ReturnType<typeof rawEventComparison>) => { value.chat.currentMeasuredMinutes = 0 }],
    ['event current expected minutes', (value: ReturnType<typeof rawEventComparison>) => { value.emotes.currentExpectedMinutes = 5 }],
    ['event rollup availability', (value: ReturnType<typeof rawEventComparison>) => { value.evidence.eventRollupAvailable = false }],
  ])('rejects incoherent Live Wire %s', (_label, mutate) => {
    const comparison = rawEventComparison()
    mutate(comparison)
    expect(normalizeRawEventComparison(comparison)).toBeUndefined()
  })

  it('keeps a warming event comparison with explicit zero-length baseline evidence', () => {
    const warmingMetric = {
      ...metric,
      state: 'warming' as const,
      reason: 'baseline_warming',
      currentMeasuredMinutes: 1,
      currentExpectedMinutes: 1,
      baselineMeasuredMinutes: 0,
      baselineExpectedMinutes: 0,
      baselineCoveragePct: 0,
      changePct: undefined,
      multiplier: undefined,
    }
    const hub = normalizePublicHub({
      livePulseMoments: [{
        offsetSeconds: 60,
        score: 80,
        label: 'Chat surge',
        comparison: {
          baselineKind: 'current_stream_measured_average_before_event',
          eventAt: 1_800_000,
          baselineWindow: { start: 1_800_000, end: 1_800_000, expectedMinutes: 0, measuredMinutes: 0, coveragePct: 0 },
          chat: warmingMetric,
          emotes: warmingMetric,
          evidence: {
            ircBound: true,
            eventRollupAvailable: true,
            baselineMeasuredMinutes: 0,
            baselineExpectedMinutes: 0,
            baselineCoveragePct: 0,
          },
        },
      }],
    })
    expect(hub.livePulseMoments[0].comparison?.chat.state).toBe('warming')
    expect(hub.livePulseMoments[0].comparison?.baselineWindow.coveragePct).toBe(0)
  })
})
