#!/usr/bin/env node
/**
 * Enforce content-bundle size budget (raw + gzip).
 * Baseline recorded from the clean shared chart/newsroom production candidate.
 */
import { readFileSync, existsSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const contentBundle = resolve(root, 'dist/content/twitch.js')

/** Accepted baseline (bytes) from clean `npm run build` — headroom ≤10%. */
export const CONTENT_BUNDLE_BASELINE = {
  raw: 563_674,
  gzip: 162_873,
}

const HEADROOM = 1.1

export function measureContentBundle(path = contentBundle) {
  if (!existsSync(path)) {
    throw new Error(`missing content bundle at ${path} — run npm run build first`)
  }
  const rawBuf = readFileSync(path)
  const gzipBuf = gzipSync(rawBuf, { level: 9 })
  return { raw: rawBuf.length, gzip: gzipBuf.length }
}

export function assertWithinBudget(sizes, baseline = CONTENT_BUNDLE_BASELINE, headroom = HEADROOM) {
  const maxRaw = Math.ceil(baseline.raw * headroom)
  const maxGzip = Math.ceil(baseline.gzip * headroom)
  const errors = []
  if (sizes.raw > maxRaw) errors.push(`raw ${sizes.raw} > budget ${maxRaw}`)
  if (sizes.gzip > maxGzip) errors.push(`gzip ${sizes.gzip} > budget ${maxGzip}`)
  return { ok: errors.length === 0, errors, maxRaw, maxGzip }
}

function main() {
  const sizes = measureContentBundle()
  const result = assertWithinBudget(sizes)
  console.log(
    JSON.stringify(
      {
        path: 'dist/content/twitch.js',
        raw: sizes.raw,
        gzip: sizes.gzip,
        baseline: CONTENT_BUNDLE_BASELINE,
        maxRaw: result.maxRaw,
        maxGzip: result.maxGzip,
        ok: result.ok,
      },
      null,
      2,
    ),
  )
  if (!result.ok) {
    for (const e of result.errors) console.error(`bundle-budget: ${e}`)
    process.exit(1)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main()
}
