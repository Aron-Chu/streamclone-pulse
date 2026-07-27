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
})
