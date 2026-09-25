import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatCoveragePercent } from '../src/coveragePercent.ts'
test('only exact complete coverage is labelled 100%', () => {
  assert.equal(formatCoveragePercent(239 / 240 * 100), '99.5%')
  assert.equal(formatCoveragePercent(99.99), '99.9%')
  assert.equal(formatCoveragePercent(100), '100%')
  assert.equal(formatCoveragePercent(0), '0%')
  for (const value of [undefined, null, NaN, Infinity, -1, 101]) assert.equal(formatCoveragePercent(value), 'Unknown')
})
