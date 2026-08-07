#!/usr/bin/env node

/**
 * Capture and run an immutable local portal snapshot.
 *
 * The normal `npm run dev` command intentionally follows the current dirty
 * checkout. This command is the reproducible lane: it copies the portal,
 * extension UI aliases, and the three linked @streampulse packages into an
 * external snapshot directory, records content hashes, and refuses to start
 * when the snapshot has drifted.
 */

import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, cpSync, unlinkSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_SNAPSHOT_ROOT = resolve(process.env.STREAMPULSE_PORTAL_SNAPSHOT_ROOT || join(tmpdir(), 'streampulse-portal-snapshots'))
const PORTAL_ROOT = resolve(SCRIPT_ROOT, 'streampulse-web')
const BACKEND_ROOT = resolve(SCRIPT_ROOT, '..', 'streampulse-backend')
const PACKAGE_NAMES = ['analytics-console', 'pulse-charts', 'pulse-core']
const EXTENSION_ROOTS = ['ui', 'shared', 'content', 'types', 'vod', 'background']
const EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'dist', 'coverage', '.vite', '.cache', 'test-results'])
const SNAPSHOT_FILES = [
  'scripts/dev-portal.mjs',
  'scripts/build-provenance.mjs',
  'scripts/check-package-cohort.mjs',
  'scripts/check-release-notes.mjs',
]
const SNAPSHOT_ROOT_FILES = ['package.json', 'manifest.json']
const PORTABLE_SOURCE_ROOTS = [
  'streampulse-web/src',
  'streampulse-web/public',
  'src/ui',
  'src/shared',
  'src/content',
  'src/types',
  'src/vod',
  'src/background',
  'packages/analytics-console/src',
  'packages/pulse-charts/src',
  'packages/pulse-core/src',
]
const PORTABLE_SOURCE_FILES = [
  'package.json',
  'streampulse-web/package.json',
  'streampulse-web/vite.config.ts',
  'streampulse-web/tailwind.config.js',
  'streampulse-web/vitest.config.ts',
  'streampulse-web/tsconfig.test.json',
  'streampulse-web/scripts/check-analytics-tailwind.mjs',
]
const PORTABLE_TEXT_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.jsx', '.mjs', '.ts', '.tsx', '.vue'])
const NPM_BIN = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm'

function npm(args, options = {}) {
  if (process.platform === 'win32') {
    return execFileSync(NPM_BIN, ['/d', '/s', '/c', `npm ${args.join(' ')}`], options)
  }
  return execFileSync(NPM_BIN, args, options)
}

function fail(message) {
  console.error(`[portal-snapshot] error: ${message}`)
  process.exitCode = 1
}

function git(repoRoot, args) {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return 'unknown'
  }
}

function safeId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

function parseArgs(argv) {
  const args = { command: argv[0] || 'help', id: null, snapshotRoot: DEFAULT_SNAPSHOT_ROOT, prepare: true, json: false, noWatchConfig: true }
  for (let i = 1; i < argv.length; i += 1) {
    const value = argv[i]
    if (value === '--id') args.id = argv[++i]
    else if (value === '--snapshot-root') args.snapshotRoot = resolve(argv[++i])
    else if (value === '--no-prepare') args.prepare = false
    else if (value === '--watch-config') args.noWatchConfig = false
    else if (value === '--json') args.json = true
    else if (value === '--help' || value === '-h') args.command = 'help'
  }
  return args
}

function walkFiles(root, current = root, result = []) {
  if (!existsSync(current)) return result
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if (entry.isDirectory() && EXCLUDED_DIRS.has(entry.name)) continue
    const path = join(current, entry.name)
    if (entry.isDirectory()) walkFiles(root, path, result)
    else if (entry.isFile()) result.push(path)
  }
  return result
}

function hashTree(root) {
  const hash = createHash('sha256')
  const files = walkFiles(root).sort((a, b) => a.localeCompare(b))
  for (const path of files) {
    hash.update(relative(root, path).replaceAll('\\', '/'))
    hash.update('\0')
    hash.update(readFileSync(path))
    hash.update('\0')
  }
  return { digest: hash.digest('hex'), fileCount: files.length }
}

function copyTree(source, target) {
  mkdirSync(dirname(target), { recursive: true })
  cpSync(source, target, {
    recursive: true,
    force: true,
    filter: (path) => {
      const name = path.split(/[\\/]/).pop()
      return !EXCLUDED_DIRS.has(name)
    },
  })
}

function rewritePortalPackageJson(snapshotRoot) {
  for (const relativePath of ['package.json', 'streampulse-web/package.json']) {
    const packagePath = resolve(snapshotRoot, relativePath)
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'))
    for (const name of PACKAGE_NAMES) {
      const packageName = `@streampulse/${name}`
      if (packageJson.dependencies?.[packageName]) packageJson.dependencies[packageName] = `file:${relativePath === 'package.json' ? './packages' : '../packages'}/${name}`
      if (packageJson.devDependencies?.[packageName]) packageJson.devDependencies[packageName] = `file:${relativePath === 'package.json' ? './packages' : '../packages'}/${name}`
      if (packageJson.optionalDependencies?.[packageName]) packageJson.optionalDependencies[packageName] = `file:${relativePath === 'package.json' ? './packages' : '../packages'}/${name}`
      if (packageJson.peerDependencies?.[packageName]) packageJson.peerDependencies[packageName] = '*'
    }
    writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8')
  }
  // The copied lockfile encodes the mutable checkout's sibling paths. Let
  // prepare generate a lockfile against this isolated package tree.
  const packageLockPath = resolve(snapshotRoot, 'streampulse-web/package-lock.json')
  if (existsSync(packageLockPath)) unlinkSync(packageLockPath)
}

function assertPortableSnapshot(snapshotRoot) {
  const violations = []
  const root = resolve(snapshotRoot)
  const isInside = (candidate) => {
    const rel = relative(root, candidate)
    return rel === '' || (!rel.startsWith('..') && !/^[A-Za-z]:[\\/]/.test(rel))
  }
  const files = new Set(PORTABLE_SOURCE_FILES.map((path) => resolve(root, path)))
  for (const relativeRoot of PORTABLE_SOURCE_ROOTS) {
    for (const file of walkFiles(resolve(root, relativeRoot))) files.add(file)
  }
  for (const file of files) {
    if (!PORTABLE_TEXT_EXTENSIONS.has(file.slice(file.lastIndexOf('.')).toLowerCase())) continue
    const text = readFileSync(file, 'utf8')
    const relativeFile = relative(root, file).replaceAll('\\', '/')
    if (relativeFile.endsWith('/package.json') && /\bstreampulse-backend\b|\bstreampulse-sdlc\b/i.test(text)) {
      violations.push(`${relativeFile}: contains a checkout-specific path`)
    }
    const importPattern = /(?:from\s+|import\s*(?:\(|)|require\s*\(|url\s*\()\s*["'`]([^"'`]+)["'`]/g
    for (const match of text.matchAll(importPattern)) {
      const specifier = match[1]
      if (!specifier) continue
      if (/\bstreampulse-backend\b|\bstreampulse-sdlc\b|^[A-Za-z]:[\\/]|^file:\/\//i.test(specifier)) {
        violations.push(`${relativeFile}: import references an external checkout (${specifier})`)
        continue
      }
      if (specifier.startsWith('.') && !isInside(resolve(dirname(file), specifier))) {
        violations.push(`${relativeFile}: relative import escapes snapshot (${specifier})`)
      }
    }
  }
  if (violations.length > 0) {
    throw new Error(`snapshot contains non-portable imports:\n${violations.slice(0, 20).join('\n')}`)
  }
}

function writeSnapshotPackageManifest(snapshotRoot, sourceMetadata) {
  const manifestPath = resolve(snapshotRoot, 'config/local-package-overrides.json')
  const packages = Object.fromEntries(PACKAGE_NAMES.map((name) => [
    `@streampulse/${name}`,
    { path: `packages/${name}` },
  ]))
  mkdirSync(dirname(manifestPath), { recursive: true })
  writeFileSync(manifestPath, `${JSON.stringify({
    version: 1,
    mode: 'explicit-snapshot',
    sourceRepo: '.',
    allowDirtySource: false,
    packages,
    snapshotId: sourceMetadata.snapshotId,
    source: sourceMetadata,
  }, null, 2)}\n`, 'utf8')
}

function capture(args) {
  if (!existsSync(PORTAL_ROOT)) throw new Error(`portal checkout not found: ${PORTAL_ROOT}`)
  for (const name of PACKAGE_NAMES) {
    if (!existsSync(resolve(BACKEND_ROOT, 'packages', name))) throw new Error(`linked package not found: ${name}`)
  }

  const portalCommit = git(SCRIPT_ROOT, ['rev-parse', 'HEAD'])
  const backendCommit = git(BACKEND_ROOT, ['rev-parse', 'HEAD'])
  const id = safeId(args.id || `portal-${portalCommit.slice(0, 12)}-${Date.now()}`)
  const snapshotRoot = resolve(args.snapshotRoot, id)
  if (existsSync(snapshotRoot)) throw new Error(`snapshot already exists: ${snapshotRoot}`)

  mkdirSync(snapshotRoot, { recursive: true })
  copyTree(PORTAL_ROOT, resolve(snapshotRoot, 'streampulse-web'))
  for (const file of SNAPSHOT_ROOT_FILES) copyTree(resolve(SCRIPT_ROOT, file), resolve(snapshotRoot, file))
  // The portal aliases extension UI modules, and those modules may import
  // sibling extension surfaces such as content/bridge.ts. Capture the
  // extension roots used by the portal instead of copying build-only surfaces.
  for (const name of EXTENSION_ROOTS) {
    copyTree(resolve(SCRIPT_ROOT, 'src', name), resolve(snapshotRoot, 'src', name))
  }
  for (const file of SNAPSHOT_FILES) copyTree(resolve(SCRIPT_ROOT, file), resolve(snapshotRoot, file))
  for (const name of PACKAGE_NAMES) copyTree(resolve(BACKEND_ROOT, 'packages', name), resolve(snapshotRoot, 'packages', name))

  rewritePortalPackageJson(snapshotRoot)
  assertPortableSnapshot(snapshotRoot)
  const sourceMetadata = {
    snapshotId: id,
    capturedAt: new Date().toISOString(),
    portal: {
      commit: portalCommit,
      branch: git(SCRIPT_ROOT, ['branch', '--show-current']) || 'detached',
      dirty: Boolean(git(SCRIPT_ROOT, ['status', '--porcelain=v1', '--untracked-files=all'])),
    },
    backend: {
      commit: backendCommit,
      branch: git(BACKEND_ROOT, ['branch', '--show-current']) || 'detached',
      dirty: Boolean(git(BACKEND_ROOT, ['status', '--porcelain=v1', '--untracked-files=all'])),
    },
    node: process.version,
    npm: npm(['--version'], { encoding: 'utf8' }).trim(),
  }
  writeSnapshotPackageManifest(snapshotRoot, sourceMetadata)
  const trees = {
    portal: hashTree(resolve(snapshotRoot, 'streampulse-web')),
    extensionUi: hashTree(resolve(snapshotRoot, 'src/ui')),
    extensionShared: hashTree(resolve(snapshotRoot, 'src/shared')),
    extensionContent: hashTree(resolve(snapshotRoot, 'src/content')),
    extensionTypes: hashTree(resolve(snapshotRoot, 'src/types')),
    extensionVod: hashTree(resolve(snapshotRoot, 'src/vod')),
    extensionBackground: hashTree(resolve(snapshotRoot, 'src/background')),
    packages: Object.fromEntries(PACKAGE_NAMES.map((name) => [name, hashTree(resolve(snapshotRoot, 'packages', name))])),
    runtime: hashTree(snapshotRoot),
  }
  const manifest = {
    version: 1,
    kind: 'streampulse-portal-runtime-snapshot',
    ...sourceMetadata,
    runtime: {
      host: '127.0.0.1',
      port: 5174,
      backendMode: 'hosted',
      packageLayout: 'isolated-local-packages',
    },
    trees,
  }
  // runtime is intentionally recomputed after writing the manifest so that a
  // later verify can detect edits everywhere except the manifest itself.
  delete manifest.trees.runtime
  writeFileSync(resolve(snapshotRoot, 'snapshot-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  manifest.trees.runtime = hashTree(snapshotRoot)
  writeFileSync(resolve(snapshotRoot, 'snapshot-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.log(`[portal-snapshot] captured ${id}`)
  console.log(`[portal-snapshot] path ${snapshotRoot}`)
  console.log(`[portal-snapshot] portal ${portalCommit.slice(0, 12)} backend ${backendCommit.slice(0, 12)}`)
  return { id, snapshotRoot, manifest }
}

function readManifest(args) {
  const snapshotRoot = resolve(args.snapshotRoot, args.id || '')
  const path = resolve(snapshotRoot, 'snapshot-manifest.json')
  if (!existsSync(path)) throw new Error(`snapshot manifest not found: ${path}`)
  return { snapshotRoot, path, manifest: JSON.parse(readFileSync(path, 'utf8')) }
}

function verify(args) {
  const { snapshotRoot, manifest } = readManifest(args)
  if (manifest.version !== 1 || manifest.kind !== 'streampulse-portal-runtime-snapshot') throw new Error('unsupported snapshot manifest')
  assertPortableSnapshot(snapshotRoot)
  for (const name of PACKAGE_NAMES) {
    const actual = hashTree(resolve(snapshotRoot, 'packages', name))
    const expected = manifest.trees.packages?.[name]
    if (!expected || actual.digest !== expected.digest || actual.fileCount !== expected.fileCount) {
      throw new Error(`package drift detected for ${name}`)
    }
  }
  for (const [label, path] of [
    ['portal', 'streampulse-web'],
    ['extensionUi', 'src/ui'],
    ['extensionShared', 'src/shared'],
    ['extensionContent', 'src/content'],
    ['extensionTypes', 'src/types'],
    ['extensionVod', 'src/vod'],
    ['extensionBackground', 'src/background'],
  ]) {
    const actual = hashTree(resolve(snapshotRoot, path))
    const expected = manifest.trees[label]
    if (!expected || actual.digest !== expected.digest || actual.fileCount !== expected.fileCount) throw new Error(`snapshot drift detected for ${label}`)
  }
  const packageManifest = resolve(snapshotRoot, 'config/local-package-overrides.json')
  if (!existsSync(packageManifest)) throw new Error('snapshot package manifest missing')
  for (const name of PACKAGE_NAMES) {
    const packagePath = resolve(snapshotRoot, 'streampulse-web/node_modules/@streampulse', name)
    if (!existsSync(packagePath)) continue
    const realPackagePath = realpathSync(packagePath)
    if (!isPathInside(snapshotRoot, realPackagePath)) {
      throw new Error(`installed package escapes snapshot for ${name}: ${realPackagePath}`)
    }
  }
  console.log(`[portal-snapshot] verified ${manifest.snapshotId} (${manifest.trees.portal.digest.slice(0, 12)} / ${manifest.trees.packages['analytics-console'].digest.slice(0, 12)})`)
  return { snapshotRoot, manifest }
}

function isPathInside(root, candidate) {
  const rel = relative(resolve(root), resolve(candidate))
  return rel === '' || (!rel.startsWith('..') && !/^[A-Za-z]:[\\/]/.test(rel))
}

function prepare(args) {
  const { snapshotRoot, manifest } = verify(args)
  const portalRoot = resolve(snapshotRoot, 'streampulse-web')
  console.log('[portal-snapshot] installing snapshot dependencies (no lifecycle scripts)')
  npm(['install', '--install-links', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: portalRoot, stdio: 'inherit' })
  // node_modules is excluded from the content contract; lockfile and source
  // are not. Re-read the manifest's source hashes after npm updates the lock.
  const actualPortal = hashTree(portalRoot)
  const expectedPortal = manifest.trees.portal
  if (actualPortal.digest !== expectedPortal.digest) {
    const packageLock = resolve(portalRoot, 'package-lock.json')
    if (existsSync(packageLock)) {
      console.warn('[portal-snapshot] npm refreshed package-lock.json; recording the prepared lockfile in the manifest')
      manifest.trees.portal = actualPortal
      writeFileSync(resolve(snapshotRoot, 'snapshot-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    } else {
      throw new Error('npm changed the snapshot portal tree without producing a lockfile')
    }
  }
  console.log(`[portal-snapshot] prepared ${manifest.snapshotId}`)
  return { snapshotRoot, manifest }
}

function start(args) {
  let info = verify(args)
  if (args.prepare && !existsSync(resolve(info.snapshotRoot, 'streampulse-web/node_modules/vite/bin/vite.js'))) info = prepare(args)
  verify(args)
  const portalRoot = resolve(info.snapshotRoot, 'streampulse-web')
  const wrapper = resolve(info.snapshotRoot, 'scripts/dev-portal.mjs')
  if (!existsSync(wrapper)) throw new Error('snapshot dev wrapper missing')
  const wrapperArgs = args.noWatchConfig ? ['--no-watch-config'] : []
  const env = {
    ...process.env,
    VITE_BACKEND_URL: '',
    VITE_PORTAL_VERSION: `snapshot-${info.manifest.snapshotId}`,
    PULSE_BUILD_MODE: `stable-snapshot:${info.manifest.snapshotId}`,
    PULSE_RUNTIME_SNAPSHOT_ID: info.manifest.snapshotId,
  }
  console.log(`[portal-snapshot] starting ${info.manifest.snapshotId} at http://127.0.0.1:5174/analytics`)
  const child = spawn(process.execPath, [wrapper, ...wrapperArgs], {
    cwd: portalRoot,
    env,
    stdio: 'inherit',
    windowsHide: true,
  })
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
}

function help() {
  console.log(`Usage:
  node scripts/portal-runtime-snapshot.mjs capture [--id ID] [--snapshot-root PATH]
  node scripts/portal-runtime-snapshot.mjs verify --id ID [--snapshot-root PATH]
  node scripts/portal-runtime-snapshot.mjs prepare --id ID [--snapshot-root PATH]
  node scripts/portal-runtime-snapshot.mjs start --id ID [--snapshot-root PATH] [--no-prepare] [--watch-config]

Default snapshot root: ${DEFAULT_SNAPSHOT_ROOT}
The mutable WIP server remains: npm run dev`)
}

try {
  const args = parseArgs(process.argv.slice(2))
  if (args.command === 'capture') capture(args)
  else if (args.command === 'verify') verify(args)
  else if (args.command === 'prepare') prepare(args)
  else if (args.command === 'start') start(args)
  else help()
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
