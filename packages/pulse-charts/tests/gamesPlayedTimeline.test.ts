import { describe, expect, it } from 'vitest'
import {
  buildGamesPlayedTimelineSlots,
  resolveGamesPlayedTimelineRange,
} from '../src/gamesPlayedTimeline.ts'

describe('resolveGamesPlayedTimelineRange', () => {
  it('prefers the chart visible window', () => {
    const range = resolveGamesPlayedTimelineRange(
      { startOffset: 127, endOffset: 2287 },
      3600,
      [{ offsetSeconds: 0, durationSeconds: 3600 }],
    )
    expect(range).toEqual({ startOffset: 127, endOffset: 2287 })
  })
})

describe('buildGamesPlayedTimelineSlots', () => {
  it('makes a covering game fill the full chart window', () => {
    const slots = buildGamesPlayedTimelineSlots(
      [{ gameName: 'Just Chatting', offsetSeconds: 0, durationSeconds: 3600 }],
      { startOffset: 127, endOffset: 2287 },
    )
    expect(slots).toHaveLength(1)
    expect(slots[0]?.kind).toBe('segment')
    if (slots[0]?.kind !== 'segment') return
    expect(slots[0].flexGrow).toBe(2287 - 127)
    expect(slots[0].visibleStart).toBe(127)
    expect(slots[0].clipped).toBe(true)
  })

  it('keeps proportional widths and gaps across multiple games', () => {
    const slots = buildGamesPlayedTimelineSlots(
      [
        { gameName: 'A', offsetSeconds: 0, durationSeconds: 600 },
        { gameName: 'B', offsetSeconds: 900, durationSeconds: 900 },
      ],
      { startOffset: 0, endOffset: 1800 },
    )
    expect(slots).toHaveLength(3)
    expect(slots[0]?.kind).toBe('segment')
    expect(slots[1]?.kind).toBe('gap')
    expect(slots[2]?.kind).toBe('segment')
    if (slots[0]?.kind !== 'segment' || slots[1]?.kind !== 'gap' || slots[2]?.kind !== 'segment') return
    expect(slots[0].flexGrow).toBe(600)
    expect(slots[1].flexGrow).toBe(300)
    expect(slots[2].flexGrow).toBe(900)
  })
})
