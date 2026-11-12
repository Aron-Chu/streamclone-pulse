import { describe, expect, it } from 'vitest'
import {
  sessionCanPlay,
  sessionHasFrame,
  sessionIsEnded,
  sessionMeasuredMinutes,
  sessionStreamedLine,
  sessionVodLine,
} from './sessionState.ts'

// The hosted shape (backend b1098ac through the portal adapter): no lifecycle
// from the backend, so the adapter says 'unknown', and endedAt is blanked.
const hostedEnded = {
  live: false,
  stream: { endedAt: undefined, lifecycleState: 'unknown' as const },
  availability: { liveDvrState: 'ended' },
}

describe('sessionIsEnded', () => {
  it('reads an ended hosted stream from the availability block alone', () => {
    expect(sessionIsEnded(hostedEnded)).toBe(true)
    expect(sessionIsEnded({ live: false, stream: {}, availability: { liveDvrState: 'ended' } })).toBe(true)
  })

  it('is never ended while live, or while the lifecycle says live', () => {
    expect(sessionIsEnded({ ...hostedEnded, live: true })).toBe(false)
    expect(sessionIsEnded({ live: false, stream: { lifecycleState: 'confirmed_live', endedAt: 'x' }, availability: { liveDvrState: 'ended' } })).toBe(false)
  })

  it('takes a confirmed end, or a stored end on a row that states no lifecycle', () => {
    expect(sessionIsEnded({ live: false, stream: { lifecycleState: 'confirmed_ended' } })).toBe(true)
    expect(sessionIsEnded({ live: false, stream: { endedAt: '2026-10-30T19:24:12Z' } })).toBe(true)
  })

  it('says nothing of an end without a sign of one', () => {
    expect(sessionIsEnded({ live: false })).toBe(false)
    expect(sessionIsEnded({ live: false, stream: { lifecycleState: 'unknown', endedAt: '2026-10-30T19:24:12Z' } })).toBe(false)
    expect(sessionIsEnded({ live: false, stream: { endedAt: '' }, availability: { liveDvrState: 'live' } })).toBe(false)
    expect(sessionIsEnded({ live: false, stream: { endedAt: null }, availability: { liveDvrState: 'unknown' } })).toBe(false)
  })
})

describe('sessionCanPlay', () => {
  it('needs a VOD and its verified alignment', () => {
    expect(sessionCanPlay({ vodId: '2899924626', vodAlignSeconds: 0 })).toBe(true)
    expect(sessionCanPlay({ vodId: '2899924626', vodAlignSeconds: 54 })).toBe(true)
    // hosted today: vodTiming archive_not_linked, so no alignment
    expect(sessionCanPlay({ vodId: '2899924626' })).toBe(false)
    expect(sessionCanPlay({ vodId: '2899924626', vodAlignSeconds: null })).toBe(false)
    expect(sessionCanPlay({ vodId: '2899924626', vodAlignSeconds: Number.NaN })).toBe(false)
    expect(sessionCanPlay({ vodId: '', vodAlignSeconds: 0 })).toBe(false)
    expect(sessionCanPlay({ vodAlignSeconds: 0 })).toBe(false)
  })
})

describe('sessionHasFrame', () => {
  it('is true only for a frame', () => {
    expect(sessionHasFrame({ url: 'x' })).toBe(true)
    expect(sessionHasFrame(null)).toBe(false)
    expect(sessionHasFrame(undefined)).toBe(false)
  })
})

describe('sessionStreamedLine', () => {
  const startedAt = '2026-10-29T12:00:00.000Z'
  const minute = (m: number, missing = false) => ({ minuteTs: new Date(Date.parse(startedAt) + m * 60_000).toISOString(), missing })

  it('gives the start date and the measured length in hours', () => {
    const rollups = [minute(0), minute(120), minute(239)]
    expect(sessionMeasuredMinutes(startedAt, rollups)).toBe(240)
    expect(sessionStreamedLine(startedAt, rollups)).toBe('Streamed Oct 29 · 4h')
  })

  it('keeps the minutes past a whole hour instead of rounding up', () => {
    expect(sessionStreamedLine(startedAt, [minute(0), minute(149)])).toBe('Streamed Oct 29 · 2h 30m')
    expect(sessionStreamedLine(startedAt, [minute(0), minute(90)])).toBe('Streamed Oct 29 · 1h 31m')
  })

  it('ignores missing minutes, and uses minutes under an hour', () => {
    expect(sessionStreamedLine(startedAt, [minute(0), minute(44), minute(200, true)])).toBe('Streamed Oct 29 · 45m')
  })

  it('drops the length without measured minutes, and the line without a start', () => {
    expect(sessionStreamedLine(startedAt, [])).toBe('Streamed Oct 29')
    expect(sessionStreamedLine(startedAt, undefined)).toBe('Streamed Oct 29')
    expect(sessionStreamedLine(undefined, [minute(0)])).toBeNull()
    expect(sessionStreamedLine('not a date', [minute(0)])).toBeNull()
  })
})

describe('sessionVodLine', () => {
  it('says "No VOD linked yet." for every state short of a known answer', () => {
    for (const state of [
      undefined,
      { status: 'live', label: 'Live — no VOD yet' },
      { status: 'syncing', label: 'Waiting for Twitch VOD', detail: 'Looking for the replay link…' },
      { status: 'unavailable', label: 'VOD not linked', detail: 'No verified archive link is available. Broadcast lifecycle and archive availability are unknown.' },
    ]) expect(sessionVodLine(state)).toEqual({ text: 'No VOD linked yet.', failed: false })
  })

  it('names a failed lookup and a known-gone archive', () => {
    expect(sessionVodLine({ status: 'request_failed', label: 'VOD lookup failed' })).toEqual({ text: 'VOD lookup failed. Try again later.', failed: true })
    expect(sessionVodLine({ status: 'unavailable', label: 'VOD unavailable', detail: 'Twitch archive deleted' }).text).toBe('Twitch archive deleted.')
    expect(sessionVodLine({ status: 'unavailable', label: 'VOD unavailable', detail: 'No verified Twitch VOD link is available for this session.' }).text).toBe('VOD unavailable.')
  })
})
