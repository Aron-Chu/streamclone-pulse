import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { buildSessionSignals } from './buildSessionSignals'
import type { AnalyticsMinuteRollup, AnalyticsStreamDetail, PulseStreamRecap } from '../apiTypes'

type Fixture = {
  schemaVersion: string
  streamId: string
  startedAt: string
  detail: AnalyticsStreamDetail
  rollups: AnalyticsMinuteRollup[]
  recap: PulseStreamRecap
}

function fixture(name: string): Fixture {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), 'testdata', name), 'utf8'),
  ) as Fixture
}

function build(data: Fixture, overrides: Partial<Parameters<typeof buildSessionSignals>[0]> = {}) {
  return buildSessionSignals({
    detail: data.detail,
    recap: data.recap,
    rollups: data.rollups,
    startedAt: data.startedAt,
    streamId: data.streamId,
    ...overrides,
  })
}

describe('buildSessionSignals', () => {
  it('A1: keeps an older server quiet except eligible legacy coverage', () => {
    const signals = build(fixture('session-signal-detail.v1.older-server.json'))
    expect(signals).toEqual([
      expect.objectContaining({ kind: 'coverage', state: 'partial', detail: 'Partial coverage (legacy)' }),
    ])
  })

  it('A2-A4: derives zero only from measured provenance and never claims missing data', () => {
    const data = fixture('session-signal-detail.v1.json')
    const signals = build(data)
    const deltas = signals.filter((signal) => signal.kind === 'delta')

    expect(deltas.some((signal) => signal.current.state === 'measured_zero')).toBe(true)
    expect(deltas.every((signal) => signal.minuteTs !== '2026-07-11T18:03:00.000Z')).toBe(true)
    expect(deltas.every((signal) => signal.current.value !== undefined)).toBe(true)
  })

  it('A5-A7: normalizes invalid wire and watermark precedence without throwing', () => {
    const invalid = fixture('session-signal-detail.v1.invalid-wire.json')
    expect(() => build(invalid)).not.toThrow()
    expect(build(invalid).filter((signal) => signal.kind === 'delta')).toHaveLength(0)

    const data = fixture('session-signal-detail.v1.json')
    const values = build(data).filter((signal) => signal.kind === 'delta').flatMap((signal) => [signal.current, signal.previous])
    expect(values.some((value) => value.state === 'stale')).toBe(false)
    expect(values.some((value) => value.state === 'partial')).toBe(false)
  })

  it('A8-A9: emits only material, contiguous, source-compatible comparable deltas', () => {
    const data = fixture('session-signal-detail.v1.json')
    const signals = build(data).filter((signal) => signal.kind === 'delta')

    expect(signals).toHaveLength(1)
    expect(signals.every((signal) => signal.previous !== undefined)).toBe(true)
    expect(signals.every((signal) => signal.minuteTs === '2026-07-11T18:01:00.000Z')).toBe(true)
  })

  it('A10-A13: emits only confirmed finite peaks with resolved minute and stable normalized ID', () => {
    const data = fixture('session-signal-detail.v1.json')
    const peak = build(data).find((signal) => signal.kind === 'peak')

    expect(peak).toMatchObject({
      id: 'peak:stream_fixture_v1:240:heatmap-chat_spike',
      minuteTs: '2026-07-11T18:04:00.000Z',
      current: { metric: 'peaks', value: 88, state: 'measured' },
    })

    const unresolved: Fixture = structuredClone(data)
    unresolved.recap.topMoments![0].offsetSeconds = 500
    expect(build(unresolved).some((signal) => signal.kind === 'peak')).toBe(false)
  })

  it('A14: prioritizes, caps, and chronologically renders events while preserving coverage', () => {
    const data = fixture('session-signal-detail.v1.json')
    data.detail.signalWatermarks = {
      chat: { state: 'partial', observedThrough: data.startedAt },
    }
    data.rollups = Array.from({ length: 40 }, (_, index) => ({
      minuteTs: new Date(Date.parse(data.startedAt) + index * 60_000).toISOString(),
      chatCount: index * 10,
      totalEmoteCount: index * 10,
      viewerAvg: index * 100,
      viewerSamples: 1,
      signalObservations: {
        chat: { state: 'measured', observedAt: new Date(Date.parse(data.startedAt) + index * 60_000).toISOString(), source: 'live' },
        emotes: { state: 'measured', observedAt: new Date(Date.parse(data.startedAt) + index * 60_000).toISOString(), source: 'live' },
        viewers: { state: 'measured', observedAt: new Date(Date.parse(data.startedAt) + index * 60_000).toISOString(), source: 'helix' },
      },
    }))
    const signals = build(data)
    const events = signals.filter((signal) => signal.kind !== 'coverage')

    expect(signals[0]).toMatchObject({ kind: 'coverage' })
    expect(events).toHaveLength(36)
    expect(events.map((signal) => signal.minuteTs)).toEqual([...events.map((signal) => signal.minuteTs)].sort())
  })

  it('A15-A17: omits invalid coverage, sorts a copy, and never depends on clock or updatedAt', () => {
    const data = fixture('session-signal-detail.v1.json')
    const original = [...data.rollups].reverse()
    data.rollups = original
    data.detail.updatedAt += 1

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2020-01-01T00:00:00.000Z'))
    const first = build(data)
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'))
    const second = build(data)
    vi.useRealTimers()

    expect(first).toEqual(second)
    expect(data.rollups).toEqual(original)
    expect(first.find((signal) => signal.kind === 'coverage')?.coveragePct).toBe(82)
  })

  it('A18: omits peaks from a recap for another stream', () => {
    const data = fixture('session-signal-detail.v1.json')
    data.recap.streamId = 'another_stream'
    expect(build(data).some((signal) => signal.kind === 'peak')).toBe(false)
  })

  it('uses non-empty moment rollups ahead of rollups', () => {
    const data = fixture('session-signal-detail.v1.json')
    data.detail.momentRollups = [data.rollups[0], data.rollups[1]]
    expect(build(data).filter((signal) => signal.kind === 'delta').every(
      (signal) => signal.minuteTs === data.rollups[1].minuteTs,
    )).toBe(true)
  })
})
