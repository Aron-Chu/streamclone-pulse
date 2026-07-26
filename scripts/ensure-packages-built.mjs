/**
 * Ensure in-repo @streampulse packages have built dist/ that satisfies every
 * package.json main/types/module/exports target (JS, .d.ts, and CSS).
 * Used by portal/extension typecheck before consuming package exports.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

export const PACKAGE_DIRS = Object.freeze([
  'packages/pulse-core',
  'packages/pulse-charts',
  'packages/analytics-console',
])

/**
 * Collect concrete filesystem targets required by package.json fields.
 * Wildcard export keys (`./*`) expand against existing dist/*.js files.
 * @param {string} pkgDir
 * @param {Record<string, unknown>} pkgJson
 * @returns {string[]} absolute paths that must exist
 */
export function collectRequiredExportTargets(pkgDir, pkgJson) {
  /** @type {Set<string>} */
  const targets = new Set()

  const addRel = (rel) => {
    if (!rel || typeof rel !== 'string') return
    if (rel.includes('*')) return
    const cleaned = rel.replace(/^\.\//, '')
    targets.add(join(pkgDir, cleaned))
  }

  const addExportValue = (value) => {
    if (!value) return
    if (typeof value === 'string') {
      addRel(value)
      return
    }
    if (typeof value === 'object') {
      for (const v of Object.values(value)) addExportValue(v)
    }
  }

  addRel(typeof pkgJson.main === 'string' ? pkgJson.main : null)
  addRel(typeof pkgJson.module === 'string' ? pkgJson.module : null)
  addRel(typeof pkgJson.types === 'string' ? pkgJson.types : null)
  addRel(typeof pkgJson.typings === 'string' ? pkgJson.typings : null)

  const exportsField = pkgJson.exports
  if (exportsField && typeof exportsField === 'object') {
    for (const [key, value] of Object.entries(exportsField)) {
      if (key.includes('*')) {
        // Expand `./*` against dist/*.js (paired .d.ts checked below).
        const distDir = join(pkgDir, 'dist')
        if (existsSync(distDir)) {
          for (const name of listJsFiles(distDir)) {
            const relJs = relative(pkgDir, name).replace(/\\/g, '/')
            addRel(`./${relJs}`)
            addRel(`./${relJs.replace(/\.js$/, '.d.ts')}`)
          }
        } else {
          // Dist missing — force rebuild via a sentinel.
          targets.add(join(pkgDir, 'dist', 'index.js'))
          targets.add(join(pkgDir, 'dist', 'index.d.ts'))
        }
        continue
      }
      addExportValue(value)
    }
  }

  // CSS at package root referenced by exports must exist even before build.
  if (exportsField && typeof exportsField === 'object') {
    for (const value of Object.values(exportsField)) {
      collectCssStrings(value, (cssRel) => addRel(cssRel))
    }
  }

  return [...targets]
}

/**
 * @param {unknown} value
 * @param {(rel: string) => void} visit
 */
function collectCssStrings(value, visit) {
  if (typeof value === 'string') {
    if (/\.css$/i.test(value)) visit(value)
    return
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectCssStrings(v, visit)
  }
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function listJsFiles(dir) {
  /** @type {string[]} */
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...listJsFiles(full))
      continue
    }
    if (entry.isFile() && entry.name.endsWith('.js')) out.push(full)
  }
  return out
}

/**
 * @param {string} pkgRel
 * @returns {{ ok: true, missing: string[] } | { ok: false, missing: string[], pkgJson?: Record<string, unknown> }}
 */
export function auditPackageExportTargets(pkgRel) {
  const pkgDir = join(root, pkgRel)
  const pkgPath = join(pkgDir, 'package.json')
  if (!existsSync(pkgPath)) {
    return { ok: false, missing: [pkgPath] }
  }
  const pkgJson = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const required = collectRequiredExportTargets(pkgDir, pkgJson)
  const missing = required.filter((p) => {
    try {
      return !existsSync(p) || !statSync(p).isFile()
    } catch {
      return true
    }
  })
  return missing.length === 0
    ? { ok: true, missing: [] }
    : { ok: false, missing, pkgJson }
}

function buildPackages() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const result = spawnSync(npm, ['run', 'build:packages'], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) {
    console.error('ensure-packages-built: build:packages failed')
    process.exit(result.status ?? 1)
  }
}

function main() {
  const initiallyMissing = []
  for (const pkgRel of PACKAGE_DIRS) {
    const audit = auditPackageExportTargets(pkgRel)
    if (!audit.ok) {
      initiallyMissing.push({
        pkgRel,
        missing: audit.missing.map((p) => relative(root, p).replace(/\\/g, '/')),
      })
    }
  }

  if (initiallyMissing.length === 0) {
    console.log('ensure-packages-built: all exported JS/.d.ts/CSS targets present')
    return
  }

  console.log(
    `ensure-packages-built: missing targets in ${initiallyMissing
      .map((m) => m.pkgRel)
      .join(', ')}; running build:packages`,
  )
  for (const m of initiallyMissing) {
    for (const rel of m.missing.slice(0, 8)) {
      console.log(`  missing ${rel}`)
    }
    if (m.missing.length > 8) console.log(`  … +${m.missing.length - 8} more`)
  }

  buildPackages()

  for (const pkgRel of PACKAGE_DIRS) {
    const audit = auditPackageExportTargets(pkgRel)
    if (!audit.ok) {
      console.error(`ensure-packages-built: still missing exports for ${pkgRel}:`)
      for (const p of audit.missing) {
        console.error(`  ${relative(root, p).replace(/\\/g, '/')}`)
      }
      process.exit(1)
    }
  }
  console.log('ensure-packages-built: rebuild satisfied all export targets')
}

const entry = process.argv[1] ? process.argv[1].replace(/\\/g, '/') : ''
if (entry.endsWith('ensure-packages-built.mjs')) {
  main()
}
