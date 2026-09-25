import assert from 'node:assert/strict'
import test from 'node:test'
import { measurementTimeIso, measurementTimeMs } from '../src/measurementTime.ts'

const now = Date.parse('2026-09-04T12:00:00Z')
test('measurement time rejects zero, malformed, sentinel and future values', () => {
  for (const value of [undefined, null, '', 'bad-date', '0001-01-01T00:00:00Z', 0, Infinity, now + 300_001]) {
    assert.equal(measurementTimeMs(value, now), null, String(value))
    assert.equal(measurementTimeIso(value, now), undefined)
  }
})
test('measurement time preserves real historical observations and bounded clock skew', () => {
  assert.equal(measurementTimeMs('2020-06-01T00:00:00Z', now), Date.parse('2020-06-01T00:00:00Z'))
  assert.equal(measurementTimeMs(now + 300_000, now), now + 300_000)
  assert.equal(measurementTimeIso(now, now), '2026-09-04T12:00:00.000Z')
})
