import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  formatMomentClock,
  reactionAnalyticalOffset,
  reactionLeadInOffset,
} from '../src/reactionIdentity.ts'

describe('reaction identity and playback offsets', () => {
  it('uses refined onset for analytical display while preserving second precision', () => {
    const point = {
      offsetSeconds: 600,
      reactionOnsetOffsetSeconds: 623,
      reactionApexOffsetSeconds: 629,
      precisionSeconds: 1,
    }

    assert.equal(reactionAnalyticalOffset(point), 623)
    assert.equal(formatMomentClock(point), '00:10:23')
  })

  it('seeks five seconds before a refined onset', () => {
    assert.equal(
      reactionLeadInOffset({
        offsetSeconds: 600,
        reactionOnsetOffsetSeconds: 623,
        precisionSeconds: 1,
      }, 5),
      618,
    )
  })

  it('honors an earlier backend seek target when it gives enough context', () => {
    assert.equal(
      reactionLeadInOffset({
        offsetSeconds: 600,
        reactionOnsetOffsetSeconds: 623,
        seekOffsetSeconds: 610,
        precisionSeconds: 1,
      }),
      610,
    )
  })

  it('keeps coarse moments approximate and uses their coarse lead-in', () => {
    const point = { offsetSeconds: 600, reactionOnsetOffsetSeconds: 623 }
    assert.equal(formatMomentClock(point), '~00:10')
    assert.equal(reactionLeadInOffset(point), 595)
  })
})
