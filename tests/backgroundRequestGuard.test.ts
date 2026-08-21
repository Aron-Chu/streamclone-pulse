import { describe, expect, it } from 'vitest'
import { narrowBackgroundRequest } from '../src/shared/backgroundRequestGuard.ts'

describe('background request narrowing', () => {
  it('rejects non-object and unknown message shapes', () => {
    expect(narrowBackgroundRequest(null)).toBeNull()
    expect(narrowBackgroundRequest('GET_PULSE')).toBeNull()
    expect(narrowBackgroundRequest({})).toBeNull()
    expect(narrowBackgroundRequest({ type: 'FETCH_EMOTE_IMAGE', url: 'http://evil.tld/x' }))
      .toBeNull()
    expect(narrowBackgroundRequest({ type: 'EVAL', code: '1' })).toBeNull()
  })

  it('normalizes channel logins and rejects malformed ones', () => {
    expect(narrowBackgroundRequest({ type: 'TRACK', login: '  HasanAbi ' }))
      .toEqual({ type: 'TRACK', login: 'hasanabi' })
    expect(narrowBackgroundRequest({ type: 'TRACK', login: 'a' })).toBeNull()
    expect(narrowBackgroundRequest({ type: 'TRACK', login: '../../etc' })).toBeNull()
    expect(narrowBackgroundRequest({ type: 'TRACK', login: 'has anabi' })).toBeNull()
    expect(narrowBackgroundRequest({ type: 'TRACK', login: 42 })).toBeNull()
  })

  it('validates numeric stream and VOD identifiers', () => {
    expect(narrowBackgroundRequest({
      type: 'HINT_VOD',
      login: 'hasanabi',
      streamId: '318702573527',
      vodId: '2838742057',
    })).toEqual({
      type: 'HINT_VOD',
      login: 'hasanabi',
      streamId: '318702573527',
      vodId: '2838742057',
    })
    expect(narrowBackgroundRequest({
      type: 'HINT_VOD',
      login: 'hasanabi',
      streamId: '318702573527',
      vodId: '../../videos/1',
    })).toBeNull()
    expect(narrowBackgroundRequest({
      type: 'GET_PULSE_VOD',
      vodId: 'not-numeric',
    })).toBeNull()
  })

  it('drops unrecognized fields rather than forwarding them', () => {
    expect(narrowBackgroundRequest({
      type: 'GET_PULSE',
      login: 'hasanabi',
      window: 'full',
      baseUrl: 'https://evil.tld',
      __proto__: { polluted: true },
    })).toEqual({
      type: 'GET_PULSE',
      login: 'hasanabi',
      watch: undefined,
      window: 'full',
      streamId: undefined,
    })
  })

  it('coerces an unsupported pulse window to undefined instead of passing it through', () => {
    const narrowed = narrowBackgroundRequest({
      type: 'GET_PULSE',
      login: 'hasanabi',
      window: 'everything',
    })
    expect(narrowed).toMatchObject({ type: 'GET_PULSE', window: undefined })
  })

  it('rejects negative or non-finite offsets on backfill requests', () => {
    expect(narrowBackgroundRequest({
      type: 'LOAD_MISSED_MOMENTS',
      login: 'hasanabi',
      streamId: '318702573527',
      fromOffsetSeconds: -1,
    })).toBeNull()
    expect(narrowBackgroundRequest({
      type: 'LOAD_MISSED_MOMENTS',
      login: 'hasanabi',
      streamId: '318702573527',
      toOffsetSeconds: Number.NaN,
    })).toBeNull()
    expect(narrowBackgroundRequest({
      type: 'LOAD_MISSED_MOMENTS',
      login: 'hasanabi',
      streamId: '318702573527',
      fromOffsetSeconds: 60.7,
    })).toMatchObject({ fromOffsetSeconds: 60 })
  })

  it('requires a boolean for SET_AUTO_UPDATE', () => {
    expect(narrowBackgroundRequest({ type: 'SET_AUTO_UPDATE', enabled: 'yes' })).toBeNull()
    expect(narrowBackgroundRequest({ type: 'SET_AUTO_UPDATE', enabled: false }))
      .toEqual({ type: 'SET_AUTO_UPDATE', enabled: false })
  })

  it('bounds backfill job identifiers', () => {
    expect(narrowBackgroundRequest({
      type: 'GET_PULSE_BACKFILL_STATUS',
      jobId: 'job_abc123',
      login: ' HasanAbi ',
    })).toEqual({
      type: 'GET_PULSE_BACKFILL_STATUS',
      jobId: 'job_abc123',
      login: 'hasanabi',
    })
    expect(narrowBackgroundRequest({
      type: 'GET_PULSE_BACKFILL_STATUS',
      jobId: '../admin',
      login: 'hasanabi',
    }))
      .toBeNull()
    expect(narrowBackgroundRequest({
      type: 'GET_PULSE_BACKFILL_STATUS',
      jobId: 'x',
      login: 'hasanabi',
    })).toBeNull()
    expect(narrowBackgroundRequest({
      type: 'GET_PULSE_BACKFILL_STATUS',
      jobId: 'job_abc123',
    })).toBeNull()
  })
})
