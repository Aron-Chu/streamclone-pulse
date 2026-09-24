import { describe, expect, it } from 'vitest'
import {
  clampGamesDurationSeconds,
  minuteRollupEndOffsetSeconds,
  minuteRollupSpanSeconds,
  resolveGamesTimelineDurationSeconds,
  streamWallDurationSeconds,
  trimRollupsToWallDuration,
} from './gameSegmentChart.ts'

describe('minuteRollupEndOffsetSeconds', () => {
  const startedAt = '2026-07-13T18:00:00.000Z'
  // Tracking began 5 minutes in; the last measured minute starts at 10:30:00.
  const rollups = [{ minuteTs: '2026-07-13T18:05:00.000Z' }, { minuteTs: '2026-07-14T04:30:00.000Z' }]

  it('ends at the last measured minute, not after the span, when the opening was untracked', () => {
    expect(minuteRollupSpanSeconds(rollups)).toBe(10 * 3600 + 26 * 60)
    expect(minuteRollupEndOffsetSeconds(rollups, startedAt)).toBe(10 * 3600 + 31 * 60)
  })

  it('falls back to the span without a usable start', () => {
    expect(minuteRollupEndOffsetSeconds(rollups, undefined)).toBe(10 * 3600 + 26 * 60)
    expect(minuteRollupEndOffsetSeconds(rollups, 'not a date')).toBe(10 * 3600 + 26 * 60)
    expect(minuteRollupEndOffsetSeconds([], startedAt)).toBe(0)
  })
})

describe('streamWallDurationSeconds', () => {
  it('does not clamp an unknown lifecycle to legacy EndedAt or now', () => {
    expect(streamWallDurationSeconds({ startedAt: '2026-07-13T18:00:00Z', endedAt: '2026-07-30T18:00:00Z', lifecycleState: 'unknown' })).toBe(0)
  })
  it('uses the exact offline evidence upper bound, not a late mutable end', () => {
    expect(streamWallDurationSeconds({ startedAt: '2026-07-13T18:00:00Z', endedAt: '2026-07-30T18:00:00Z', lifecycleState: 'confirmed_ended', lifecycleDetectedAt: '2026-07-13T20:00:00Z' })).toBe(2 * 3600 + 120)
  })
  it('does not trust a legacy endedAt without lifecycle evidence', () => {
    expect(
      streamWallDurationSeconds({
        startedAt: '2026-07-13T18:00:00.000Z',
        endedAt: '2026-07-13T20:30:00.000Z',
      }),
    ).toBe(0)
  })

  it('uses now only for explicitly confirmed live streams', () => {
    const start = Date.parse('2026-07-13T18:00:00.000Z')
    const now = start + 90 * 60 * 1000
    expect(
      streamWallDurationSeconds(
        { startedAt: '2026-07-13T18:00:00.000Z', endedAt: null, lifecycleState: 'confirmed_live' },
        now,
      ),
    ).toBe(90 * 60 + 120)
    expect(streamWallDurationSeconds({ startedAt: '2026-07-13T18:00:00.000Z', endedAt: null }, now)).toBe(0)
  })
})

describe('clampGamesDurationSeconds', () => {
  it('caps overlong rollup spans to wall duration', () => {
    expect(clampGamesDurationSeconds(26 * 3600, 2 * 3600 + 120)).toBe(2 * 3600 + 120)
  })
})

describe('resolveGamesTimelineDurationSeconds', () => {
  it('keeps live games bounded to the loaded chart window', () => {
    expect(resolveGamesTimelineDurationSeconds(
      [{ offsetSeconds: 0, durationSeconds: 9_000 }],
      3_600,
      9_120,
      true,
    )).toBe(3_600)
  })

  it('preserves the full ended game timeline across sparse rollup coverage', () => {
    expect(resolveGamesTimelineDurationSeconds(
      [{ offsetSeconds: 0, durationSeconds: 91_403 }],
      15_540,
      91_523,
      false,
    )).toBe(91_403)
  })

  it('caps impossible ended game durations to the stream wall time', () => {
    expect(resolveGamesTimelineDurationSeconds(
      [{ offsetSeconds: 0, durationSeconds: 100_000 }],
      15_540,
      91_523,
      false,
    )).toBe(91_523)
  })
})

describe('trimRollupsToWallDuration', () => {
  it('drops reconstructed minutes past wall duration', () => {
    const startedAt = '2026-07-13T18:00:00.000Z'
    const rollups = [
      { minuteTs: '2026-07-13T18:30:00.000Z' },
      { minuteTs: '2026-07-13T20:00:00.000Z' },
      { minuteTs: '2026-07-14T20:00:00.000Z' },
    ]
    const wall = streamWallDurationSeconds({
      startedAt,
      endedAt: '2026-07-13T20:30:00.000Z',
      lifecycleState: 'confirmed_ended',
      lifecycleDetectedAt: '2026-07-13T20:30:00.000Z',
    })
    const trimmed = trimRollupsToWallDuration(rollups, startedAt, wall)
    expect(trimmed).toHaveLength(2)
    expect(minuteRollupSpanSeconds(trimmed)).toBeLessThanOrEqual(wall)
  })
})
