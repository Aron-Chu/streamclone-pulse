import { describe, expect, it } from 'vitest'
import { sessionEndedAtMs } from './sessionEnd.ts'

const NOW = Date.parse('2026-10-31T17:00:00.000Z')
const STORED_END = '2026-10-30T19:24:12.493Z'
const DETECTED = '2026-10-30T19:30:00.000Z'

describe('sessionEndedAtMs', () => {
  it('uses the stored end of an older row that states no lifecycle (the hosted rows today)', () => {
    expect(sessionEndedAtMs({ endedAt: STORED_END }, false, NOW)).toBe(Date.parse(STORED_END))
  })

  it('uses the confirmed-offline time on a confirmed-ended stream, else the stored end', () => {
    expect(sessionEndedAtMs({ lifecycleState: 'confirmed_ended', lifecycleDetectedAt: DETECTED, endedAt: STORED_END }, false, NOW))
      .toBe(Date.parse(DETECTED))
    expect(sessionEndedAtMs({ lifecycleState: 'confirmed_ended', endedAt: STORED_END }, false, NOW))
      .toBe(Date.parse(STORED_END))
  })

  it('says nothing while the session is live, or when the lifecycle says live or unknown', () => {
    expect(sessionEndedAtMs({ endedAt: STORED_END }, true, NOW)).toBeNull()
    expect(sessionEndedAtMs({ lifecycleState: 'confirmed_live', endedAt: STORED_END }, false, NOW)).toBeNull()
    expect(sessionEndedAtMs({ lifecycleState: 'unknown', endedAt: STORED_END }, false, NOW)).toBeNull()
  })

  it('says nothing without a usable end time', () => {
    expect(sessionEndedAtMs(undefined, false, NOW)).toBeNull()
    expect(sessionEndedAtMs({}, false, NOW)).toBeNull()
    expect(sessionEndedAtMs({ endedAt: null }, false, NOW)).toBeNull()
    expect(sessionEndedAtMs({ endedAt: '0001-01-01T00:00:00Z' }, false, NOW)).toBeNull()
    expect(sessionEndedAtMs({ endedAt: '2026-11-05T00:00:00Z' }, false, NOW)).toBeNull()
    expect(sessionEndedAtMs({ lifecycleState: 'confirmed_ended' }, false, NOW)).toBeNull()
  })
})
