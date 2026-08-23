import { describe, expect, it } from 'vitest'
import type { ExtensionEmote, ExtensionRollup } from '../src/shared/messages.ts'
import { buildPlottedEmoteMarkerLayout } from '../src/ui/chartEmoteMarkers.ts'

function emote(
  name: string,
  count: number,
  overrides: Partial<ExtensionEmote> = {},
): ExtensionEmote {
  return { name, count, ...overrides }
}

function rollup(
  offsetSeconds: number,
  topEmotes: ExtensionEmote[] = [],
  missing = false,
): ExtensionRollup {
  return {
    offsetSeconds,
    chatCount: 0,
    sevenTvEmoteCount: 0,
    topEmotes,
    missing,
  }
}

describe('buildPlottedEmoteMarkerLayout', () => {
  it('returns an empty bounded layout for empty data or no drawable width', () => {
    expect(buildPlottedEmoteMarkerLayout([], { pixelWidth: 320 })).toEqual({
      markers: [],
      totalCount: 0,
      totalEventCount: 0,
      hiddenMarkerCount: 0,
    })
    expect(
      buildPlottedEmoteMarkerLayout(
        [rollup(0, [emote('KEKW', 3)])],
        { pixelWidth: 0 },
      ),
    ).toEqual({
      markers: [],
      totalCount: 0,
      totalEventCount: 0,
      hiddenMarkerCount: 0,
    })
  })

  it('merges provider aliases by stable identity while preserving aggregate totals', () => {
    const layout = buildPlottedEmoteMarkerLayout(
      [
        rollup(0, [
          emote(' KEKW ', 2, { id: 'e1', provider: '7TV' }),
          emote('LUL', 4, { id: 'other', provider: 'twitch' }),
        ]),
        rollup(20, [emote('KEKW', 3, { id: 'e1', provider: 'seventv' })]),
      ],
      { pixelWidth: 56, markerSpacingPx: 28 },
    )

    expect(layout.totalCount).toBe(9)
    expect(layout.totalEventCount).toBe(3)
    expect(layout.markers).toHaveLength(2)

    const kekw = layout.markers.find(marker => marker.name === 'KEKW')
    expect(kekw).toMatchObject({
      id: 'e1',
      provider: 'seventv',
      count: 5,
      eventCount: 2,
      offsetSeconds: 0,
      timestampMs: 0,
      xFraction: 0.25,
      lane: 0,
      key: 'seventv:e1:kekw@0',
    })
    expect(kekw?.clusteredNames).toEqual(['KEKW', 'LUL'])
  })

  it('places markers at deterministic cell centers across an explicit viewport domain', () => {
    const layout = buildPlottedEmoteMarkerLayout(
      [
        rollup(0, [emote('START', 1)]),
        rollup(300, [emote('MIDDLE', 2)]),
        rollup(600, [emote('END', 3)]),
      ],
      {
        pixelWidth: 100,
        markerSpacingPx: 20,
        fromOffsetSeconds: 0,
        toOffsetSeconds: 600,
      },
    )

    expect(layout.markers.map(marker => [marker.name, marker.xFraction])).toEqual([
      ['START', 0.1],
      ['MIDDLE', 0.5],
      ['END', 0.9],
    ])
    expect(layout.markers.find(marker => marker.name === 'END')?.timestampMs).toBe(600_000)
  })

  it('uses deterministic collision lanes and counts hidden dense markers without hiding totals', () => {
    const layout = buildPlottedEmoteMarkerLayout(
      [
        rollup(0, [
          emote('HIGH', 10, { id: 'high', provider: '7tv' }),
          emote('MID', 5, { id: 'mid', provider: '7tv' }),
          emote('LOW', 1, { id: 'low', provider: '7tv' }),
        ]),
      ],
      { pixelWidth: 28, markerSpacingPx: 28, maxLanes: 2 },
    )

    expect(layout.totalCount).toBe(16)
    expect(layout.totalEventCount).toBe(3)
    expect(layout.hiddenMarkerCount).toBe(1)
    expect(layout.markers.map(marker => [marker.name, marker.count, marker.lane])).toEqual([
      ['HIGH', 10, 0],
      ['MID', 5, 1],
    ])
    expect(layout.markers[0]?.clusteredNames).toEqual(['HIGH', 'MID', 'LOW'])
  })

  it('caps visual markers by deterministic priority while retaining all aggregate counts', () => {
    const layout = buildPlottedEmoteMarkerLayout(
      [
        rollup(0, [emote('LOW', 1)]),
        rollup(60, [emote('HIGH', 10)]),
        rollup(120, [emote('MEDIUM', 5)]),
      ],
      {
        pixelWidth: 60,
        markerSpacingPx: 20,
        fromOffsetSeconds: 0,
        toOffsetSeconds: 180,
        maxMarkers: 2,
      },
    )

    expect(layout.totalCount).toBe(16)
    expect(layout.totalEventCount).toBe(3)
    expect(layout.hiddenMarkerCount).toBe(1)
    expect(layout.markers.map(marker => marker.name)).toEqual(['HIGH', 'MEDIUM'])
  })

  it('ignores missing, non-positive, blank, and non-finite entries without producing invalid positions', () => {
    const layout = buildPlottedEmoteMarkerLayout(
      [
        rollup(0, [
          emote('VALID', 2),
          emote('NAN', Number.NaN),
          emote('ZERO', 0),
          emote('NEGATIVE', -1),
          emote('   ', 9),
        ]),
        rollup(60, [emote('MISSING', 20)], true),
        rollup(Number.NaN, [emote('INVALID OFFSET', 20)]),
      ],
      { pixelWidth: 100 },
    )

    expect(layout.totalCount).toBe(2)
    expect(layout.totalEventCount).toBe(1)
    expect(layout.markers).toHaveLength(1)
    expect(layout.markers[0]?.name).toBe('VALID')
    expect(Number.isFinite(layout.markers[0]?.xFraction)).toBe(true)
  })
})
