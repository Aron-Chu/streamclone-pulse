import { describe, expect, it } from 'vitest'
import { RECAP_PIN_GAP, recapPinHeads } from '../src/ui/recapPins.ts'

const marker = (offsetSeconds: number, x: number) => ({ peak: { offsetSeconds }, x })

describe('recap chart pins', () => {
  it('numbers the top three by rank and leaves the rest as dots on their minute', () => {
    const markers = [marker(600, 40), marker(1200, 100), marker(1800, 160), marker(2400, 220), marker(3000, 280)]
    // Best first: 2400, then 600, then 3000.
    expect(recapPinHeads(markers, [2400, 600, 3000], 8, 392)).toEqual([
      { n: 2, x: 40 },
      { n: 0, x: 100 },
      { n: 0, x: 160 },
      { n: 1, x: 220 },
      { n: 3, x: 280 },
    ])
  })

  it('numbers only the top moments it has, and none without them', () => {
    const markers = [marker(600, 40), marker(1200, 100)]
    expect(recapPinHeads(markers, [1200], 8, 392).map(head => head.n)).toEqual([0, 1])
    expect(recapPinHeads(markers, [], 8, 392).map(head => head.n)).toEqual([0, 0])
    expect(recapPinHeads([], [600], 8, 392)).toEqual([])
  })

  it('fans close numbered pins out sideways in time order, a gap apart', () => {
    const markers = [marker(600, 200), marker(660, 204), marker(720, 207)]
    const heads = recapPinHeads(markers, [660, 600, 720], 8, 392)
    expect(heads.map(head => head.n)).toEqual([2, 1, 3])
    expect(heads.map(head => head.x)).toEqual([200, 200 + RECAP_PIN_GAP, 200 + 2 * RECAP_PIN_GAP])
  })

  it('leaves numbered pins that are far enough apart where they are, and dots never move', () => {
    const markers = [marker(600, 100), marker(630, 102), marker(900, 140), marker(1200, 300)]
    expect(recapPinHeads(markers, [600, 900, 1200], 8, 392)).toEqual([
      { n: 1, x: 100 },
      { n: 0, x: 102 },
      { n: 2, x: 140 },
      { n: 3, x: 300 },
    ])
  })

  it('keeps fanned pins inside the chart, backing off the right edge and clear of the left', () => {
    const right = recapPinHeads([marker(10_000, 388), marker(10_060, 390), marker(10_120, 392)], [10_000, 10_060, 10_120], 8, 392)
    expect(right.map(head => head.x)).toEqual([392 - 2 * RECAP_PIN_GAP, 392 - RECAP_PIN_GAP, 392])
    const left = recapPinHeads([marker(0, 2), marker(60, 4)], [0, 60], 8, 392)
    expect(left.map(head => head.x)).toEqual([8, 8 + RECAP_PIN_GAP])
  })
})
