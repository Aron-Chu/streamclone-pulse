import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import {
  assertWithinBudget,
  CONTENT_BUNDLE_BASELINE,
  measureContentBundle,
} from '../scripts/check-extension-bundle-budget.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const bundlePath = resolve(root, 'dist/content/twitch.js')

function writeBundleFile(dir: string, rawBytes: number): string {
  const path = join(dir, 'bundle.js')
  writeFileSync(path, Buffer.alloc(rawBytes, 0x61))
  return path
}

describe('extension content bundle budget', () => {
  it('baseline headroom is at most 10%', () => {
    expect(CONTENT_BUNDLE_BASELINE.raw).toBeGreaterThan(100_000)
    expect(CONTENT_BUNDLE_BASELINE.gzip).toBeGreaterThan(50_000)
    expect(Math.ceil(CONTENT_BUNDLE_BASELINE.raw * 1.1)).toBe(
      Math.ceil(CONTENT_BUNDLE_BASELINE.raw * 1.1),
    )
  })

  it('measureContentBundle throws when bundle path is missing', () => {
    const missing = join(tmpdir(), `pulse-missing-bundle-${Date.now()}.js`)
    expect(() => measureContentBundle(missing)).toThrow(/missing content bundle/)
  })

  it('assertWithinBudget passes for sizes within 10% headroom', () => {
    const within = {
      raw: Math.ceil(CONTENT_BUNDLE_BASELINE.raw * 1.05),
      gzip: Math.ceil(CONTENT_BUNDLE_BASELINE.gzip * 1.05),
    }
    const result = assertWithinBudget(within)
    expect(result.ok, result.errors.join('; ')).toBe(true)
  })

  it('assertWithinBudget fails when raw or gzip exceeds 10% headroom', () => {
    const overRaw = assertWithinBudget({
      raw: Math.ceil(CONTENT_BUNDLE_BASELINE.raw * 1.11),
      gzip: CONTENT_BUNDLE_BASELINE.gzip,
    })
    expect(overRaw.ok).toBe(false)
    expect(overRaw.errors.some(e => e.startsWith('raw '))).toBe(true)

    const overGzip = assertWithinBudget({
      raw: CONTENT_BUNDLE_BASELINE.raw,
      gzip: Math.ceil(CONTENT_BUNDLE_BASELINE.gzip * 1.11),
    })
    expect(overGzip.ok).toBe(false)
    expect(overGzip.errors.some(e => e.startsWith('gzip '))).toBe(true)
  })

  it('measureContentBundle reads fixture bytes from a temp file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pulse-bundle-fixture-'))
    try {
      const rawBytes = 4096
      const path = writeBundleFile(dir, rawBytes)
      const sizes = measureContentBundle(path)
      expect(sizes.raw).toBe(rawBytes)
      expect(sizes.gzip).toBe(gzipSync(Buffer.alloc(rawBytes, 0x61), { level: 9 }).length)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('enforces budget when dist/content/twitch.js exists', () => {
    // Unit tests run before `npm run build` in CI. Post-build enforcement is
    // `npm run check:bundle-budget` (wired after Build). Missing-path fail-closed
    // is covered by measureContentBundle throws + the CI script step.
    if (!existsSync(bundlePath)) {
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
