import { describe, expect, it } from 'vitest'
import {
  buildReactionLaneGeometry,
  findReactionMomentAtPlotX,
} from '../src/reactionLane.ts'

describe('reaction lane geometry', () => {
  const xForOffset = (offset: number) => 10 + offset

  it('preserves refined onset/apex and uses declared precision for equal points', () => {
    const [bar] = buildReactionLaneGeometry({
      moments: [{
        offsetSeconds: 600,
        reactionOnsetOffsetSeconds: 608,
        reactionApexOffsetSeconds: 608,
        seekOffsetSeconds: 605,
        precisionSeconds: 1,
        refinementStatus: 'refined',
        reactionScore: 91,
        reason: '<emote burst>',
      }],
      plotLeft: 10,
      plotWidth: 900,
      bandTop: 0,
      bandBottom: 100,
      xForOffset,
    })
    expect(bar?.startSeconds).toBe(608)
    expect(bar?.endSeconds).toBe(609)
    expect(bar?.durationSeconds).toBe(1)
    expect(bar?.moment.seekOffsetSeconds).toBe(605)
    expect(bar?.reason).toBe('<emote burst>')
    expect(bar?.refined).toBe(true)
    expect(bar?.width).toBe(1)
    expect(bar?.hitWidth).toBe(6)
    expect(bar?.y).toBe(93)
    expect(bar?.height).toBe(7)
    expect(bar?.color).toBe('#34d399')
  })

  it('keeps coarse fallback as a minute window and hit-tests it', () => {
    const geometry = buildReactionLaneGeometry({
      moments: [{ offsetSeconds: 120, score: 50, refinementStatus: 'unavailable' }],
      plotLeft: 10,
      plotWidth: 900,
      bandTop: 0,
      bandBottom: 100,
      xForOffset,
    })
    expect(geometry[0]?.durationSeconds).toBe(60)
    expect(geometry[0]?.y).toBe(93)
    expect(geometry[0]?.height).toBe(7)
    expect(findReactionMomentAtPlotX(geometry, 145)?.moment.offsetSeconds).toBe(120)
    // A distant click must not silently pin a marker at the nearest chart edge.
    expect(findReactionMomentAtPlotX(geometry, 1000)).toBeNull()
  })

  it('caps invalid or excessive moments before SVG geometry', () => {
    const geometry = buildReactionLaneGeometry({
      moments: Array.from({ length: 50 }, (_, index) => ({
        offsetSeconds: index * 60,
        reactionScore: 200,
        durationSeconds: 99_999,
      })),
      plotLeft: 0,
      plotWidth: 500,
      bandTop: 0,
      bandBottom: 100,
      xForOffset,
      maxMoments: 12,
    })
    expect(geometry.length).toBeGreaterThan(0)
    expect(geometry.length).toBeLessThanOrEqual(12)
    expect(Math.max(...geometry.map(item => item.score))).toBe(100)
    expect(Math.max(...geometry.map(item => item.durationSeconds))).toBeLessThanOrEqual(3600)
  })

  it('uses fixed-height reason colors without encoding score as height', () => {
    const geometry = buildReactionLaneGeometry({
      moments: [
        { offsetSeconds: 0, reactionScore: 20, reason: 'chat_burst' },
        { offsetSeconds: 60, reactionScore: 90, reason: 'viewer_surge' },
        { offsetSeconds: 120, reactionScore: 55, reason: 'mixed' },
      ],
      plotLeft: 10,
      plotWidth: 900,
      bandTop: 92,
      bandBottom: 100,
      xForOffset,
    })

    expect(geometry.map(item => item.height)).toEqual([7, 7, 7])
    expect(geometry.map(item => item.y)).toEqual([93, 93, 93])
    expect(geometry.map(item => item.color)).toEqual([
      '#a78bfa',
      '#22d3ee',
      '#f59e0b',
    ])
  })
})
