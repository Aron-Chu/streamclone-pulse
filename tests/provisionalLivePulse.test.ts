import { describe, expect, it } from 'vitest'
import {
  provisionalPulseMatchesVod,
  resolveProvisionalVodStreamTarget,
  shouldAttemptProvisionalLivePulse,
} from '../src/vod/provisionalLivePulse.ts'

describe('shouldAttemptProvisionalLivePulse', () => {
  it('does not bridge a missing VOD from a scraped login alone', () => {
    expect(shouldAttemptProvisionalLivePulse({
      mode: 'vod',
      vodId: '2844403169',
      coverageStatus: 'missing',
      retryable: false,
    }, { candidateLogin: 'xqc' })).toBe(false)
  })

  it('bridges only when backend proved this VOD’s owner', () => {
    expect(shouldAttemptProvisionalLivePulse({
      mode: 'vod',
      vodId: '2844403169',
      coverageStatus: 'missing',
      channelLogin: 'jynxzi',
      streamId: '317871200344',
      retryable: false,
    })).toBe(true)
  })

  it('refuses a scrape that disagrees with the proven VOD owner', () => {
    expect(shouldAttemptProvisionalLivePulse({
      mode: 'vod',
      vodId: '2844403169',
      coverageStatus: 'missing',
      channelLogin: 'jynxzi',
      streamId: '317871200344',
    }, { candidateLogin: 'xqc' })).toBe(false)
  })

  it('does not replace ready or partial VOD analytics', () => {
    expect(shouldAttemptProvisionalLivePulse({
      mode: 'vod',
      vodId: '1',
      coverageStatus: 'ready',
      channelLogin: 'jynxzi',
    })).toBe(false)
    expect(shouldAttemptProvisionalLivePulse({
      mode: 'vod',
      vodId: '1',
      coverageStatus: 'partial',
      channelLogin: 'jynxzi',
    })).toBe(false)
    expect(shouldAttemptProvisionalLivePulse({
      mode: 'vod',
      vodId: '1',
      coverageStatus: 'syncing',
      channelLogin: 'jynxzi',
      streamId: '317871200344',
    })).toBe(false)
    expect(shouldAttemptProvisionalLivePulse({
      mode: 'vod',
      vodId: '1',
      coverageStatus: 'error',
      channelLogin: 'jynxzi',
      streamId: '317871200344',
    })).toBe(false)
  })
})

describe('resolveProvisionalVodStreamTarget', () => {
  it('does not fall back to another channel’s live/recap pulse', () => {
    expect(resolveProvisionalVodStreamTarget({
      mode: 'vod',
      vodId: '2844403169',
      coverageStatus: 'missing',
    }, { channelLogin: 'xqc' })).toBeNull()
  })

  it('targets only the Helix-proven stream for this VOD', () => {
    expect(resolveProvisionalVodStreamTarget({
      mode: 'vod',
      vodId: '2844403169',
      coverageStatus: 'missing',
      channelLogin: 'jynxzi',
      streamId: '317871200344',
    })).toEqual({ login: 'jynxzi', streamId: '317871200344' })
  })

  it('does not use a D1 stream hint as a substitute for Helix identity', () => {
    expect(resolveProvisionalVodStreamTarget({
      mode: 'vod',
      vodId: '2844403169',
      coverageStatus: 'missing',
      channelLogin: 'jynxzi',
    }, { streamId: '318828504791' })).toBeNull()
  })

  it('ignores a D1 stream hint when the scraped login is not this VOD’s owner', () => {
    expect(resolveProvisionalVodStreamTarget({
      mode: 'vod',
      vodId: '2844403169',
      coverageStatus: 'missing',
    }, { channelLogin: 'xqc', streamId: '320967807707' })).toBeNull()
  })

  it('rejects a bridge stream that disagrees with the Helix-proven VOD stream', () => {
    expect(resolveProvisionalVodStreamTarget({
      mode: 'vod',
      vodId: '2844403169',
      coverageStatus: 'missing',
      channelLogin: 'jynxzi',
      streamId: '317871200344',
    }, { channelLogin: 'jynxzi', streamId: '318828504791' })).toBeNull()
  })
})

describe('provisionalPulseMatchesVod', () => {
  const vod = {
    mode: 'vod' as const,
    vodId: '2844403169',
    coverageStatus: 'missing' as const,
    channelLogin: 'jynxzi',
    streamId: '317871200344',
  }

  it('requires the exact stream identity when the VOD resolver supplied one', () => {
    expect(provisionalPulseMatchesVod(vod, {
      login: 'jynxzi',
      streamId: '318828504791',
      isLive: true,
      tracking: true,
      currentOffsetSeconds: 0,
      rollups: [],
      lanes: { composite: [], chat: [], seventv: [] },
      peaks: [],
      recap: null,
    })).toBe(false)
    expect(provisionalPulseMatchesVod(vod, {
      login: 'jynxzi',
      isLive: true,
      tracking: true,
      currentOffsetSeconds: 0,
      rollups: [],
      peaks: [],
      lanes: { composite: [], chat: [], seventv: [] },
      recap: null,
    })).toBe(false)
  })
})
