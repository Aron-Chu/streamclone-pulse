/**
 * Report sibling `file:` package dependencies that escape this repository (RPR-6).
 * This is intentionally separate from RPR-2 ZIP artifact hygiene.
 *
 * Scans root + portal + packages workspaces (and lockfiles when present).
 * In-repo `file:packages/*` and portal `file:../packages/*` MUST pass.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const rootResolved = resolve(root)

const PACKAGE_JSON_PATHS = Object.freeze([
  'package.json',
  'streampulse-web/package.json',
  'packages/pulse-core/package.json',
  'packages/pulse-charts/package.json',
  'packages/analytics-console/package.json',
])

const LOCKFILE_PATHS = Object.freeze([
  'package-lock.json',
  'streampulse-web/package-lock.json',
])

export function findSiblingFileDependencies(pkgJson = null, opts = {}) {
  if (pkgJson) {
    return collectFromPackageJson(pkgJson, opts.label ?? 'inline', opts.baseDir ?? root)
  }
  const hits = []
  for (const rel of PACKAGE_JSON_PATHS) {
    const full = join(root, rel)
    if (!existsSync(full)) continue
    const pkg = JSON.parse(readFileSync(full, 'utf8'))
    hits.push(...collectFromPackageJson(pkg, rel, dirname(full)))
  }
  for (const rel of LOCKFILE_PATHS) {
    const full = join(root, rel)
    if (!existsSync(full)) continue
    hits.push(...collectFromLockfile(full, rel, dirname(full)))
  }
  return hits
}

/**
 * True when a file: spec resolves outside this repo or names streampulse-backend.
 * @param {string} spec
 * @param {string} baseDir directory containing the package.json / lockfile
 */
export function isEscapingFileDependency(spec, baseDir = root) {
  const value = String(spec ?? '')
  if (!value.startsWith('file:')) return false
  const raw = value.slice('file:'.length)
  if (raw.includes('streampulse-backend') || value.includes('streampulse-backend')) {
    return true
  }
  if (isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith('\\\\')) {
    return true
  }
  const resolved = resolve(baseDir, raw)
  const rel = relative(rootResolved, resolved)
  if (!rel || rel === '') return false
  if (isAbsolute(rel) || rel.split(/[/\\]/).includes('..')) {
    return true
  }
  return false
}

function collectFromPackageJson(pkg, label, baseDir) {
  const hits = []
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const block = pkg[section] ?? {}
    for (const [name, spec] of Object.entries(block)) {
      const value = String(spec ?? '')
      if (value.startsWith('file:') && isEscapingFileDependency(value, baseDir)) {
        hits.push({ source: label, section, name, spec: redactSpec(value) })
      }
    }
  }
  return hits
}

function collectFromLockfile(fullPath, label, baseDir) {
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
    if (resolved.startsWith('file:') && isEscapingFileDependency(resolved, baseDir)) {
      hits.push({
        source: label,
        section: 'packages',
        name: pkgPath || '(root)',
        spec: redactSpec(resolved),
      })
    }
    // Lock keys that are relative paths to linked packages (npm file: protocol)
    const norm = String(pkgPath || '').replace(/\\/g, '/')
    if (
      norm &&
      (norm.includes('streampulse-backend') || norm.includes('..')) &&
      isEscapingFileDependency(`file:${norm}`, baseDir)
    ) {
      hits.push({
        source: label,
        section: 'packages',
        name: pkgPath || '(root)',
        spec: redactSpec(`file:${norm}`),
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
  const seen = new Set()
  const unique = []
  for (const hit of hits) {
    const key = `${hit.source}|${hit.section}|${hit.name}|${hit.spec}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(hit)
  }
  if (unique.length === 0) {
    console.log('check-public-source-readiness: ok (no escaping sibling file: deps)')
    return
  }
  console.log('check-public-source-readiness: RPR-6 blocker — escaping file: dependencies remain:')
  for (const hit of unique) {
    console.log(`  [${hit.source}] ${hit.section} ${hit.name}=${hit.spec}`)
  }
  console.log(
    'RPR-2 artifact validation does not claim to solve the RPR-6 clean-source / public package boundary.',
  )
  process.exitCode = 2
}

const entry = process.argv[1] ? process.argv[1].replace(/\\/g, '/') : ''
if (entry.endsWith('check-public-source-readiness.mjs')) {
  main()
}
