import { describe, expect, it, vi } from 'vitest'
import type { LiveHeatPoint } from '@streampulse/pulse-core'
import { createInspectionPreviewStore, inspectionPreviewIdentity } from '../src/ui/inspectionPreviewStore.ts'
import type { InspectionSelection } from '../src/ui/momentInspection.ts'

function point(offsetSeconds = 120): LiveHeatPoint {
  return {
    minuteTs: '2026-08-16T00:02:00.000Z',
    offsetSeconds,
    score: 42,
    estimated: false,
    reason: 'chat_spike',
    reasonLabel: 'Chat spike',
    chatCount: 100,
    emoteCount: 20,
    topEmotes: [],
    collecting: false,
  }
}

function selection(selectionType: InspectionSelection['selectionType']): InspectionSelection {
  return {
    source: 'chart',
    offsetSeconds: 120,
    bucketOffsetSeconds: 120,
    point: point(),
    selectionType,
    ...(selectionType === 'chat_interval'
      ? { intervalStartSeconds: 120, intervalEndSeconds: 180 }
      : null),
    ...(selectionType === 'emote_peak'
      ? { seriesIdentity: 'aggregate:2' }
      : null),
    ...(selectionType === 'reaction'
      ? { rankedIdentity: 'reaction-7' }
      : null),
  }
}

describe('inspection preview store', () => {
  it('does not deduplicate different typed selections in the same minute', () => {
    const identities = ['minute', 'chat_interval', 'emote_peak', 'reaction']
      .map(type => inspectionPreviewIdentity(selection(type as InspectionSelection['selectionType'])))
    expect(new Set(identities).size).toBe(4)
  })

  it('publishes only the latest identity and clears synchronously before commit', () => {
    const store = createInspectionPreviewStore()
    const listener = vi.fn()
    store.subscribe(listener)

    store.set(selection('minute'))
    store.set(selection('minute'))
    store.set(selection('emote_peak'))
    expect(listener).toHaveBeenCalledTimes(2)
    expect(store.getSnapshot()?.selectionType).toBe('emote_peak')

    store.clear()
    expect(store.getSnapshot()).toBeNull()
    expect(listener).toHaveBeenCalledTimes(3)
  })
})
