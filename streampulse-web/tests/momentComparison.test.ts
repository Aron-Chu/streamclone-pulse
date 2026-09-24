import { describe, expect, it } from 'vitest'
import { momentComparisonBadge, momentComparisonSummary, momentReactionSignal } from '../src/lib/momentComparison'
import { fromHubMoment, fromNewsroomUpdate } from '../src/lib/discoveryMoments'
import type { LiveWireMomentComparison } from '../src/lib/liveWire'
import type { NewsroomStory, NewsroomUpdate } from '../src/lib/newsroom'

const comparison = {
  chat: { state: 'ready', currentPerMin: 279, multiplier: 2.1 },
  emotes: { state: 'ready', currentPerMin: 34, multiplier: 7.1 },
} as LiveWireMomentComparison
const row = { login: 'creator', streamId: 'stream1', offsetSeconds: 90, label: 'Emote spike', kind: 'seventv_spike', comparison }

describe('shared moment reaction presentation', () => {
  const at = Date.parse('2026-09-08T17:00:23Z')
  const verified = { ...comparison, eventAt: at, evidence: { ircBound: true, eventRollupAvailable: true } } as LiveWireMomentComparison
  it('uses verified minute counts consistently when detector snapshots differ', () => {
    const recent = fromHubMoment({ ...row, at, chatPerMin: 355, emotesPerMin: 2570, comparison: verified })!
    const session = fromNewsroomUpdate({ id: 's', login: row.login, streamId: row.streamId } as NewsroomStory,
      { headline: row.label, signal: 'emotes', comparison: verified, momentRef: { streamId: row.streamId, offsetSeconds: row.offsetSeconds, occurrenceAt: at } } as NewsroomUpdate)!
    expect([recent.chatPerMin, recent.emotesPerMin]).toEqual([279, 34])
    expect([recent.chatPerMin, recent.emotesPerMin]).toEqual([session.chatPerMin, session.emotesPerMin])
    expect(recent.measurementScope).toBe('verified_minute')
  })
  it('preserves verified zero counts and rejects another minute or missing evidence', () => {
    const zero = { ...verified, chat: { ...verified.chat, currentPerMin: 0 } }
    expect(fromHubMoment({ ...row, at, chatPerMin: 355, comparison: zero })?.chatPerMin).toBe(0)
    for (const unverified of [
      { ...verified, eventAt: at + 60_000 },
      { ...verified, evidence: { ...verified.evidence, eventRollupAvailable: false } },
      { ...verified, chat: { ...verified.chat, currentPerMin: NaN } },
    ]) {
      const result = fromHubMoment({ ...row, at, chatPerMin: 355, comparison: unverified })!
      expect(result.chatPerMin).toBe(355)
      expect(result.measurementScope).toBe('detector_snapshot')
    }
    expect(fromHubMoment({ ...row, at, comparison: { ...verified, eventAt: at + 60_000 } })?.comparison).toBeUndefined()
  })
  it('keeps the same detected signal through the hub adapter and review', () => {
    const moment = fromHubMoment(row)!
    expect(moment.reactionSignal).toBe('emotes')
    expect(momentComparisonSummary(moment.comparison, moment.reactionSignal)).toBe("Emotes 7.1× this stream's earlier average")
    expect(momentComparisonSummary(comparison, momentReactionSignal(row.kind))).toBe(momentComparisonSummary(moment.comparison, moment.reactionSignal))
  })
  it('uses the selected session update signal, never the lead or larger multiplier', () => {
    const story = { id: 'story1', login: 'creator', streamId: 'stream1', primarySignal: 'emotes' } as NewsroomStory
    const update = { headline: 'Selected chat reaction', signal: 'chat', comparison, revision: 3, publishedAt: '2026-09-08T23:25:00Z', momentRef: { streamId: 'stream1', offsetSeconds: 90 } } as NewsroomUpdate
    const moment = fromNewsroomUpdate(story, update)!
    expect(moment.reactionSignal).toBe('chat')
    expect(moment.evidenceAsOf).toBe(update.publishedAt)
    expect(moment.revision).toBe(3)
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

describe('compact comparison badge', () => {
  it('compresses the same signal the headline chose', () => {
    expect(momentComparisonBadge(comparison, 'emotes')).toEqual({ label: 'Emotes', short: '7.1×', long: "Emotes 7.1× this stream's earlier average", belowBaseline: false })
    expect(momentComparisonBadge(comparison, 'chat')).toEqual({ label: 'Chat', short: '2.1×', long: "Chat 2.1× this stream's earlier average", belowBaseline: false })
  })
  it('marks a value under the earlier average as a dip', () => {
    const dip = { ...comparison, chat: { ...comparison.chat, multiplier: 0.14 } } as LiveWireMomentComparison
    expect(momentComparisonBadge(dip, 'chat')).toEqual({ label: 'Chat', short: '0.1×', long: "Chat 0.1× this stream's earlier average", belowBaseline: true })
  })
  it('refuses to compress what cannot be stated in one cell', () => {
    // A percentage or absolute delta has no honest one-cell form, so the row
    // shows its measured rates alone rather than an ambiguous chip.
    const pct = { chat: { state: 'ready', currentPerMin: 100, changePct: 42 } } as LiveWireMomentComparison
    expect(momentComparisonBadge(pct, 'chat')).toBeNull()
    expect(momentComparisonSummary(pct, 'chat')).toBe('Chat +42% versus earlier')
    expect(momentComparisonBadge(undefined, 'chat')).toBeNull()
    expect(momentComparisonBadge({ chat: { state: 'warming', currentPerMin: 10, multiplier: 3 } } as LiveWireMomentComparison)).toBeNull()
  })
  it('names new activity instead of dividing by a zero baseline', () => {
    const fresh = { ...comparison, emotes: { ...comparison.emotes, state: 'new_activity' } } as LiveWireMomentComparison
    expect(momentComparisonBadge(fresh, 'emotes')).toEqual({ label: 'Emotes', short: 'new', long: 'Emotes is new from a zero earlier baseline', belowBaseline: false })
  })
})
