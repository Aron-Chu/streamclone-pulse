import { describe, expect, it } from 'vitest'
import { momentComparisonSummary, momentReactionSignal } from '../src/lib/momentComparison'
import { fromHubMoment, fromNewsroomUpdate } from '../src/lib/discoveryMoments'
import type { LiveWireMomentComparison } from '../src/lib/liveWire'
import type { NewsroomStory, NewsroomUpdate } from '../src/lib/newsroom'

const comparison = {
  chat: { state: 'ready', currentPerMin: 279, multiplier: 2.1 },
  emotes: { state: 'ready', currentPerMin: 34, multiplier: 7.1 },
} as LiveWireMomentComparison
const row = { login: 'creator', streamId: 'stream1', offsetSeconds: 90, label: 'Emote spike', kind: 'seventv_spike', comparison }

describe('shared moment reaction presentation', () => {
  const eventAt = Date.parse('2026-09-08T17:00:23Z')
  const verified = { ...comparison, eventAt, evidence: { ircBound: true, eventRollupAvailable: true } } as LiveWireMomentComparison
  it('uses the verified minute for Recent when detector and comparison snapshots differ', () => {
    const recent = fromHubMoment({ ...row, at: eventAt, chatPerMin: 355, emotesPerMin: 2570, comparison: verified })!
    const session = fromNewsroomUpdate({ id: 'story1', login: 'creator', streamId: 'stream1' } as NewsroomStory,
      { headline: row.label, signal: 'emotes', publishedAt: '2026-09-08T17:01:00Z', comparison: verified,
        momentRef: { streamId: 'stream1', offsetSeconds: 90, occurrenceAt: eventAt } } as NewsroomUpdate)!
    expect([recent.chatPerMin, recent.emotesPerMin]).toEqual([279, 34])
    expect([recent.chatPerMin, recent.emotesPerMin]).toEqual([session.chatPerMin, session.emotesPerMin])
    expect(recent.measurementScope).toBe('verified_minute')
    expect(session.evidenceAsOf).toBe('2026-09-08T17:01:00Z')
  })
  it('preserves detector rates when verification is missing or points at another minute', () => {
    for (const comparison of [
      { ...verified, eventAt: eventAt + 60_000 },
      { ...verified, evidence: { ...verified.evidence, eventRollupAvailable: false } },
      { ...verified, chat: { ...verified.chat, currentPerMin: NaN } },
    ]) {
      const result = fromHubMoment({ ...row, at: eventAt, chatPerMin: 355, comparison })!
      expect(result.chatPerMin).toBe(355)
      expect(result.measurementScope).toBe('detector_snapshot')
    }
  })
  it('keeps the same detected signal through the hub adapter and review', () => {
    const moment = fromHubMoment(row)!
    expect(moment.reactionSignal).toBe('emotes')
    expect(momentComparisonSummary(moment.comparison, moment.reactionSignal)).toBe("Emotes 7.1× this stream's earlier average")
    expect(momentComparisonSummary(comparison, momentReactionSignal(row.kind))).toBe(momentComparisonSummary(moment.comparison, moment.reactionSignal))
  })
  it('uses the selected session update signal, never the lead or larger multiplier', () => {
    const story = { id: 'story1', login: 'creator', streamId: 'stream1', primarySignal: 'emotes' } as NewsroomStory
    const update = { headline: 'Selected chat reaction', signal: 'chat', comparison, momentRef: { streamId: 'stream1', offsetSeconds: 90 } } as NewsroomUpdate
    const moment = fromNewsroomUpdate(story, update)!
    expect(moment.reactionSignal).toBe('chat')
    expect(momentComparisonSummary(moment.comparison, moment.reactionSignal)).toBe("Chat 2.1× this stream's earlier average")
  })
  it.each(['emote_spike', 'twitch_emote_spike', 'seventv_spike', '7tv', 'twitch', 'bttv', 'ffz'])('recognizes the emote detector kind %s', kind => {
    expect(momentReactionSignal(kind)).toBe('emotes')
  })
  it('shows available fallback evidence without relabeling it as the primary signal', () => {
    expect(momentComparisonSummary({ ...comparison, emotes: { ...comparison.emotes, state: 'partial' } }, 'emotes')).toBe("Chat 2.1× this stream's earlier average")
    expect(momentComparisonSummary({ ...comparison, emotes: { ...comparison.emotes, state: 'new_activity' } }, 'emotes')).toBe('Emotes is new from a zero earlier baseline')
  })
  it('preserves measured zero and does not render non-finite or unready comparisons', () => {
    expect(momentComparisonSummary({ ...comparison, chat: { ...comparison.chat, currentPerMin: 0, multiplier: 0 } }, 'chat')).toContain('Chat 0.0×')
    expect(momentComparisonSummary({ chat: { state: 'partial', multiplier: 40 }, emotes: { state: 'ready', currentPerMin: NaN, multiplier: Infinity } } as LiveWireMomentComparison)).toBeNull()
    expect(momentReactionSignal('manual')).toBeUndefined()
  })
})
