/**
 * Report sibling `file:` package dependencies as an RPR-6 blocker.
 * This is intentionally separate from RPR-2 ZIP artifact hygiene.
 *
 * Scans root + portal package.json (and lockfiles when present) without
 * exposing private filesystem paths beyond the recorded package spec.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const PACKAGE_JSON_PATHS = Object.freeze([
  'package.json',
  'streampulse-web/package.json',
])

const LOCKFILE_PATHS = Object.freeze([
  'package-lock.json',
  'streampulse-web/package-lock.json',
])

export function findSiblingFileDependencies(pkgJson = null, opts = {}) {
  if (pkgJson) {
    return collectFromPackageJson(pkgJson, opts.label ?? 'inline')
  }
  const hits = []
  for (const rel of PACKAGE_JSON_PATHS) {
    const full = join(root, rel)
    if (!existsSync(full)) continue
    const pkg = JSON.parse(readFileSync(full, 'utf8'))
    hits.push(...collectFromPackageJson(pkg, rel))
  }
  for (const rel of LOCKFILE_PATHS) {
    const full = join(root, rel)
    if (!existsSync(full)) continue
    hits.push(...collectFromLockfile(full, rel))
  }
  return hits
}

function collectFromPackageJson(pkg, label) {
  const hits = []
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const block = pkg[section] ?? {}
    for (const [name, spec] of Object.entries(block)) {
      const value = String(spec ?? '')
      if (value.startsWith('file:') && (value.includes('..') || value.includes('streampulse-backend'))) {
        hits.push({ source: label, section, name, spec: redactSpec(value) })
      }
    }
  }
  return hits
}

function collectFromLockfile(fullPath, label) {
  const hits = []
  let lock
  try {
    lock = JSON.parse(readFileSync(fullPath, 'utf8'))
  } catch {
    return hits
  }
  const packages = lock.packages ?? {}
  for (const [pkgPath, meta] of Object.entries(packages)) {
    const resolved = String(meta?.resolved ?? meta?.version ?? '')
    if (resolved.startsWith('file:') && (resolved.includes('..') || resolved.includes('streampulse-backend'))) {
      hits.push({
        source: label,
        section: 'packages',
        name: pkgPath || '(root)',
        spec: redactSpec(resolved),
      })
    }
  }
  return hits
}

/** Keep relative file: specs; strip absolute Windows/Unix private prefixes if present. */
function redactSpec(spec) {
  return String(spec)
    .replace(/file:[A-Za-z]:\\[^\n]*/gi, 'file:<redacted-absolute>')
    .replace(/file:\/Users\/[^\n]*/g, 'file:<redacted-absolute>')
    .replace(/file:\/home\/[^\n]*/g, 'file:<redacted-absolute>')
}

function main() {
  const hits = findSiblingFileDependencies()
  if (hits.length === 0) {
    console.log('check-public-source-readiness: ok (no sibling file: deps)')
    return
  }
  console.log('check-public-source-readiness: RPR-6 blocker — sibling file: dependencies remain:')
  for (const hit of hits) {
    console.log(`  [${hit.source}] ${hit.section} ${hit.name}=${hit.spec}`)
  }
  console.log(
    'RPR-2 artifact validation does not claim to solve the RPR-6 clean-source / public package boundary.',
  )
  // Non-zero so CI surfaces the debt, but packaging scripts call this as advisory.
  process.exitCode = 2
}

const entry = process.argv[1] ? process.argv[1].replace(/\\/g, '/') : ''
if (entry.endsWith('check-public-source-readiness.mjs')) {
  main()
}
