import { describe, expect, it } from 'vitest'
import { MAX_PLOTTED_EMOTES, defaultEmotePlotKeys } from './emotePlotSelection.ts'

describe('emote plot six-cap defaults', () => {
  it('auto-selects up to six keys in emotes view', () => {
    const top = Array.from({ length: 8 }, (_, i) => ({ key: `seventv:id${i}:E${i}` }))
    const keys = defaultEmotePlotKeys(top, 'emotes')
    expect(keys.size).toBe(MAX_PLOTTED_EMOTES)
    expect(MAX_PLOTTED_EMOTES).toBe(6)
  })
})
