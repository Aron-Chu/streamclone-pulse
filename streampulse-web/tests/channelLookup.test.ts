import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiClient = vi.hoisted(() => vi.fn())
vi.mock('../src/lib/apiClient', () => ({ apiClient }))

import {
  lookupChannel,
  lookupDay,
  lookupLine,
  lookupTwitchProfile,
  readChannelLookup,
  resetChannelLookups,
} from '../src/lib/channelLookup'

const AVATAR = 'https://static-cdn.jtvnw.net/jtv_user_pictures/xqc-profile_image-300x300.png'

/** Answers by path: a value resolves, an Error rejects (an edge 502 comes back as a thrown ApiError). */
function routes(answers: Record<string, unknown>) {
  apiClient.mockImplementation(async (path: string) => {
    const key = Object.keys(answers).find((k) => path.startsWith(k))
    if (!key) throw new Error(`unexpected ${path}`)
    const v = answers[key]
    if (v instanceof Error) throw v
    return { data: v }
  })
}

const STREAMS = '/v1/portal/analytics/channels/xqc/streams'
const PROFILE = '/v1/channels/xqc'

beforeEach(() => {
  resetChannelLookups()
  apiClient.mockReset()
})
afterEach(() => vi.useRealTimers())

describe('channelLookup: one channel by its login (3A, 11-02)', () => {
  it('reads the latest recorded stream and the Twitch profile, with credentials left out', async () => {
    routes({
      [STREAMS]: { items: [{ streamId: '42', startedAt: '2026-10-31T20:00:00Z', category: ' Grand Theft Auto V ', endedAt: '2026-10-31T23:00:00Z' }] },
      [PROFILE]: { login: 'xQc', displayName: 'xQc', profileImageUrl: AVATAR },
    })
    const got = await lookupChannel('  XQC ')
    expect(got).toEqual({
      state: 'recorded',
      login: 'xqc',
      profile: { displayName: 'xQc', avatar: AVATAR },
      stream: { streamId: '42', startedAt: '2026-10-31T20:00:00Z', category: 'Grand Theft Auto V', ended: true },
    })
    expect(apiClient).toHaveBeenCalledWith(`${STREAMS}?limit=1`, expect.objectContaining({ credentials: 'omit' }))
    expect(apiClient).toHaveBeenCalledWith(PROFILE, expect.objectContaining({ credentials: 'omit' }))
    expect(readChannelLookup('xqc')).toBe(got)
  })

  it('says "can’t check" on a failed read, never "no such channel"', async () => {
    routes({ [STREAMS]: new Error('error code: 502'), [PROFILE]: new Error('error code: 502') })
    const got = await lookupChannel('xqc')
    expect(got).toEqual({ state: 'unknown', login: 'xqc' })
    expect(lookupLine(got)).toBe('Can’t check right now')
  })

  it('says "not recorded yet" for an empty list; a 502 profile leaves the profile out', async () => {
    routes({ [STREAMS]: { items: [] }, [PROFILE]: new Error('error code: 502') })
    const got = await lookupChannel('xqc')
    expect(got).toEqual({ state: 'unrecorded', login: 'xqc', profile: null })
    expect(lookupLine(got)).toBe('Not recorded yet')
  })

  it('keeps answers and shares a read in flight', async () => {
    routes({ [STREAMS]: { items: [] }, [PROFILE]: { login: 'xqc' } })
    await Promise.all([lookupChannel('xqc'), lookupChannel('XQC')])
    await lookupChannel('xqc')
    expect(apiClient).toHaveBeenCalledTimes(2)
  })

  it('reads nothing for a text that cannot be a login', async () => {
    expect(await lookupChannel('just chatting')).toEqual({ state: 'unknown', login: 'just chatting' })
    expect(await lookupTwitchProfile('a')).toEqual({ state: 'unknown' })
    expect(apiClient).not.toHaveBeenCalled()
  })

  it('takes a profile only for the login asked, and only a Twitch CDN picture', async () => {
    routes({ [PROFILE]: { login: 'someoneelse', displayName: 'Other' } })
    expect(await lookupTwitchProfile('xqc')).toEqual({ state: 'unknown' })
    resetChannelLookups()
    routes({ [PROFILE]: { login: 'xqc', displayName: '  ', profileImageUrl: 'https://evil.test/a.png' } })
    expect(await lookupTwitchProfile('xqc')).toEqual({ state: 'found', profile: { displayName: undefined, avatar: undefined } })
  })

  it('writes the row: "Offline" only when the record says the stream ended', () => {
    const now = Date.UTC(2026, 10, 2, 12)
    const stream = { streamId: '1', startedAt: '2026-10-31T20:00:00Z', ended: true, category: 'GTA V' }
    expect(lookupLine({ state: 'recorded', login: 'xqc', profile: null, stream }, now)).toBe('Offline · last streamed Oct 31 · GTA V')
    expect(lookupLine({ state: 'recorded', login: 'xqc', profile: null, stream: { ...stream, ended: false, category: undefined } }, now)).toBe('Last streamed Oct 31')
    expect(lookupDay('2025-12-30T20:00:00Z', now)).toBe('Dec 30, 2025')
    expect(lookupDay('nope', now)).toBe('')
  })
})
