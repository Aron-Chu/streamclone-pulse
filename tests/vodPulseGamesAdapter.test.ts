import { describe, expect, it } from 'vitest'
import { vodPulseToChannelPayload } from '../src/vod/vodPulseToChannelPayload.ts'
import type { ExtensionVodPulseResponse } from '../src/types/vodPulseTypes.ts'

describe('vodPulseToChannelPayload games', () => {
  const base: ExtensionVodPulseResponse = {
    mode: 'vod',
    vodId: '2806037629',
    coverageStatus: 'ready',
    channelLogin: 'xqc',
    streamId: 's1',
    durationSeconds: 3600,
    timeline: {
      bucketSeconds: 60,
      points: [{ offsetSeconds: 0, chatPerMin: 1 }],
    },
  }

  it('passes ready games into channel payload for recap', () => {
    const payload = vodPulseToChannelPayload({
      ...base,
      games: [{ gameName: 'VALORANT', offsetSeconds: 0, durationSeconds: 3600 }],
    })
    expect(payload?.games?.[0]?.gameName).toBe('VALORANT')
  })

  it('keeps empty games empty', () => {
    const payload = vodPulseToChannelPayload({ ...base, games: [] })
    expect(payload?.games).toEqual([])
  })

  it('omits games when absent', () => {
    const payload = vodPulseToChannelPayload(base)
    expect(payload?.games).toBeUndefined()
  })

  it('preserves the completed VOD window for stream-specific clips', () => {
    const payload = vodPulseToChannelPayload({ ...base, startedAt: '2026-07-10T12:00:00Z' })
    expect(payload?.endedAt).toBe('2026-07-10T13:00:00.000Z')
  })

  it.each([undefined, 0, -1, Infinity])('does not infer clip boundaries from chart samples with duration %s', durationSeconds => {
    const payload = vodPulseToChannelPayload({ ...base, startedAt: '2026-07-10T12:00:00Z', durationSeconds })
    expect(payload?.endedAt).toBeUndefined()
  })

  it('does not invent an end time when the start timestamp is invalid', () => {
    expect(vodPulseToChannelPayload({ ...base, startedAt: 'invalid' })?.endedAt).toBeUndefined()
  })
})
