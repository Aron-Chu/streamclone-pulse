import { describe, expect, it } from 'vitest'
import {
  emoteActivityInRollups,
  pruneUnavailableEmoteSelections,
  toggleEmotePlotKeys,
} from '../src/ui/chatActivityEmotes.ts'
import type { ExtensionEmote, ExtensionRollup } from '../src/shared/messages.ts'

function emote(name: string, count: number, id = name): ExtensionEmote {
  return { id, name, count, provider: 'seventv' }
}

function rollup(offsetSeconds: number, topEmotes: ExtensionEmote[], missing = false): ExtensionRollup {
  return { offsetSeconds, chatCount: 10, topEmotes, missing }
}

describe('emoteActivityInRollups', () => {
  it('returns loading when rollups are empty or flagged loading', () => {
    const target = emote('KEKW', 100)
    expect(emoteActivityInRollups([], target)).toBe('loading')
    expect(emoteActivityInRollups([rollup(0, [target])], target, { loading: true })).toBe('loading')
    expect(emoteActivityInRollups([rollup(0, [target], true)], target)).toBe('loading')
  })

  it('returns none when usable minutes exist but counts are zero', () => {
    const target = emote('KEKW', 0)
    const other = emote('LUL', 40)
    expect(emoteActivityInRollups([rollup(0, [other]), rollup(60, [other])], target)).toBe('none')
  })

  it('returns active when any minute has a non-zero count', () => {
    const target = emote('KEKW', 12)
    const other = emote('LUL', 40)
    expect(
      emoteActivityInRollups([rollup(0, [other]), rollup(60, [target]), rollup(120, [other])], target),
    ).toBe('active')
  })
})

describe('pruneUnavailableEmoteSelections', () => {
  it('drops selections with no activity in the window and keeps plottable ones', () => {
    const kek = emote('KEKW', 12)
    const lul = emote('LUL', 40)
    const catalog = [kek, lul]
    const keys = [
      'seventv:KEKW:KEKW',
      'seventv:LUL:LUL',
      'seventv:GONE:GONE',
    ]
    const next = pruneUnavailableEmoteSelections(keys, catalog, [
      rollup(0, [lul]),
      rollup(60, [lul]),
    ])
    expect(next).toEqual(['seventv:LUL:LUL'])
  })

  it('preserves selections while rollups are still loading', () => {
    const kek = emote('KEKW', 12)
    const keys = ['seventv:KEKW:KEKW']
    expect(pruneUnavailableEmoteSelections(keys, [kek], [], { loading: true })).toEqual(keys)
  })
})

describe('toggleEmotePlotKeys', () => {
  it('caps at six selections', () => {
    const keys = ['a', 'b', 'c', 'd', 'e', 'f']
    expect(toggleEmotePlotKeys(keys, 'g', 6)).toEqual(keys)
    expect(toggleEmotePlotKeys(keys, 'c', 6)).toEqual(['a', 'b', 'd', 'e', 'f'])
  })
})
