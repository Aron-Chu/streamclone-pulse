import { describe, expect, it } from 'vitest'
import type { LiveHeatPoint } from '@streampulse/pulse-core'
import { gameAtOffset, minutePictureView, momentPictureView } from '../src/ui/momentPicture.ts'

function point(fields: Partial<LiveHeatPoint>): LiveHeatPoint {
  return {
    minuteTs: '2026-10-16T00:10:00Z',
    offsetSeconds: 600,
    score: 1,
    estimated: false,
    reason: 'chat_spike',
    reasonLabel: 'Chat spike',
    chatCount: 10,
    emoteCount: 5,
    topEmotes: [],
    collecting: false,
    ...fields,
  }
}

const games = [
  { gameName: 'Just Chatting', categoryId: '509658', offsetSeconds: 0, durationSeconds: 1_800 },
  { gameName: 'Minecraft', categoryId: '27471', offsetSeconds: 1_800, durationSeconds: 900 },
]

describe('moment pictures', () => {
  it('a moment with second-level timing peaks just before chat reacted', () => {
    expect(momentPictureView('card', point({ reactionOnsetOffsetSeconds: 630, precisionSeconds: 5 })))
      .toEqual({ kind: 'card', from: 610, to: 660, peak: 627 })
  })

  it('a minute-level moment covers its minute, peaking in the middle', () => {
    expect(momentPictureView('thumb', point({ reactionOnsetOffsetSeconds: 630 })))
      .toEqual({ kind: 'thumb', from: 590, to: 660, peak: 630 })
    expect(minutePictureView('card', 600)).toEqual(momentPictureView('card', point({})))
  })

  it('names the game on screen at an offset, with its box art', () => {
    expect(gameAtOffset(games, 100)).toEqual({ name: 'Just Chatting', art: expect.stringContaining('509658') })
    expect(gameAtOffset(games, 1_900)).toEqual({ name: 'Minecraft', art: expect.stringContaining('27471') })
  })

  it('the latest game covers a live stream past its last known duration', () => {
    expect(gameAtOffset(games, 9_000)?.name).toBe('Minecraft')
  })

  it('names nothing in a gap between games, before the first, or without games', () => {
    const gap = [
      { gameName: 'Just Chatting', offsetSeconds: 0, durationSeconds: 600 },
      { gameName: 'Minecraft', offsetSeconds: 1_200, durationSeconds: 600 },
    ]
    expect(gameAtOffset(gap, 900)).toBeUndefined()
    expect(gameAtOffset([{ gameName: 'Minecraft', offsetSeconds: 60, durationSeconds: 600 }], 30)).toBeUndefined()
    expect(gameAtOffset(undefined, 30)).toBeUndefined()
  })
})
