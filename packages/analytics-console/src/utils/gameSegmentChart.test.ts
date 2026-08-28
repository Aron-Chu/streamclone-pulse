import { describe, expect, it } from 'vitest'
import {
  clampGamesDurationSeconds,
  minuteRollupSpanSeconds,
  resolveGamesTimelineDurationSeconds,
  streamWallDurationSeconds,
  trimRollupsToWallDuration,
} from './gameSegmentChart.ts'

describe('streamWallDurationSeconds', () => {
  it('uses endedAt when present', () => {
    expect(
      streamWallDurationSeconds({
        startedAt: '2026-07-13T18:00:00.000Z',
        endedAt: '2026-07-13T20:30:00.000Z',
      }),
    ).toBe(2 * 3600 + 30 * 60 + 120)
  })

  it('uses now for live open streams', () => {
    const start = Date.parse('2026-07-13T18:00:00.000Z')
    const now = start + 90 * 60 * 1000
    expect(
      streamWallDurationSeconds(
        { startedAt: '2026-07-13T18:00:00.000Z', endedAt: null },
        now,
      ),
    ).toBe(90 * 60 + 120)
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
    })
    const trimmed = trimRollupsToWallDuration(rollups, startedAt, wall)
    expect(trimmed).toHaveLength(2)
    expect(minuteRollupSpanSeconds(trimmed)).toBeLessThanOrEqual(wall)
  })
})
