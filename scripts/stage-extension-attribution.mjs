/**
 * Stage Apache LICENSE + NOTICE attribution files into extension dist/
 * so store/development ZIPs carry required notices with exact source bytes.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Relative paths copied into dist/ (dest → source under repo root). */
export const EXTENSION_ATTRIBUTION_FILES = Object.freeze([
  { dest: 'LICENSE', source: 'LICENSE' },
  { dest: 'NOTICE', source: 'NOTICE' },
  { dest: 'third-party-notices.txt', source: 'packages/NOTICE' },
])

/**
 * @param {string} [distDir]
 * @param {string} [repoRoot]
 */
export function stageExtensionAttribution(distDir = join(root, 'dist'), repoRoot = root) {
  mkdirSync(distDir, { recursive: true })
  /** @type {Array<{ dest: string, source: string, bytes: number }>} */
  const staged = []
  for (const entry of EXTENSION_ATTRIBUTION_FILES) {
    const src = join(repoRoot, entry.source)
    if (!existsSync(src)) {
      throw new Error(`stage-extension-attribution: missing source ${entry.source}`)
    }
    const dest = join(distDir, entry.dest)
    copyFileSync(src, dest)
    staged.push({
      dest: entry.dest,
      source: entry.source,
      bytes: readFileSync(src).length,
    })
  }
  return staged
}

/**
 * Validate dist/ attribution files are byte-identical to repo sources.
 * @param {string} [distDir]
 * @param {string} [repoRoot]
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
export function validateExtensionAttributionBytes(
  distDir = join(root, 'dist'),
  repoRoot = root,
) {
  /** @type {string[]} */
  const errors = []
  for (const entry of EXTENSION_ATTRIBUTION_FILES) {
    const src = join(repoRoot, entry.source)
    const dest = join(distDir, entry.dest)
    if (!existsSync(src)) {
      errors.push(`missing source ${entry.source}`)
      continue
    }
    if (!existsSync(dest)) {
      errors.push(`REQUIRED: dist/${entry.dest} missing (attribution mandatory)`)
      continue
    }
    const srcBuf = readFileSync(src)
    const destBuf = readFileSync(dest)
    if (!srcBuf.equals(destBuf)) {
      errors.push(`REQUIRED: dist/${entry.dest} bytes differ from ${entry.source}`)
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors }
}

function main() {
  const staged = stageExtensionAttribution()
  for (const s of staged) {
    console.log(`staged dist/${s.dest} from ${s.source} (${s.bytes} bytes)`)
  }
}

const entry = process.argv[1] ? process.argv[1].replace(/\\/g, '/') : ''
if (entry.endsWith('stage-extension-attribution.mjs')) {
  main()
}
