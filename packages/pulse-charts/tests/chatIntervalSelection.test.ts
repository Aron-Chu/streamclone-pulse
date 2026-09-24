import { describe, expect, it } from 'vitest'
import { chatIntervalSelectionFromActivityBar } from '../src/chatIntervalSelection.ts'

describe('PulseMultiSignalChart.chatSelectionUsesCanonicalAnchor', () => {
  it('uses explicit bounds and the disclosed peak as the host pin, never the interval center', () => {
    const offsets = [1200, 1260, 1320, 1380, 1440, 1500, 1560, 1620, 1680, 1740]
    const selection = chatIntervalSelectionFromActivityBar({
      startIndex: 0,
      endExclusive: 10,
      average: 22,
      peak: { index: 2, value: 90 },
      observedCount: 10,
      rangeLength: 10,
      offsetForIndex: (index) => offsets[index],
    })
    expect(selection.kind).toBe('chat_interval')
    expect(selection.startOffsetSeconds).toBe(1200)
    expect(selection.endOffsetSeconds).toBe(1800)
    expect(selection.anchorOffsetSeconds).toBe(1320)
    expect(selection.anchorOffsetSeconds).not.toBe((1200 + 1800) / 2)
    expect(selection.startOffsetSeconds).not.toBe(1500)
  })
})
