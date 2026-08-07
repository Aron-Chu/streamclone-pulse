import { describe, expect, it } from 'vitest'
import { chartReadoutValues } from '../src/ui/chartReadout.ts'

describe('chartReadoutValues', () => {
  it('keeps the hovered viewer value alongside chat and emotes', () => {
    expect(
      chartReadoutValues({
        offsetSeconds: 420,
        chatCount: 18,
        sevenTvEmoteCount: 4,
        totalEmoteCount: 7,
        viewerCount: 321,
      }),
    ).toEqual({
      offsetSeconds: 420,
      viewerCount: 321,
      chatCount: 18,
      emoteCount: 7,
    })
  })

  it('does not invent a viewer sample when the rollup omits it', () => {
    expect(
      chartReadoutValues({ offsetSeconds: 60, chatCount: 0, sevenTvEmoteCount: 0 }),
    ).toMatchObject({ viewerCount: null })
    expect(chartReadoutValues(undefined)).toBeNull()
  })

  it('preserves a missing bucket for an honest gap readout', () => {
    expect(
      chartReadoutValues({
        offsetSeconds: 180,
        chatCount: 0,
        sevenTvEmoteCount: 0,
        missing: true,
      }),
    ).toMatchObject({ offsetSeconds: 180, missing: true })
  })
})
