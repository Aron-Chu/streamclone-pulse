#!/usr/bin/env node
/**
 * Enforce content-bundle size budget (raw + gzip).
 * Baseline recorded from the clean parent build immediately before the chart
 * interaction stabilization commit. Keep the 10% headroom gate intact.
 */
import { readFileSync, existsSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const contentBundle = resolve(root, 'dist/content/twitch.js')
const chatBadgesChunk = resolve(root, 'dist/content/chat-badges.js')

/** Accepted parent baseline (bytes) from clean `npm run build` — headroom ≤10%. */
export const CONTENT_BUNDLE_BASELINE = {
  // Accommodates Quick settings panel, appearance preview, theme/density controls, and chart readout band.
  raw: 535_000,
  gzip: 153_000,
}

const HEADROOM = 1.1

/**
 * Seen in chat decorator (content/chat-badges.js): its own cap, separate from
 * twitch.js. It must never be folded into twitch.js, which has no headroom.
 */
export const CHAT_BADGES_CHUNK_MAX_GZIP = 8_000
/** Marker that must never appear in twitch.js (the decorator's class prefix). */
export const CHAT_BADGES_MARKER = 'sp-cb-'

export function checkChatBadgesChunk(chunkPath = chatBadgesChunk, contentPath = contentBundle) {
  if (!existsSync(chunkPath)) return { ok: false, errors: [`missing ${chunkPath} — run npm run build first`] }
  const raw = readFileSync(chunkPath)
  const gzip = gzipSync(raw, { level: 9 }).length
  const errors = []
  if (gzip > CHAT_BADGES_CHUNK_MAX_GZIP) errors.push(`chat-badges.js gzip ${gzip} > cap ${CHAT_BADGES_CHUNK_MAX_GZIP}`)
  if (existsSync(contentPath) && readFileSync(contentPath, 'utf8').includes(CHAT_BADGES_MARKER)) errors.push('twitch.js contains the chat badge decorator')
  return { ok: errors.length === 0, errors, raw: raw.length, gzip, maxGzip: CHAT_BADGES_CHUNK_MAX_GZIP }
}

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
  const chat = checkChatBadgesChunk()
  console.log(JSON.stringify({ path: 'dist/content/chat-badges.js', raw: chat.raw, gzip: chat.gzip, maxGzip: chat.maxGzip, ok: chat.ok }, null, 2))
  if (!result.ok || !chat.ok) {
    for (const e of [...result.errors, ...chat.errors]) console.error(`bundle-budget: ${e}`)
    process.exit(1)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main()
}
