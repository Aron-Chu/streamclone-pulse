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
  it.each(['emote_spike', 'twitch_emote_spike', 'seventv_spike', '7tv'])('recognizes the emote detector kind %s', kind => {
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
