import { describe, expect, it } from 'vitest'
import {
  SELECTED_MOMENT_CARD_EXIT_MS,
  nextPinnedCardHold,
} from '../src/ui/pinnedCardExit.ts'

const point = { offsetSeconds: 60 }

describe('nextPinnedCardHold', () => {
  it('keeps the last card and marks exit so remove can animate', () => {
    expect(
      nextPinnedCardHold({
        incoming: null,
        held: point,
        exiting: false,
        reducedMotion: false,
      }),
    ).toEqual({ held: point, exiting: true })
  })

  it('cancels exit when a new minute pins during the fade', () => {
    const next = { offsetSeconds: 120 }
    expect(
      nextPinnedCardHold({
        incoming: next,
        held: point,
        exiting: true,
        reducedMotion: false,
      }),
    ).toEqual({ held: next, exiting: false })
  })

  it('unmounts immediately when motion is reduced', () => {
    expect(
      nextPinnedCardHold({
        incoming: null,
        held: point,
        exiting: false,
        reducedMotion: true,
      }),
    ).toEqual({ held: null, exiting: false })
  })

  it('matches the card enter duration', () => {
    expect(SELECTED_MOMENT_CARD_EXIT_MS).toBe(180)
  })
})
