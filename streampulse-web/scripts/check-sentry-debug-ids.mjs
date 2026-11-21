#!/usr/bin/env node
// The Sentry Vite plugin stamps each JS chunk with a debug ID ("sentry-dbid-…").
// A chunk without one has frames Sentry cannot map back to source, so the
// production deploy checks every non-empty chunk, not only the entry bundle.
// CSS, fonts and images carry no debug ID and are not checked. The source-map
// half runs inside the Sentry-enabled build (sentrySourceMapGatePlugin), before
// the plugin deletes the maps it uploaded.
//
// Usage: node scripts/check-sentry-debug-ids.mjs [dist/assets]
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const JS_CHUNK = /\.(?:m|c)?js$/
const DEBUG_ID = /sentry-dbid-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

function listJsChunks(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listJsChunks(path))
    else if (JS_CHUNK.test(entry.name)) out.push(path)
  }
  return out
}

/** Every JS chunk under `assetsDir`, and the ones (relative paths) without a Sentry debug ID. */
export function findChunksWithoutDebugIds(assetsDir) {
  if (!existsSync(assetsDir)) throw new Error(`no assets folder at ${assetsDir}`)
  const chunks = listJsChunks(assetsDir)
  if (chunks.length === 0) throw new Error(`no JS chunks in ${assetsDir}`)
  const missing = chunks
    .filter((path) => {
      const code = readFileSync(path, 'utf8')
      // The plugin leaves an empty chunk unstamped; a stamp is the prefix plus a UUID.
      return code.trim().length > 0 && !DEBUG_ID.test(code)
    })
    .map((path) => relative(assetsDir, path).replaceAll('\\', '/'))
  return { checked: chunks.length, missing }
}

/** Throws unless every JS chunk under `assetsDir` has a debug ID; returns a one-line summary. */
export function assertEveryChunkHasDebugId(assetsDir) {
  const { checked, missing } = findChunksWithoutDebugIds(assetsDir)
  if (missing.length > 0) {
    throw new Error(`${missing.length} of ${checked} JS chunks have no Sentry debug ID: ${missing.join(', ')}`)
  }
  return `Sentry debug IDs in ${checked} of ${checked} JS chunks`
}

/**
 * Vite never writes a source map for its own preload helper (a generated
 * module with no source): a plain build and a Sentry-stamped build both leave
 * `assets/preload-helper-<hash>.js` without a `.map`, while every other chunk
 * has one. It is the one chunk the map check lets through, so its stack frames
 * stay unmapped in Sentry.
 */
export const SOURCE_MAP_EXEMPT_CHUNK = /(?:^|\/)preload-helper-[\w-]+\.js$/

/**
 * Stamped JS chunks in a Vite/Rollup bundle without their `.map` asset.
 * Runs on the in-memory bundle: the Sentry plugin deletes the maps from disk
 * after its upload (filesToDeleteAfterUpload), so a check after the build
 * would never see them.
 */
export function findStampedChunksWithoutMaps(bundle) {
  return Object.values(bundle)
    .filter((file) => file.type === 'chunk' && DEBUG_ID.test(file.code ?? ''))
    .map((chunk) => chunk.fileName)
    .filter((fileName) => !(`${fileName}.map` in bundle) && !SOURCE_MAP_EXEMPT_CHUNK.test(fileName))
}

/** Fails a Sentry-enabled build when a stamped chunk has no source map to upload. */
export function sentrySourceMapGatePlugin() {
  return {
    name: 'streampulse-sentry-source-map-gate',
    apply: 'build',
    generateBundle(_options, bundle) {
      const missing = findStampedChunksWithoutMaps(bundle)
      if (missing.length > 0) {
        const count = missing.length === 1 ? '1 stamped JS chunk has' : `${missing.length} stamped JS chunks have`
        this.error(`${count} no source map: ${missing.join(', ')}`)
      }
    },
  }
}

// Real paths on both sides, so a run through a symlink or junction still counts as the CLI.
const ranAsCli = Boolean(process.argv[1]) && existsSync(process.argv[1])
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
if (ranAsCli) {
  const assetsDir = resolve(process.argv[2] ?? join(fileURLToPath(new URL('..', import.meta.url)), 'dist', 'assets'))
  try {
    console.log(assertEveryChunkHasDebugId(assetsDir))
  } catch (error) {
    console.error(`check-sentry-debug-ids: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
