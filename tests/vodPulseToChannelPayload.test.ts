import { describe, expect, it } from 'vitest'
import { vodPulseToChannelPayload } from '../src/vod/vodPulseToChannelPayload.ts'
import type { ExtensionVodPulseResponse } from '../src/types/vodPulseTypes.ts'

function vodWithData(coverageStatus: ExtensionVodPulseResponse['coverageStatus']): ExtensionVodPulseResponse {
  return {
    mode: 'vod',
    vodId: '2839940123',
    streamId: '319796892764',
    channelLogin: 'xqc',
    coverageStatus,
    timeline: {
      bucketSeconds: 60,
      points: [{ offsetSeconds: 0, chatPerMin: 12, emotesPerMin: 4 }],
    },
    topMoments: [{ offsetSeconds: 60, label: 'Emote spike', score: 80 }],
    recap: {
      streamId: '319796892764',
      login: 'xqc',
      durationSeconds: 120,
      totalMessages: 12,
      peakChatPerMin: 12,
      topMoments: [{ offsetSeconds: 60, score: 80, reasons: ['emote_spike'] }],
      topEmotes: [],
      clipCandidates: [],
    },
  }
}

describe('vodPulseToChannelPayload', () => {
  it('maps ready and partial coverage into recap payload', () => {
    expect(vodPulseToChannelPayload(vodWithData('ready'))?.recap).toBeTruthy()
    expect(vodPulseToChannelPayload(vodWithData('partial'))?.recap).toBeTruthy()
  })

  it('still maps syncing coverage when timeline or recap data is already present', () => {
    const payload = vodPulseToChannelPayload(vodWithData('syncing'))
    expect(payload?.isLive).toBe(false)
    expect(payload?.rollups.length).toBe(1)
    expect(payload?.recap).toBeTruthy()
  })

  it('does not invent analytics from a missing VOD response', () => {
    expect(vodPulseToChannelPayload({
      mode: 'vod',
      vodId: '1',
      coverageStatus: 'missing',
    })).toBeNull()
  })

  it('maps ready VOD data when Helix omitted channelLogin but client has a fallback', () => {
    const vod = vodWithData('ready')
    delete (vod as { channelLogin?: string }).channelLogin
    expect(vodPulseToChannelPayload(vod)).toBeNull()
    const payload = vodPulseToChannelPayload(vod, { fallbackLogin: 'xqc' })
    expect(payload?.login).toBe('xqc')
    expect(payload?.rollups.length).toBe(1)
  })

  it('ignores placeholder __vod__: fallback logins', () => {
    const vod = vodWithData('ready')
    delete (vod as { channelLogin?: string }).channelLogin
    expect(vodPulseToChannelPayload(vod, { fallbackLogin: '__vod__:2839940123' })).toBeNull()
  })
})
