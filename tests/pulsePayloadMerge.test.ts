import { describe, expect, it } from 'vitest'
import { mergePulsePayload } from '../src/background/pulsePayloadMerge.ts'
import type { ExtensionPeak, PulsePayload, PulseStreamRecap } from '../src/shared/messages.ts'

type AuditedPeak = ExtensionPeak & {
  reactionScore?: number
  viewerMomentumScore?: number
  refinementStatus?: string
  refinementConfidence?: number
  reactionScoringVersion?: string
}

function basePayload(overrides: Partial<PulsePayload> = {}): PulsePayload {
  return {
    login: 'xqc',
    isLive: true,
    tracking: true,
    streamId: 'stream-1',
    vodId: null,
    startedAt: '2026-08-19T10:00:00Z',
    currentOffsetSeconds: 3600,
    rollups: [],
    lanes: { composite: [], chat: [], seventv: [] },
    recap: null,
    ...overrides,
  }
}

function recap(overrides: Partial<PulseStreamRecap> = {}): PulseStreamRecap {
  return {
    streamId: 'stream-1',
    login: 'xqc',
    durationSeconds: 3600,
    totalMessages: 100,
    peakChatPerMin: 20,
    topMoments: [{ offsetSeconds: 120, score: 10, reasons: ['chat_spike'] }],
    topEmotes: [{ code: 'LUL', count: 5 }],
    clipCandidates: [{ offsetSeconds: 120, score: 10, reasons: ['chat_spike'] }],
    ...overrides,
  }
}

describe('mergePulsePayload', () => {
  it('returns the incoming payload unchanged when there is no previous payload', () => {
    const incoming = basePayload({
      rollups: [{ offsetSeconds: 60, chatCount: 10, sevenTvEmoteCount: 2 }],
    })

    expect(mergePulsePayload(null, incoming)).toBe(incoming)
  })

  it('accepts authoritative shorter and empty server lists', () => {
    const previous = basePayload({
      rollups: [
        { offsetSeconds: 60, chatCount: 10, sevenTvEmoteCount: 2 },
        { offsetSeconds: 120, chatCount: 20, sevenTvEmoteCount: 4 },
      ],
      peaks: [
        { offsetSeconds: 60, score: 8, reasons: ['chat_spike'], dominantSignal: 'chat' },
        { offsetSeconds: 120, score: 7, reasons: ['emote_spike'], dominantSignal: 'emote' },
      ],
      games: [
        { gameName: 'A', offsetSeconds: 0, durationSeconds: 600 },
        { gameName: 'B', offsetSeconds: 600, durationSeconds: 600 },
      ],
      topEmotes: [{ id: '1', name: 'LUL', count: 20 }],
      recap: recap(),
    })
    const incoming = basePayload({
      rollups: [{ offsetSeconds: 120, chatCount: 18, sevenTvEmoteCount: 3 }],
      peaks: [],
      games: [],
      topEmotes: [],
      recap: recap({ topMoments: [], topEmotes: [], clipCandidates: [] }),
    })

    const merged = mergePulsePayload(previous, incoming)
    expect(merged.rollups).toBe(incoming.rollups)
    expect(merged.peaks).toBe(incoming.peaks)
    expect(merged.games).toBe(incoming.games)
    expect(merged.topEmotes).toBe(incoming.topEmotes)
    expect(merged.recap).toEqual(incoming.recap)
  })

  it('accepts authoritative field retractions instead of falling back to previous values', () => {
    const previous = basePayload({
      peaks: [{ offsetSeconds: 60, score: 8, reasons: ['chat_spike'], dominantSignal: 'chat' }],
      games: [{ gameName: 'A', offsetSeconds: 0, durationSeconds: 600 }],
      coverage: {
        state: 'partial_tracking',
        coverageStartOffsetSeconds: 300,
        coverageEndOffsetSeconds: 3600,
        hasFullStreamCoverage: false,
        hasGaps: true,
        canBackfill: true,
        message: 'partial',
      },
      topEmotes: [{ id: '1', name: 'LUL', count: 20 }],
      peakEmotePerMin: 20,
      peakViewers: 10_000,
      recap: recap(),
    })
    const incoming = basePayload()

    const merged = mergePulsePayload(previous, incoming)
    expect(merged.peaks).toBeUndefined()
    expect(merged.games).toBeUndefined()
    expect(merged.coverage).toBeUndefined()
    expect(merged.topEmotes).toBeUndefined()
    expect(merged.peakEmotePerMin).toBeUndefined()
    expect(merged.peakViewers).toBeUndefined()
    expect(merged.recap).toBeNull()
  })

  it('treats all coverage status, retry, source, copy, and missing-range fields as significant', () => {
    const previousCoverage = {
      state: 'missing_ranges_detected' as const,
      coverageStartOffsetSeconds: 0,
      coverageEndOffsetSeconds: 3600,
      hasFullStreamCoverage: false,
      trackedFromStart: true,
      hasGaps: true,
      missingRanges: [{ fromOffsetSeconds: 600, toOffsetSeconds: 900 }],
      canBackfill: true,
      backfillReason: 'vod_available',
      vodStatus: 'available',
      manualRetryAllowed: false,
      chatSource: 'irc',
      chatSourceDetail: 'collector',
      copyKey: 'coverage.partial',
      message: 'partial',
    }
    const incomingCoverage = {
      ...previousCoverage,
      missingRanges: [{ fromOffsetSeconds: 1200, toOffsetSeconds: 1500 }],
      vodStatus: 'resolving',
      manualRetryAllowed: true,
      chatSource: 'vod',
      chatSourceDetail: 'archive',
      copyKey: 'coverage.retry',
    }
    const previous = basePayload({ coverage: previousCoverage })
    const incoming = basePayload({ coverage: incomingCoverage })

    const merged = mergePulsePayload(previous, incoming)
    expect(merged.coverage).toBe(incoming.coverage)
    expect(merged.coverage).toEqual(incomingCoverage)
  })

  it('treats peak counts, emotes, labels, identity, and refinement fields as significant', () => {
    const previousPeak: AuditedPeak = {
      momentId: 'moment-1',
      offsetSeconds: 600,
      reactionOnsetOffsetSeconds: 590,
      reactionApexOffsetSeconds: 605,
      seekOffsetSeconds: 592,
      precisionSeconds: 2,
      score: 15,
      reactionScore: 10,
      viewerMomentumScore: 5,
      refinementStatus: 'coarse',
      refinementConfidence: 0.5,
      reactionScoringVersion: 'v1',
      reasons: ['chat_spike'],
      reasonLabel: 'Chat spike',
      dominantSignal: 'chat',
      chatCount: 100,
      emoteCount: 20,
      topEmotes: [{ id: '1', name: 'LUL', count: 10 }],
    }
    const incomingPeak: AuditedPeak = {
      ...previousPeak,
      momentId: 'moment-2',
      reactionOnsetOffsetSeconds: 588,
      reactionApexOffsetSeconds: 603,
      seekOffsetSeconds: 590,
      precisionSeconds: 1,
      reactionScore: 11,
      viewerMomentumScore: 4,
      refinementStatus: 'refined',
      refinementConfidence: 0.9,
      reactionScoringVersion: 'v2',
      reasonLabel: 'Refined chat spike',
      chatCount: 110,
      emoteCount: 25,
      topEmotes: [{ id: '2', name: 'OMEGALUL', count: 12 }],
    }
    const previous = basePayload({ peaks: [previousPeak] })
    const incoming = basePayload({ peaks: [incomingPeak] })

    const merged = mergePulsePayload(previous, incoming)
    expect(merged.peaks).toBe(incoming.peaks)
    expect(merged.peaks?.[0]).toEqual(incomingPeak)
  })

  it.each([
    ['recap', { recap: recap({ totalMessages: 101 }) }],
    ['mode', { mode: 'live_dvr' }],
    ['provisional', { provisional: true }],
    ['startedAt', { startedAt: '2026-08-19T10:01:00Z' }],
    ['vodId', { vodId: 'vod-1' }],
    ['vodOriginDeltaSeconds', { vodOriginDeltaSeconds: 12 }],
    ['resolutionState', { resolutionState: 'vod_validated' }],
    ['retryable', { retryable: true }],
    ['lanes', { lanes: { composite: [1], chat: [2], seventv: [3], viewers: [4] } }],
  ] satisfies Array<[string, Partial<PulsePayload>]>)('does not hide a changed root %s field', (_field, overrides) => {
    const previous = basePayload({
      mode: 'live',
      provisional: false,
      vodOriginDeltaSeconds: 0,
      resolutionState: 'live_stream_validated',
      retryable: false,
      recap: recap(),
    })
    const incoming = basePayload({
      mode: 'live',
      provisional: false,
      vodOriginDeltaSeconds: 0,
      resolutionState: 'live_stream_validated',
      retryable: false,
      recap: recap(),
      ...overrides,
    })

    const merged = mergePulsePayload(previous, incoming)
    expect(merged).not.toBe(previous)
    expect(merged).toMatchObject(overrides)
  })

  it('retains omitted full history only for the same known activation with recent data', () => {
    const fullRollups = [
      { offsetSeconds: 0, chatCount: 1, sevenTvEmoteCount: 0 },
      { offsetSeconds: 3540, chatCount: 40, sevenTvEmoteCount: 5 },
    ]
    const previous = basePayload({
      vodId: 'vod-1',
      rollups: fullRollups,
      fullRollups,
    })
    const incoming = basePayload({
      vodId: 'vod-1',
      rollups: [{ offsetSeconds: 3540, chatCount: 55, sevenTvEmoteCount: 8 }],
    })

    const merged = mergePulsePayload(previous, incoming)
    expect(merged.rollups).toBe(incoming.rollups)
    expect(merged.fullRollups).toBe(previous.fullRollups)
  })

  it('accepts explicit shorter and empty full-history replacements', () => {
    const previous = basePayload({
      rollups: [{ offsetSeconds: 120, chatCount: 20, sevenTvEmoteCount: 4 }],
      fullRollups: [
        { offsetSeconds: 0, chatCount: 1, sevenTvEmoteCount: 0 },
        { offsetSeconds: 120, chatCount: 20, sevenTvEmoteCount: 4 },
      ],
    })
    const shorter = basePayload({
      rollups: [{ offsetSeconds: 120, chatCount: 18, sevenTvEmoteCount: 3 }],
      fullRollups: [{ offsetSeconds: 120, chatCount: 18, sevenTvEmoteCount: 3 }],
    })
    const empty = basePayload({ rollups: [], fullRollups: [] })

    const shortened = mergePulsePayload(previous, shorter)
    expect(shortened.fullRollups).toBe(shorter.fullRollups)
    expect(mergePulsePayload(shortened, empty).fullRollups).toBe(empty.fullRollups)
  })

  it.each([
    ['stream change', { streamId: 'stream-2' }],
    ['VOD change', { vodId: 'vod-2' }],
    ['login change', { login: 'other' }],
    ['no identity', { streamId: undefined, vodId: null }],
    ['empty recent snapshot', { rollups: [] }],
  ] satisfies Array<[string, Partial<PulsePayload>]>)('does not retain omitted full history across %s', (_case, overrides) => {
    const previous = basePayload({
      vodId: 'vod-1',
      rollups: [{ offsetSeconds: 60, chatCount: 10, sevenTvEmoteCount: 2 }],
      fullRollups: [{ offsetSeconds: 0, chatCount: 1, sevenTvEmoteCount: 0 }],
    })
    const incoming = basePayload({
      vodId: 'vod-1',
      rollups: [{ offsetSeconds: 60, chatCount: 11, sevenTvEmoteCount: 3 }],
      ...overrides,
    })

    expect(mergePulsePayload(previous, incoming).fullRollups).toBeUndefined()
  })

  it('returns the previous payload when complete cloned snapshots are equal', () => {
    const peak: AuditedPeak = {
      offsetSeconds: 120,
      reactionOnsetOffsetSeconds: 115,
      reactionApexOffsetSeconds: 122,
      seekOffsetSeconds: 116,
      precisionSeconds: 2,
      refinementStatus: 'refined',
      refinementConfidence: 0.9,
      reactionScoringVersion: 'v2',
      score: 4,
      reasons: ['chat_spike'],
      reasonLabel: 'Chat spike',
      dominantSignal: 'chat',
      chatCount: 12,
      emoteCount: 3,
      topEmotes: [{ id: '1', name: 'LUL', count: 3 }],
    }
    const previous = basePayload({
      mode: 'live_dvr',
      resolutionState: 'live_stream_validated',
      vodOriginDeltaSeconds: 4,
      rollups: [{ offsetSeconds: 120, chatCount: 12, sevenTvEmoteCount: 3 }],
      fullRollups: [{ offsetSeconds: 120, chatCount: 12, sevenTvEmoteCount: 3 }],
      lanes: { composite: [1], chat: [2], seventv: [3] },
      peaks: [peak],
      coverage: {
        state: 'partial_tracking',
        coverageStartOffsetSeconds: 120,
        coverageEndOffsetSeconds: 120,
        hasFullStreamCoverage: false,
        hasGaps: true,
        missingRanges: [{ fromOffsetSeconds: 0, toOffsetSeconds: 60 }],
        canBackfill: false,
        vodStatus: 'resolving',
        manualRetryAllowed: true,
        chatSource: 'irc',
        copyKey: 'coverage.waiting',
        message: 'waiting',
      },
      recap: recap(),
    })
    const incoming = structuredClone(previous)

    const merged = mergePulsePayload(previous, incoming)
    expect(merged).toBe(previous)
    expect(merged.rollups).toBe(previous.rollups)
    expect(merged.fullRollups).toBe(previous.fullRollups)
    expect(merged.peaks).toBe(previous.peaks)
    expect(merged.coverage).toBe(previous.coverage)
    expect(merged.lanes).toBe(previous.lanes)
  })
})
