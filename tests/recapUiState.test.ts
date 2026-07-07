import { describe, expect, it } from 'vitest'
import type { PulsePayload, PulseStreamRecap } from '../src/shared/messages.ts'
import { hasOfflineRecapData, resolveRecapUiState } from '../src/ui/recapUiState.ts'

function basePayload(overrides: Partial<PulsePayload> = {}): PulsePayload {
  return {
    login: 'test',
    isLive: false,
    tracking: true,
    streamId: 'stream-1',
    currentOffsetSeconds: 0,
    rollups: [],
    lanes: { composite: [], chat: [], seventv: [] },
    recap: null,
    ...overrides,
  }
}

function sampleRecap(overrides: Partial<PulseStreamRecap> = {}): PulseStreamRecap {
  return {
    streamId: 'stream-1',
    login: 'test',
    durationSeconds: 3600,
    totalMessages: 1200,
    peakChatPerMin: 80,
    topMoments: [{ offsetSeconds: 600, score: 90, reasons: ['chat_spike'] }],
    topEmotes: [{ code: 'KEKW', count: 40, provider: 'seventv', imageUrl: 'https://cdn.example/kekw.webp' }],
    clipCandidates: [],
    emoteEnrichmentStatus: 'complete',
    ...overrides,
  }
}

describe('resolveRecapUiState', () => {
  it('returns null on live streams', () => {
    expect(
      resolveRecapUiState({
        isLive: true,
        tracking: true,
        streamId: 'stream-1',
        recap: sampleRecap(),
      }),
    ).toBeNull()
  })

  it('returns loading when tracked offline stream is waiting for recap', () => {
    expect(
      resolveRecapUiState({
        isLive: false,
        tracking: true,
        streamId: 'stream-1',
        recap: null,
        hadLiveSession: true,
      }),
    ).toBe('loading')
  })

  it('returns ready for enriched recap payloads', () => {
    expect(
      resolveRecapUiState({
        isLive: false,
        tracking: true,
        streamId: 'stream-1',
        recap: sampleRecap(),
      }),
    ).toBe('ready')
  })

  it('returns partial when emote enrichment is incomplete', () => {
    expect(
      resolveRecapUiState({
        isLive: false,
        tracking: true,
        streamId: 'stream-1',
        recap: sampleRecap({ emoteEnrichmentStatus: 'partial' }),
      }),
    ).toBe('partial')
  })

  it('returns error when poll fails while recap is expected', () => {
    expect(
      resolveRecapUiState({
        isLive: false,
        tracking: true,
        streamId: 'stream-1',
        recap: null,
        pollError: 'network error',
        hadLiveSession: true,
      }),
    ).toBe('error')
  })

  it('returns partial for offline fallback payload data without recap', () => {
    expect(
      resolveRecapUiState({
        isLive: false,
        tracking: false,
        recap: null,
        payload: basePayload({
          tracking: false,
          streamId: undefined,
          topEmotes: [{ name: 'KEKW', count: 12, imageUrl: 'https://cdn.example/kekw.webp' }],
        }),
      }),
    ).toBe('partial')
  })

  it('returns empty when offline with no recap and no fallback data', () => {
    expect(
      resolveRecapUiState({
        isLive: false,
        tracking: false,
        recap: null,
        payload: basePayload({ tracking: false, streamId: undefined }),
      }),
    ).toBe('empty')
  })
})

describe('hasOfflineRecapData', () => {
  it('detects rollup and emote fallback data', () => {
    const payload = basePayload({
      rollups: [{ offsetSeconds: 60, chatCount: 20, sevenTvEmoteCount: 4 }],
      topEmotes: [{ name: 'LUL', count: 3 }],
    })
    expect(hasOfflineRecapData(payload)).toBe(true)
  })
})
