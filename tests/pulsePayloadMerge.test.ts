import { describe, expect, it } from 'vitest'
import { mergePulsePayload } from '../src/background/pulsePayloadMerge.ts'
import type { PulsePayload } from '../src/shared/messages.ts'

function basePayload(overrides: Partial<PulsePayload> = {}): PulsePayload {
  return {
    login: 'xqc',
    isLive: true,
    tracking: true,
    currentOffsetSeconds: 3600,
    rollups: [],
    lanes: { composite: [], chat: [], seventv: [] },
    recap: null,
    ...overrides,
  }
}

describe('mergePulsePayload', () => {
  it('returns incoming when there is no previous payload', () => {
    const incoming = basePayload({
      rollups: [{ offsetSeconds: 60, chatCount: 10, sevenTvEmoteCount: 2 }],
    })
    expect(mergePulsePayload(null, incoming)).toEqual(incoming)
  })

  it('keeps fullRollups when a recent poll returns fewer points', () => {
    const previous = basePayload({
      streamId: 'stream-a',
      rollups: [
        { offsetSeconds: 3480, chatCount: 20, sevenTvEmoteCount: 2 },
        { offsetSeconds: 3540, chatCount: 40, sevenTvEmoteCount: 5 },
      ],
      fullRollups: [
        { offsetSeconds: 0, chatCount: 1, sevenTvEmoteCount: 0 },
        { offsetSeconds: 3540, chatCount: 40, sevenTvEmoteCount: 5 },
      ],
      coverage: {
        state: 'live',
        coverageStartOffsetSeconds: 0,
        coverageEndOffsetSeconds: 3540,
        hasFullStreamCoverage: true,
        hasGaps: false,
        canBackfill: false,
        message: 'ok',
      },
    })
    const incoming = basePayload({
      streamId: 'stream-a',
      rollups: [{ offsetSeconds: 3540, chatCount: 55, sevenTvEmoteCount: 8 }],
      peaks: [{ offsetSeconds: 3540, score: 12, reasons: ['chat_spike'], dominantSignal: 'chat' }],
    })

    const merged = mergePulsePayload(previous, incoming)
    expect(merged.fullRollups).toHaveLength(2)
    expect(merged.rollups).toHaveLength(2)
    expect(merged.rollups[1]?.chatCount).toBe(55)
    expect(merged.coverage?.hasFullStreamCoverage).toBe(true)
  })

  it('replaces an explicitly supplied full timeline, even when it is shorter or empty', () => {
    const previous = basePayload({
      streamId: 'stream-a',
      fullRollups: [
        { offsetSeconds: 0, chatCount: 1, sevenTvEmoteCount: 0 },
        { offsetSeconds: 60, chatCount: 2, sevenTvEmoteCount: 0 },
      ],
    })
    const shorter = basePayload({
      streamId: 'stream-a',
      fullRollups: [{ offsetSeconds: 60, chatCount: 9, sevenTvEmoteCount: 1 }],
    })
    expect(mergePulsePayload(previous, shorter).fullRollups).toEqual(shorter.fullRollups)

    const empty = basePayload({ streamId: 'stream-a', fullRollups: [] })
    expect(mergePulsePayload(previous, empty).fullRollups).toEqual([])
  })

  it('does not carry full history across a stream activation change', () => {
    const previous = basePayload({
      login: 'streamer_a',
      streamId: 'stream-a',
      fullRollups: [{ offsetSeconds: 0, chatCount: 1, sevenTvEmoteCount: 0 }],
    })
    const incoming = basePayload({ login: 'streamer_b', streamId: 'stream-b' })
    expect(mergePulsePayload(previous, incoming).fullRollups).toBeUndefined()
  })

  it('does not carry omitted live fields across a different streamer', () => {
    const previous = basePayload({
      login: 'streamer_a',
      streamId: 'stream-a',
      rollups: [{ offsetSeconds: 900, chatCount: 90, sevenTvEmoteCount: 9 }],
      peaks: [{ offsetSeconds: 900, score: 90, reasons: ['chat_spike'], dominantSignal: 'chat' }],
      games: [{ gameName: 'Old game', offsetSeconds: 0, durationSeconds: 900 }],
      coverage: {
        state: 'live',
        coverageStartOffsetSeconds: 0,
        coverageEndOffsetSeconds: 900,
        hasFullStreamCoverage: true,
        hasGaps: false,
        canBackfill: false,
        message: 'old stream',
      },
      topEmotes: [{ id: 'old', name: 'OLD', count: 99 }],
      peakViewers: 99_000,
    })
    const incoming = basePayload({
      login: 'streamer_b',
      streamId: 'stream-b',
      rollups: [{ offsetSeconds: 0, chatCount: 1, sevenTvEmoteCount: 0 }],
    })

    const merged = mergePulsePayload(previous, incoming)
    expect(merged.rollups).toEqual(incoming.rollups)
    expect(merged.peaks).toBeUndefined()
    expect(merged.games).toBeUndefined()
    expect(merged.coverage).toBeUndefined()
    expect(merged.topEmotes).toBeUndefined()
    expect(merged.peakViewers).toBeUndefined()
  })

  it('allows explicit empty peaks and games to clear stale activation data', () => {
    const previous = basePayload({
      peaks: [{ offsetSeconds: 60, score: 8, reasons: ['chat_spike'], dominantSignal: 'chat' }],
      games: [{ gameName: 'Just Chatting', offsetSeconds: 0, durationSeconds: 60 }],
    })
    const incoming = basePayload({ peaks: [], games: [] })
    const merged = mergePulsePayload(previous, incoming)
    expect(merged.peaks).toEqual([])
    expect(merged.games).toEqual([])
  })

  it('treats keyword-count changes as meaningful rollup changes', () => {
    const previous = basePayload({
      rollups: [{ offsetSeconds: 60, chatCount: 10, sevenTvEmoteCount: 2, keywordCount: 1 }],
    })
    const incoming = basePayload({
      rollups: [{ offsetSeconds: 60, chatCount: 10, sevenTvEmoteCount: 2, keywordCount: 4 }],
    })
    const merged = mergePulsePayload(previous, incoming)
    expect(merged).not.toBe(previous)
    expect(merged.rollups[0]?.keywordCount).toBe(4)
  })

  it('keeps games when a recent poll omits them', () => {
    const previous = basePayload({
      games: [{ gameName: 'Just Chatting', offsetSeconds: 0, durationSeconds: 3600 }],
    })
    const incoming = basePayload({
      rollups: [{ offsetSeconds: 60, chatCount: 10, sevenTvEmoteCount: 2 }],
    })
    const merged = mergePulsePayload(previous, incoming)
    expect(merged.games).toHaveLength(1)
    expect(merged.games?.[0]?.gameName).toBe('Just Chatting')
  })

  it('replaces games with a shorter corrected timeline instead of unioning stale segments', () => {
    const previous = basePayload({
      games: [
        { gameName: 'A', offsetSeconds: 0, durationSeconds: 600 },
        { gameName: 'B', offsetSeconds: 600, durationSeconds: 600 },
        { gameName: 'C', offsetSeconds: 1200, durationSeconds: 600 },
      ],
    })
    // Corrected backend response for the same activation supplies fewer,
    // current-stream-only segments; stale C must not be resurrected.
    const incoming = basePayload({
      games: [
        { gameName: 'A', offsetSeconds: 0, durationSeconds: 900 },
        { gameName: 'B', offsetSeconds: 600, durationSeconds: 300 },
      ],
    })
    const merged = mergePulsePayload(previous, incoming)
    expect(merged.games).toHaveLength(2)
    expect(merged.games?.find(game => game.gameName === 'A')?.durationSeconds).toBe(900)
    expect(merged.games?.find(game => game.gameName === 'C')).toBeUndefined()
  })

  it('preserves rollup/fullRollup/peak/game array refs when content is unchanged', () => {
    const rollups = [
      { offsetSeconds: 60, chatCount: 10, sevenTvEmoteCount: 2 },
      { offsetSeconds: 120, chatCount: 12, sevenTvEmoteCount: 3 },
    ]
    const fullRollups = [
      { offsetSeconds: 0, chatCount: 1, sevenTvEmoteCount: 0 },
      ...rollups,
    ]
    const peaks = [{ offsetSeconds: 120, score: 4, reasons: ['chat_spike'], dominantSignal: 'chat' as const }]
    const games = [{ gameName: 'Just Chatting', offsetSeconds: 0, durationSeconds: 120 }]
    const coverage = {
      state: 'live' as const,
      coverageStartOffsetSeconds: 0,
      coverageEndOffsetSeconds: 120,
      hasFullStreamCoverage: true,
      hasGaps: false,
      canBackfill: false,
      message: 'ok',
    }
    const previous = basePayload({
      rollups,
      fullRollups,
      peaks,
      games,
      coverage,
      peakEmotePerMin: 9,
      peakViewers: 1000,
    })
    const incoming = basePayload({
      // Fresh arrays with identical content (simulates a no-op poll clone).
      rollups: rollups.map(r => ({ ...r })),
      fullRollups: fullRollups.map(r => ({ ...r })),
      peaks: peaks.map(p => ({ ...p, reasons: [...p.reasons] })),
      games: games.map(g => ({ ...g })),
      coverage: { ...coverage },
      peakEmotePerMin: 9,
      peakViewers: 1000,
    })

    const merged = mergePulsePayload(previous, incoming)
    expect(merged.rollups).toBe(previous.rollups)
    expect(merged.fullRollups).toBe(previous.fullRollups)
    expect(merged.peaks).toBe(previous.peaks)
    expect(merged.games).toBe(previous.games)
    expect(merged.coverage).toBe(previous.coverage)
  })

  it('returns previous payload object when merge is a full no-op', () => {
    const previous = basePayload({
      rollups: [{ offsetSeconds: 60, chatCount: 10, sevenTvEmoteCount: 2 }],
      fullRollups: [{ offsetSeconds: 60, chatCount: 10, sevenTvEmoteCount: 2 }],
      currentOffsetSeconds: 60,
    })
    const incoming = basePayload({
      rollups: [{ offsetSeconds: 60, chatCount: 10, sevenTvEmoteCount: 2 }],
      fullRollups: [{ offsetSeconds: 60, chatCount: 10, sevenTvEmoteCount: 2 }],
      currentOffsetSeconds: 60,
    })
    const merged = mergePulsePayload(previous, incoming)
    expect(merged).toBe(previous)
  })

  it('does not discard newly hydrated emote or game identity metadata', () => {
    const previous = basePayload({
      topEmotes: [{ id: 'local-1', name: 'LO', provider: 'seventv', count: 4 }],
      games: [{ gameName: 'Just Chatting', offsetSeconds: 0, durationSeconds: 60 }],
    })
    const incoming = basePayload({
      topEmotes: [{
        id: 'local-1',
        name: 'LO',
        provider: 'seventv',
        providerEmoteId: 'provider-1',
        imageUrl: 'https://cdn.streampulse.stream/emotes/provider-1.webp',
        count: 4,
      }],
      games: [{
        gameName: 'Just Chatting',
        categoryId: '509658',
        boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/509658_IGDB-210x280.jpg',
        offsetSeconds: 0,
        durationSeconds: 60,
      }],
    })

    const merged = mergePulsePayload(previous, incoming)
    expect(merged.topEmotes?.[0]?.providerEmoteId).toBe('provider-1')
    expect(merged.games?.[0]?.categoryId).toBe('509658')
  })
})
