import { describe, expect, it } from 'vitest'
import {
  MAX_ORIGIN_DELTA_SECONDS,
  resolveVodOriginAlignment,
  streamOffsetForVodTime,
  vodOffsetForStreamOffset,
} from '../src/shared/vodOriginAlignment.ts'

const aligned = (delta: number) => resolveVodOriginAlignment(delta)

describe('resolveVodOriginAlignment', () => {
  it('treats an absent delta as the identity mapping', () => {
    expect(resolveVodOriginAlignment(undefined)).toEqual({ kind: 'aligned', originDeltaSeconds: 0 })
    expect(resolveVodOriginAlignment(null)).toEqual({ kind: 'aligned', originDeltaSeconds: 0 })
  })

  it('accepts a positive recorder-started-late delta', () => {
    expect(aligned(94)).toEqual({ kind: 'aligned', originDeltaSeconds: 94 })
  })

  it('accepts a negative delta', () => {
    expect(aligned(-120)).toEqual({ kind: 'aligned', originDeltaSeconds: -120 })
  })

  it('accepts the exact boundary', () => {
    expect(aligned(MAX_ORIGIN_DELTA_SECONDS).kind).toBe('aligned')
    expect(aligned(-MAX_ORIGIN_DELTA_SECONDS).kind).toBe('aligned')
  })

  it('rejects implausible skew rather than seeking into nowhere', () => {
    expect(aligned(MAX_ORIGIN_DELTA_SECONDS + 1))
      .toEqual({ kind: 'unavailable', reason: 'out_of_range' })
  })

  it('rejects non-integer and non-finite values', () => {
    expect(aligned(12.5)).toEqual({ kind: 'unavailable', reason: 'not_integer' })
    expect(aligned(Number.NaN)).toEqual({ kind: 'unavailable', reason: 'not_finite' })
    expect(aligned(Number.POSITIVE_INFINITY)).toEqual({ kind: 'unavailable', reason: 'not_finite' })
  })

  it('never coerces a wrong-typed delta to zero', () => {
    expect(resolveVodOriginAlignment('94')).toEqual({ kind: 'unavailable', reason: 'not_finite' })
    expect(resolveVodOriginAlignment({})).toEqual({ kind: 'unavailable', reason: 'not_finite' })
  })
})

describe('vodOffsetForStreamOffset', () => {
  it('subtracts a positive delta so the jump lands on the moment', () => {
    // Moment at stream+600s in a VOD whose recording began 94s late.
    expect(vodOffsetForStreamOffset(600, aligned(94))).toBe(506)
  })

  it('adds back a negative delta', () => {
    expect(vodOffsetForStreamOffset(600, aligned(-120))).toBe(720)
  })

  it('is the identity when there is no skew', () => {
    expect(vodOffsetForStreamOffset(600, aligned(0))).toBe(600)
  })

  it('clamps to the start of the VOD instead of producing a negative seek', () => {
    expect(vodOffsetForStreamOffset(30, aligned(94))).toBe(0)
  })

  it('floors fractional stream offsets', () => {
    expect(vodOffsetForStreamOffset(600.9, aligned(94))).toBe(506)
  })

  it('returns null when alignment is unavailable', () => {
    expect(vodOffsetForStreamOffset(600, aligned(12.5))).toBeNull()
  })

  it('returns null for a non-finite stream offset', () => {
    expect(vodOffsetForStreamOffset(Number.NaN, aligned(0))).toBeNull()
  })
})

describe('streamOffsetForVodTime', () => {
  it('inverts the mapping for a positive delta', () => {
    expect(streamOffsetForVodTime(506, aligned(94))).toBe(600)
  })

  it('inverts the mapping for a negative delta', () => {
    expect(streamOffsetForVodTime(720, aligned(-120))).toBe(600)
  })

  it('round-trips a moment through both directions', () => {
    for (const delta of [-3600, -120, 0, 94, 3600]) {
      const vodOffset = vodOffsetForStreamOffset(4000, aligned(delta))
      expect(vodOffset).not.toBeNull()
      expect(streamOffsetForVodTime(vodOffset as number, aligned(delta))).toBe(4000)
    }
  })

  it('clamps a pre-stream player position to zero', () => {
    expect(streamOffsetForVodTime(10, aligned(-120))).toBe(0)
  })

  it('returns null when alignment is unavailable', () => {
    expect(streamOffsetForVodTime(506, aligned(Number.NaN))).toBeNull()
  })
})
