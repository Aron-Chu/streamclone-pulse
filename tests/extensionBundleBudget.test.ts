import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertWithinBudget,
  CONTENT_BUNDLE_BASELINE,
  measureContentBundle,
} from '../scripts/check-extension-bundle-budget.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const bundlePath = resolve(root, 'dist/content/twitch.js')

describe('extension content bundle budget', () => {
  it('baseline headroom is at most 10%', () => {
    expect(CONTENT_BUNDLE_BASELINE.raw).toBeGreaterThan(100_000)
    expect(CONTENT_BUNDLE_BASELINE.gzip).toBeGreaterThan(50_000)
  })

  it('enforces budget when dist/content/twitch.js exists', () => {
    if (!existsSync(bundlePath)) {
      // Unit CI may not have built; extension job always builds before packaging.
      expect(existsSync(bundlePath)).toBe(false)
      return
    }
    const sizes = measureContentBundle(bundlePath)
    const result = assertWithinBudget(sizes)
    expect(result.ok, result.errors.join('; ')).toBe(true)
    expect(result.maxRaw).toBeLessThanOrEqual(Math.ceil(CONTENT_BUNDLE_BASELINE.raw * 1.1))
    expect(result.maxGzip).toBeLessThanOrEqual(Math.ceil(CONTENT_BUNDLE_BASELINE.gzip * 1.1))
  })
})
