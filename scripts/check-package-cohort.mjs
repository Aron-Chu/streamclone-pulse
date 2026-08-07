#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, relative, isAbsolute, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_MANIFEST = 'config/local-package-overrides.json'
const LOCAL_PACKAGE_PREFIX = '@streampulse/'

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function git(repoRoot, args) {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

function relativeDisplay(root, path) {
  const value = relative(root, path).replaceAll('\\', '/')
  return value || '.'
}

export function parseFileSpec(spec) {
  if (typeof spec !== 'string' || !spec.startsWith('file:')) return null
  const value = spec.slice('file:'.length)
  if (!value || isAbsolute(value)) return null
  return value
}

export function packageDependencies(packageJson, packageRoot) {
  const fields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
  const found = []
  for (const field of fields) {
    const dependencies = packageJson[field] ?? {}
    for (const [name, spec] of Object.entries(dependencies)) {
      if (!name.startsWith(LOCAL_PACKAGE_PREFIX)) continue
      const relativePath = parseFileSpec(spec)
      if (!relativePath) continue
      found.push({
        name,
        field,
        spec,
        relativePath,
        resolvedPath: resolve(packageRoot, relativePath),
      })
    }
  }
  return found
}

function sourceInfo(sourceRoot, packageRoots = []) {
  const commit = git(sourceRoot, ['rev-parse', 'HEAD']) || 'unknown'
  const branch = git(sourceRoot, ['branch', '--show-current']) || 'detached'
  const status = git(sourceRoot, ['status', '--porcelain=v1', '--untracked-files=all'])
  let stamp = null
  const stampPath = resolve(sourceRoot, '.package-source.json')
  if (commit === 'unknown' && existsSync(stampPath)) {
    try {
      stamp = JSON.parse(readFileSync(stampPath, 'utf8'))
    } catch {
      stamp = null
    }
  }
  const effectiveCommit = commit !== 'unknown' ? commit : (typeof stamp?.commit === 'string' ? stamp.commit : 'unknown')
  const effectiveBranch = branch !== 'detached' ? branch : (typeof stamp?.ref === 'string' ? stamp.ref : branch)
  const effectiveDirty = commit !== 'unknown' ? Boolean(status) : stamp?.dirty === true
  return {
    commit: effectiveCommit,
    shortCommit: effectiveCommit === 'unknown' ? effectiveCommit : effectiveCommit.slice(0, 12),
    branch: effectiveBranch,
    dirty: effectiveDirty,
    dirtyPathCount: status ? status.split(/\r?\n/).filter(Boolean).length : 0,
    packageTreeFingerprint: packageTreeFingerprint(packageRoots),
  }
}

function packageTreeFingerprint(packageRoots) {
  const hash = createHash('sha256')
  const ignoredDirectories = new Set(['.git', 'node_modules', 'dist', 'coverage', '.vite'])
  const files = []
  function visit(root, current) {
    if (!existsSync(current)) return
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue
      const path = resolve(current, entry.name)
      if (entry.isDirectory()) visit(root, path)
      else if (entry.isFile()) files.push({ root, path })
    }
  }
  for (const root of packageRoots) visit(root, root)
  for (const file of files.sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(relative(file.root, file.path).replaceAll('\\', '/'))
    hash.update('\0')
    hash.update(readFileSync(file.path))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function fail(result, message) {
  result.errors.push(message)
}

function warn(result, message) {
  result.warnings.push(message)
}

export function inspectPackageCohort({ repoRoot = SCRIPT_ROOT, manifestPath = DEFAULT_MANIFEST, strict = false } = {}) {
  const root = resolve(repoRoot)
  const manifestFile = resolve(root, manifestPath)
  const result = {
    ok: true,
    repository: relativeDisplay(root, root),
    manifest: relativeDisplay(root, manifestFile),
    mode: null,
    source: null,
    dependencies: [],
    errors: [],
    warnings: [],
  }

  if (!existsSync(manifestFile)) {
    fail(result, `missing explicit package override manifest: ${relativeDisplay(root, manifestFile)}`)
    result.ok = false
    return result
  }

  let manifest
  try {
    manifest = readJson(manifestFile)
  } catch (error) {
    fail(result, `invalid package override manifest: ${error.message}`)
    result.ok = false
    return result
  }

  result.mode = manifest.mode ?? null
  if (manifest.version !== 1) fail(result, 'package override manifest version must be 1')
  if (manifest.mode !== 'explicit-sibling-override') {
    fail(result, 'package override manifest mode must be explicit-sibling-override')
  }
  if (typeof manifest.sourceRepo !== 'string' || isAbsolute(manifest.sourceRepo)) {
    fail(result, 'sourceRepo must be a relative path')
  }
  if (!manifest.packages || typeof manifest.packages !== 'object') {
    fail(result, 'packages must be an object')
  }

  const sourceRoot = typeof manifest.sourceRepo === 'string' && !isAbsolute(manifest.sourceRepo)
    ? resolve(root, manifest.sourceRepo)
    : null
  if (!sourceRoot || !existsSync(sourceRoot)) {
    fail(result, `package source checkout is missing: ${manifest.sourceRepo ?? '<unset>'}`)
  } else {
    const packageRoots = Object.values(manifest.packages ?? {})
      .map((entry) => typeof entry?.path === 'string' ? resolve(sourceRoot, entry.path) : null)
      .filter(Boolean)
    result.source = {
      path: relativeDisplay(root, sourceRoot),
      ...sourceInfo(sourceRoot, packageRoots),
    }
    if (result.source.dirty && (manifest.allowDirtySource !== true || strict)) {
      fail(result, `package source checkout is dirty (${result.source.dirtyPathCount} paths); set allowDirtySource=true only for an intentional local override`)
    } else if (result.source.dirty) {
      warn(result, `package source checkout is dirty (${result.source.dirtyPathCount} paths); builds use its current files by explicit manifest approval`)
    }
  }

  const consumers = [
    { label: 'extension root', path: root },
    { label: 'portal', path: resolve(root, 'streampulse-web') },
  ]
  const declared = manifest.packages ?? {}
  const seen = new Set()

  for (const consumer of consumers) {
    const packageFile = resolve(consumer.path, 'package.json')
    if (!existsSync(packageFile)) continue
    let packageJson
    try {
      packageJson = readJson(packageFile)
    } catch (error) {
      fail(result, `${consumer.label} package.json is invalid: ${error.message}`)
      continue
    }
    let lockRoot = null
    const lockFile = resolve(consumer.path, 'package-lock.json')
    if (existsSync(lockFile)) {
      try {
        lockRoot = readJson(lockFile).packages?.[''] ?? null
      } catch (error) {
        fail(result, `${consumer.label} package-lock.json is invalid: ${error.message}`)
      }
    } else {
      warn(result, `${consumer.label} has no package-lock.json; lockfile cohort cannot be verified`)
    }
    for (const dependency of packageDependencies(packageJson, consumer.path)) {
      seen.add(dependency.name)
      const entry = declared[dependency.name]
      const target = sourceRoot && entry?.path ? resolve(sourceRoot, entry.path) : null
      const resolved = existsSync(dependency.resolvedPath)
        ? realpathSync(dependency.resolvedPath)
        : dependency.resolvedPath
      const expected = target ? resolve(target) : null
      const record = {
        consumer: consumer.label,
        name: dependency.name,
        spec: dependency.spec,
        resolvedPath: relativeDisplay(root, resolved),
        manifestPath: entry?.path ?? null,
        expectedPath: expected ? relativeDisplay(root, expected) : null,
      }
      result.dependencies.push(record)
      const lockedSpec = lockRoot?.dependencies?.[dependency.name]
      if (lockRoot && lockedSpec !== dependency.spec) {
        fail(result, `${consumer.label} lockfile resolves ${dependency.name} as ${lockedSpec ?? '<missing>'}, package.json declares ${dependency.spec}`)
      }
      if (!entry) {
        fail(result, `${dependency.name} is a sibling file dependency but is not declared in ${result.manifest}`)
        continue
      }
      if (!sourceRoot) continue
      if (resolve(dependency.resolvedPath) !== expected) {
        fail(result, `${dependency.name} resolves to ${record.resolvedPath}, expected ${record.expectedPath}`)
      }
      const installedPath = resolve(consumer.path, 'node_modules', dependency.name)
      if (!existsSync(installedPath)) {
        warn(result, `${consumer.label} has no installed ${dependency.name}; run npm install after confirming the manifest`)
      } else {
        const installedResolved = realpathSync(installedPath)
        if (resolve(installedResolved) !== expected) {
          fail(result, `${consumer.label} installed ${dependency.name} at ${relativeDisplay(root, installedResolved)}, expected ${record.expectedPath}`)
        }
      }
      const packageMetadata = resolve(dependency.resolvedPath, 'package.json')
      if (!existsSync(packageMetadata)) {
        fail(result, `${dependency.name} target has no package.json: ${record.resolvedPath}`)
      } else {
        try {
          const actualName = readJson(packageMetadata).name
          if (actualName !== dependency.name) {
            fail(result, `${dependency.name} target package.json is named ${actualName ?? '<missing>'}`)
          }
        } catch (error) {
          fail(result, `${dependency.name} target package.json is invalid: ${error.message}`)
        }
      }
    }
  }

  for (const name of Object.keys(declared)) {
    if (!seen.has(name)) warn(result, `${name} is declared in ${result.manifest} but no current package.json uses it as a file dependency`)
  }

  if (result.dependencies.length === 0) {
    warn(result, 'no @streampulse/* file dependencies found; update the manifest when migrating to the in-repo workspace')
  }
  result.ok = result.errors.length === 0
  return result
}

function parseArgs(argv) {
  const args = { repoRoot: SCRIPT_ROOT, manifestPath: DEFAULT_MANIFEST, json: false, strict: false }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--repo-root') args.repoRoot = argv[++index]
    else if (value === '--manifest') args.manifestPath = argv[++index]
    else if (value === '--json') args.json = true
    else if (value === '--strict') args.strict = true
    else if (value === '--help' || value === '-h') args.help = true
  }
  return args
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log('Usage: node scripts/check-package-cohort.mjs [--repo-root PATH] [--manifest PATH] [--json] [--strict]')
    return
  }
  const result = inspectPackageCohort(args)
  if (args.json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(`[package-cohort] ${result.ok ? 'OK' : 'FAIL'} mode=${result.mode ?? 'unknown'}${args.strict ? ' strict=true' : ''}`)
    if (result.source) {
      console.log(`[package-cohort] source=${result.source.path} branch=${result.source.branch} commit=${result.source.shortCommit} dirty=${result.source.dirty}`)
    }
    for (const dependency of result.dependencies) {
      console.log(`[package-cohort] ${dependency.consumer}: ${dependency.name} -> ${dependency.resolvedPath}`)
    }
    for (const message of result.warnings) console.warn(`[package-cohort] warning: ${message}`)
    for (const message of result.errors) console.error(`[package-cohort] error: ${message}`)
  }
  if (!result.ok) process.exitCode = 1
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main()
