import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  formatAgo,
  formatLiftRatio,
  formatLiftWords,
  formatMomentOffset,
  formatSavedAt,
  streamEdgeLabel,
} from '../src/momentWords.ts'

describe('shared moment words', () => {
  it('writes time into the stream as h:mm:ss with an unpadded hour', () => {
    assert.equal(formatMomentOffset(0), '0:00:00')
    assert.equal(formatMomentOffset(720), '0:12:00')
    assert.equal(formatMomentOffset(2533), '0:42:13')
    assert.equal(formatMomentOffset(5400), '1:30:00')
    assert.equal(formatMomentOffset(36_061.9), '10:01:01')
    assert.equal(formatMomentOffset(-5), '0:00:00')
    assert.equal(formatMomentOffset(Number.NaN), '0:00:00')
  })

  it('names the opening and closing edges', () => {
    assert.equal(streamEdgeLabel('opening'), 'Stream start')
    assert.equal(streamEdgeLabel('closing'), 'Stream end')
  })

  it('words strength one way', () => {
    assert.equal(formatLiftRatio(6.24), '6.2')
    assert.equal(formatLiftRatio(5), '5.0')
    assert.equal(formatLiftRatio(10.4), '10')
    assert.equal(formatLiftRatio(9.94), '9.9')
    assert.equal(formatLiftRatio(9.96), '10')
    assert.equal(formatLiftRatio(9.99), '10')
    assert.equal(formatLiftRatio(Number.NaN), '0')
    assert.equal(formatLiftWords(6.2, 'emotes'), '6.2× more emotes')
    assert.equal(formatLiftWords(12, 'chat'), '12× more chat')
  })

  it('floors ago to the minute', () => {
    const now = new Date(2026, 10, 13, 15, 0, 0).getTime()
    assert.equal(formatAgo(now - 20_000, now), 'just now')
    assert.equal(formatAgo(now - 13 * 60_000 - 50_000, now), '13 min ago')
    assert.equal(formatAgo(now - 59 * 60_000 - 59_000, now), '59 min ago')
    assert.match(formatAgo(now - 2 * 3_600_000, now), /^1:00\s?PM$/)
    assert.match(formatAgo(now - 20 * 3_600_000, now), /^Yesterday 7:00\s?PM$/)
    assert.match(formatAgo(new Date(2026, 10, 10, 13, 5).getTime(), now), /^Nov 10, 1:05\s?PM$/)
  })

  it('writes saved dates without seconds', () => {
    const at = new Date(2026, 10, 13, 0, 37, 23).getTime()
    const text = formatSavedAt(at)
    assert.ok(text.length > 0)
    assert.doesNotMatch(text, /:23/)
    assert.equal(formatSavedAt(new Date(at).toISOString()), text)
    assert.equal(formatSavedAt('not a date'), '')
  })
})
