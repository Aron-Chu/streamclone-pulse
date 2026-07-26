import { describe, expect, it } from 'vitest'
import {
  channelEmoteCatalogLabel,
  resolveChannelEmoteCatalogHonesty,
} from './channelEmoteCatalogHonesty.ts'
import { MAX_PLOTTED_EMOTES, defaultEmotePlotKeys } from './emotePlotSelection.ts'

describe('nmplol-style degraded empty catalog', () => {
  it('never treats partial/lowConfidence empty as authoritative zero', () => {
    const honesty = resolveChannelEmoteCatalogHonesty({
      partial: true,
      lowConfidence: true,
      totalEmoteUses: 0,
      topEmotes: [],
      providerState: 'unknown',
    })
    expect(honesty).toBe('unavailable')
    expect(channelEmoteCatalogLabel(honesty)).toMatch(/unavailable/i)
  })
})

describe('emote plot six-cap defaults', () => {
  it('auto-selects up to six keys in emotes view', () => {
    const top = Array.from({ length: 8 }, (_, i) => ({ key: `seventv:id${i}:E${i}` }))
    const keys = defaultEmotePlotKeys(top, 'emotes')
    expect(keys.size).toBe(MAX_PLOTTED_EMOTES)
    expect(MAX_PLOTTED_EMOTES).toBe(6)
  })
})
