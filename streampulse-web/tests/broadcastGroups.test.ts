import { describe, expect, it } from 'vitest'
import { groupMomentsByBroadcast, loadedDetectionPositions } from '../src/lib/broadcastGroups'
import type { DiscoveryMoment } from '../src/lib/discoveryMoments'

function moment(overrides: Partial<DiscoveryMoment> & { streamId: string; offsetSeconds: number }): DiscoveryMoment {
  return {
    key: `${overrides.login ?? 'ohnepixel'}:${overrides.streamId}:${overrides.offsetSeconds}`,
    login: 'ohnepixel',
    label: 'Emote spike',
    provenance: 'hub',
    ...overrides,
  }
}

describe('groupMomentsByBroadcast', () => {
  it('keeps two broadcasts on the same day distinct', () => {
    const groups = groupMomentsByBroadcast([
      moment({ streamId: 'a', offsetSeconds: 60, at: 3_000 }),
      moment({ streamId: 'b', offsetSeconds: 60, at: 9_000 }),
      moment({ streamId: 'a', offsetSeconds: 120, at: 4_000 }),
    ])
    expect(groups).toHaveLength(2)
    expect(groups.map(group => group.streamId)).toEqual(['a', 'b'])
    expect(groups[0].loadedCount).toBe(2)
    expect(groups[1].loadedCount).toBe(1)
  })

  it('does not merge the same stream id across different creators', () => {
    const groups = groupMomentsByBroadcast([
      moment({ streamId: '123', offsetSeconds: 60, at: 1_000 }),
      moment({ streamId: '123', offsetSeconds: 60, at: 2_000, login: 'someone_else' }),
    ])
    expect(groups).toHaveLength(2)
  })

  it('orders broadcasts by earliest loaded detection and detections by offset', () => {
    const groups = groupMomentsByBroadcast([
      moment({ streamId: 'late', offsetSeconds: 300, at: 50_000 }),
      moment({ streamId: 'early', offsetSeconds: 900, at: 10_000 }),
      moment({ streamId: 'early', offsetSeconds: 120, at: 20_000 }),
    ])
    expect(groups.map(group => group.streamId)).toEqual(['early', 'late'])
    expect(groups[0].moments.map(item => item.offsetSeconds)).toEqual([120, 900])
    expect(groups[0].firstOffsetSeconds).toBe(120)
    expect(groups[0].lastOffsetSeconds).toBe(900)
  })

  it('collects every category a broadcast was seen in, without duplicates', () => {
    const groups = groupMomentsByBroadcast([
      moment({ streamId: 'a', offsetSeconds: 60, category: 'Counter-Strike 2' }),
      moment({ streamId: 'a', offsetSeconds: 120, category: 'Just Chatting' }),
      moment({ streamId: 'a', offsetSeconds: 180, category: 'Counter-Strike 2' }),
    ])
    expect(groups[0].categories).toEqual(['Counter-Strike 2', 'Just Chatting'])
  })

  it('leaves missing times unavailable and sorts those broadcasts last', () => {
    const groups = groupMomentsByBroadcast([
      moment({ streamId: 'untimed', offsetSeconds: 60 }),
      moment({ streamId: 'timed', offsetSeconds: 60, at: 5_000 }),
    ])
    expect(groups.map(group => group.streamId)).toEqual(['timed', 'untimed'])
    expect(groups[1].firstAt).toBeUndefined()
    expect(groups[1].lastAt).toBeUndefined()
  })
})

describe('loadedDetectionPositions', () => {
  it('places detections across the loaded span', () => {
    const [group] = groupMomentsByBroadcast([
      moment({ streamId: 'a', offsetSeconds: 0 }),
      moment({ streamId: 'a', offsetSeconds: 50 }),
      moment({ streamId: 'a', offsetSeconds: 100 }),
    ])
    expect(loadedDetectionPositions(group)).toEqual([0, 0.5, 1])
  })

  it('returns nothing when the loaded span has no width', () => {
    const [single] = groupMomentsByBroadcast([moment({ streamId: 'a', offsetSeconds: 60 })])
    expect(loadedDetectionPositions(single)).toEqual([])

    const [sameOffset] = groupMomentsByBroadcast([
      moment({ streamId: 'a', offsetSeconds: 60, at: 1 }),
      moment({ streamId: 'a', offsetSeconds: 60, at: 2 }),
    ])
    expect(loadedDetectionPositions(sameOffset)).toEqual([])
  })
})
