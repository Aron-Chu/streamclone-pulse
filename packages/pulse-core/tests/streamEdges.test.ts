import assert from 'node:assert/strict'
import test from 'node:test'
import {
  extensionPayloadStreamEdges,
  extensionRollupStreamEdges,
} from '../src/extensionAdapters.ts'
import { mergeRecapMoments } from '../src/recapMoments.ts'
import {
  compareStreamEdgeLast,
  momentStreamEdge,
  OPENING_STREAM_EDGE,
  streamEdgeKind,
  streamEdgesFor,
  withStreamEdges,
} from '../src/streamEdges.ts'

// The same cases as the backend's TestStreamEdges (internal/analytics/heatmap).
test('streamEdgeKind marks the first 5 and, once ended, the last 10 minutes', () => {
  const ended = streamEdgesFor(3600, true)
  assert.equal(streamEdgeKind(ended, 0), 'opening')
  assert.equal(streamEdgeKind(ended, 299), 'opening')
  assert.equal(streamEdgeKind(ended, 300), undefined)
  assert.equal(streamEdgeKind(ended, 3000), undefined)
  assert.equal(streamEdgeKind(ended, 3001), 'closing')
  assert.equal(streamEdgeKind(ended, 3600), 'closing')
})

test('a live stream, or one with no data, has no closing edge', () => {
  assert.equal(streamEdgeKind(streamEdgesFor(3600, false), 3500), undefined)
  assert.equal(streamEdgeKind(streamEdgesFor(-1, true), 3500), undefined)
  assert.equal(streamEdgeKind(OPENING_STREAM_EDGE, 3500), undefined)
  assert.equal(streamEdgeKind(OPENING_STREAM_EDGE, 120), 'opening')
})

test('a stream shorter than its closing edge only has the opening edge', () => {
  // Last data at 09:00: the closing edge would start before the stream did.
  const short = streamEdgesFor(540, true)
  assert.equal(streamEdgeKind(short, 420), undefined)
})

test('the backend flag wins over the offset', () => {
  assert.equal(momentStreamEdge({ offsetSeconds: 1800, streamEdge: 'closing' }, OPENING_STREAM_EDGE), 'closing')
  assert.equal(momentStreamEdge({ offsetSeconds: 60, streamEdge: '' }, OPENING_STREAM_EDGE), 'opening')
  assert.equal(momentStreamEdge({ offsetSeconds: 1800 }, OPENING_STREAM_EDGE), undefined)
})

test('withStreamEdges tags moments and keeps unchanged ones as they are', () => {
  const plain = { offsetSeconds: 1800, score: 50 }
  const hello = { offsetSeconds: 30, score: 90 }
  const [kept, tagged] = withStreamEdges([plain, hello], OPENING_STREAM_EDGE)
  assert.equal(kept, plain)
  assert.equal(tagged?.streamEdge, 'opening')
  assert.equal('streamEdge' in hello, false)
})

test('compareStreamEdgeLast sorts edge moments after the rest, then by score', () => {
  const moments = withStreamEdges(
    [
      { offsetSeconds: 60, score: 99 },
      { offsetSeconds: 3500, score: 98 },
      { offsetSeconds: 1800, score: 40 },
      { offsetSeconds: 900, score: 60 },
    ],
    streamEdgesFor(3600, true),
  )
  const order = [...moments]
    .sort((a, b) => compareStreamEdgeLast(a, b) || b.score - a.score)
    .map(moment => moment.offsetSeconds)
  assert.deepEqual(order, [900, 1800, 60, 3500])
})

test('extensionRollupStreamEdges ends at the last minute with chat or emotes', () => {
  const rollups = [
    { offsetSeconds: 0, chatCount: 10 },
    { offsetSeconds: 2400, chatCount: 0, sevenTvEmoteCount: 4 },
    { offsetSeconds: 2460, chatCount: 0, sevenTvEmoteCount: 0, viewerCount: 900 },
    { offsetSeconds: 3000, chatCount: 50, missing: true },
  ]
  assert.deepEqual(extensionRollupStreamEdges(rollups, true), streamEdgesFor(2400, true))
  assert.deepEqual(extensionRollupStreamEdges(rollups, false), OPENING_STREAM_EDGE)
  assert.deepEqual(extensionRollupStreamEdges([], true), OPENING_STREAM_EDGE)
})

test('extensionPayloadStreamEdges prefers the full timeline and needs the stream ended', () => {
  const rollups = [{ offsetSeconds: 600, chatCount: 5 }]
  const fullRollups = [{ offsetSeconds: 600, chatCount: 5 }, { offsetSeconds: 3600, chatCount: 5 }]
  assert.deepEqual(extensionPayloadStreamEdges({ isLive: false, rollups, fullRollups }), streamEdgesFor(3600, true))
  assert.deepEqual(extensionPayloadStreamEdges({ isLive: false, rollups, fullRollups: [] }), streamEdgesFor(600, true))
  assert.deepEqual(extensionPayloadStreamEdges({ isLive: true, rollups, fullRollups }), OPENING_STREAM_EDGE)
})

test('mergeRecapMoments ranks a hello spike last, even with the top score', () => {
  const merged = mergeRecapMoments(
    {
      topMoments: [
        { offsetSeconds: 60, score: 99, chatCount: 300 },
        { offsetSeconds: 1800, score: 60, chatCount: 120 },
      ],
    },
    undefined,
    10,
    true,
  )
  assert.deepEqual(merged.map(moment => [moment.offsetSeconds, moment.streamEdge]), [[1800, undefined], [60, 'opening']])
})

test('mergeRecapMoments ranks a goodbye spike last only once the stream ended', () => {
  const recap = {
    topMoments: [
      { offsetSeconds: 3540, score: 99, chatCount: 300 },
      { offsetSeconds: 1800, score: 60, chatCount: 120 },
    ],
  }
  const ended = mergeRecapMoments(recap, undefined, 10, true, streamEdgesFor(3600, true))
  assert.deepEqual(ended.map(moment => [moment.offsetSeconds, moment.streamEdge]), [[1800, undefined], [3540, 'closing']])
  const live = mergeRecapMoments(recap, undefined, 10, true)
  assert.deepEqual(live.map(moment => moment.offsetSeconds), [3540, 1800])
})

test('mergeRecapMoments keeps a backend edge flag through dedupe', () => {
  const merged = mergeRecapMoments(
    {
      topMoments: [
        { offsetSeconds: 1500, score: 70, streamEdge: 'closing' },
        { offsetSeconds: 900, score: 50 },
      ],
    },
    [{ offsetSeconds: 1502, score: 99 }],
    10,
    false,
  )
  assert.deepEqual(merged.map(moment => [moment.offsetSeconds, moment.streamEdge]), [[900, undefined], [1502, 'closing']])
})
