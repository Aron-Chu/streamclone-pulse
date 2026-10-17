import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeRecapMoments } from '../src/recapMoments.ts'

test('mergeRecapMoments dedupes nearby offsets and keeps higher score', () => {
  const merged = mergeRecapMoments(
    {
      topMoments: [{ offsetSeconds: 120, score: 80, chatCount: 10 }],
      clipCandidates: [{ offsetSeconds: 125, score: 95, chatCount: 12 }],
    },
    undefined,
    10,
    true,
  )
  assert.equal(merged.length, 1)
  assert.equal(merged[0]?.score, 95)
})

test('mergeRecapMoments respects limit', () => {
  const merged = mergeRecapMoments(
    {
      topMoments: [
        { offsetSeconds: 0, score: 90 },
        { offsetSeconds: 300, score: 80 },
        { offsetSeconds: 600, score: 70 },
      ],
    },
    undefined,
    2,
    false,
  )
  assert.equal(merged.length, 2)
})

test('mergeRecapMoments ranks stream-edge moments last and keeps the flag on a duplicate', () => {
  const merged = mergeRecapMoments(
    {
      topMoments: [
        { offsetSeconds: 40_000, score: 99, streamEdge: 'closing' },
        { offsetSeconds: 120, score: 90, streamEdge: 'opening' },
        { offsetSeconds: 6_000, score: 60 },
      ],
      // The same goodbye burst seen again as a clip candidate, without the flag.
      clipCandidates: [{ offsetSeconds: 40_010, score: 120 }],
    },
    undefined,
    10,
    false,
  )
  assert.deepEqual(
    merged.map(moment => [moment.offsetSeconds, moment.streamEdge]),
    [[6_000, undefined], [40_010, 'closing'], [120, 'opening']],
  )
})

test('mergeRecapMoments carries the stream-edge flag from peaks', () => {
  const merged = mergeRecapMoments(
    null,
    [
      { offsetSeconds: 60, score: 99, reasons: ['chat_spike'], streamEdge: 'opening' },
      { offsetSeconds: 3_000, score: 40, reasons: ['chat_spike'] },
    ],
    10,
    false,
  )
  assert.deepEqual(merged.map(moment => moment.offsetSeconds), [3_000, 60])
  assert.equal(merged[1]?.streamEdge, 'opening')
})
