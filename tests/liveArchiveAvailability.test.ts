import { describe, expect, it } from 'vitest'
import {
  LIVE_ARCHIVE_HEURISTIC_MIN_ELAPSED_SECONDS,
  liveArchiveAbsenceMessage,
  resolveLiveArchiveAvailability,
} from '../src/ui/liveArchiveAvailability.ts'

describe('resolveLiveArchiveAvailability', () => {
  it('stays optimistic early in a broadcast', () => {
    expect(resolveLiveArchiveAvailability({ elapsedSeconds: 120, hasArchiveEvidence: false }))
      .toBe('too_early')
  })

  it('flags a likely restriction once publication latency stops explaining it', () => {
    expect(resolveLiveArchiveAvailability({
      elapsedSeconds: LIVE_ARCHIVE_HEURISTIC_MIN_ELAPSED_SECONDS,
      hasArchiveEvidence: false,
    })).toBe('likely_restricted')
    expect(resolveLiveArchiveAvailability({ elapsedSeconds: 7200, hasArchiveEvidence: false }))
      .toBe('likely_restricted')
  })

  it('never blames the channel when an archive was actually observed', () => {
    expect(resolveLiveArchiveAvailability({ elapsedSeconds: 7200, hasArchiveEvidence: true }))
      .toBe('too_early')
  })

  it('stays optimistic when elapsed time is unknown', () => {
    expect(resolveLiveArchiveAvailability({ elapsedSeconds: null, hasArchiveEvidence: false }))
      .toBe('too_early')
    expect(resolveLiveArchiveAvailability({ elapsedSeconds: Number.NaN, hasArchiveEvidence: false }))
      .toBe('too_early')
  })
})

describe('liveArchiveAbsenceMessage', () => {
  it('hedges instead of asserting VODs are disabled', () => {
    const message = liveArchiveAbsenceMessage('likely_restricted')
    expect(message).toBe(
      'No live archive is available. This channel may have VODs disabled or restricted.',
    )
    expect(message).toMatch(/\bmay\b/)
  })

  it('does not tell a restricted channel to keep waiting', () => {
    expect(liveArchiveAbsenceMessage('likely_restricted')).not.toMatch(/try again|few minutes/i)
  })

  it('keeps the wait-and-retry copy while publication is still plausible', () => {
    expect(liveArchiveAbsenceMessage('too_early')).toMatch(/try again/i)
  })
})
