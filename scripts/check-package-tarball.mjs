/**
 * RPR-6: npm pack each in-repo @streampulse package and reject unsafe tarball entries.
 *
 * Allowlist: package.json, LICENSE, NOTICE (mandatory), src/**, dist/**, package-root CSS.
 * Deny: tests/, *.test.*, *.map, .env*, package-lock*, absolute paths, streampulse-backend paths.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

export const PACKAGE_DIRS = Object.freeze([
  'packages/pulse-core',
  'packages/pulse-charts',
  'packages/analytics-console',
])

const DENY_NAME_RES = Object.freeze([
  /(^|\/)tests(\/|$)/i,
  /\.test\.[^/]+$/i,
  /\.spec\.[^/]+$/i,
  /\.map$/i,
  /(^|\/)\.env(\.|$)/i,
  /(^|\/)package-lock\.json$/i,
  /streampulse-backend/i,
])

/**
 * @param {string} entryPath
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function classifyTarballEntry(entryPath) {
  const raw = String(entryPath ?? '').replace(/\\/g, '/')
  // npm pack entries look like package/src/index.ts
  const path = raw.replace(/^package\//, '').replace(/^\.\//, '')

  if (!path || path === '.') {
    return { ok: true }
  }
  if (path.startsWith('/') || /^[A-Za-z]:\//.test(path) || path.includes('://')) {
    return { ok: false, reason: 'absolute-or-url-path' }
  }
  if (path.split('/').includes('..')) {
    return { ok: false, reason: 'parent-segment' }
  }
  for (const re of DENY_NAME_RES) {
    if (re.test(path)) {
      return { ok: false, reason: `deny-pattern:${re}` }
    }
  }

  if (
    path === 'package.json' ||
    path === 'LICENSE' ||
    path === 'NOTICE' ||
    path === 'README.md' ||
    path === 'README'
  ) {
    return { ok: true }
  }
  if (path.startsWith('src/') || path === 'src') {
    return { ok: true }
  }
  if (path.startsWith('dist/') || path === 'dist') {
    return { ok: true }
  }
  // Package-root CSS (e.g. pulse-chart-motion.css)
  if (/\.css$/i.test(path) && !path.includes('/')) {
    return { ok: true }
  }

  return { ok: false, reason: 'not-allowlisted' }
}

/**
 * @param {string[]} entries
 * @returns {{ ok: boolean, violations: Array<{ path: string, reason: string }> }}
 */
export function auditTarballEntries(entries) {
  /** @type {Array<{ path: string, reason: string }>} */
  const violations = []
  for (const entry of entries) {
    const result = classifyTarballEntry(entry)
    if (!result.ok) {
      violations.push({ path: String(entry), reason: result.reason })
    }
  }
  return { ok: violations.length === 0, violations }
}

function listTarball(tgzPath) {
  // GNU tar on Windows treats an absolute `C:/...` operand as a remote
  // archive host. Run from the archive directory so the same command works
  // on Windows and Linux.
  const listed = spawnSync('tar', ['-tzf', basename(tgzPath)], {
    cwd: dirname(tgzPath),
    encoding: 'utf8',
  })
  if (listed.status !== 0) {
    throw new Error(`tar -tzf failed for ${tgzPath}: ${listed.stderr || listed.stdout}`)
  }
  return listed.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

function main() {
  for (const pkgRel of PACKAGE_DIRS) {
    const pkgDir = join(root, pkgRel)
    if (!existsSync(join(pkgDir, 'package.json'))) {
      console.error(`check-package-tarball: missing ${pkgRel}/package.json`)
      process.exitCode = 1
      continue
    }
    if (!existsSync(join(pkgDir, 'LICENSE'))) {
      console.error(`check-package-tarball: missing ${pkgRel}/LICENSE`)
      process.exitCode = 1
      continue
    }
    if (!existsSync(join(pkgDir, 'NOTICE'))) {
      console.error(`check-package-tarball: missing ${pkgRel}/NOTICE (NOTICE is mandatory)`)
      process.exitCode = 1
      continue
    }

    const pkgJson = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    /** Windows Node rejects spawnSync('npm.cmd') without shell; CI Linux is fine either way. */
    const npmSpawnOpts = { cwd: pkgDir, encoding: 'utf8', shell: process.platform === 'win32' }
    if (pkgJson.scripts?.build) {
      const built = spawnSync(npmCmd, ['run', 'build'], npmSpawnOpts)
      if (built.status !== 0) {
        console.error(`check-package-tarball: build failed for ${pkgRel}`)
        console.error(built.error || built.stderr || built.stdout)
        process.exitCode = 1
        continue
      }
    }

    const tmp = mkdtempSync(join(tmpdir(), 'pulse-pack-'))
    try {
      const packed = spawnSync(npmCmd, ['pack', '--pack-destination', tmp], npmSpawnOpts)
      if (packed.status !== 0) {
        console.error(`check-package-tarball: npm pack failed for ${pkgRel}`)
        console.error(packed.error || packed.stderr || packed.stdout)
        process.exitCode = 1
        continue
      }
      const tgzName = (packed.stdout || '')
        .trim()
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .at(-1)
      if (!tgzName) {
        console.error(`check-package-tarball: no tarball for ${pkgRel}`)
        process.exitCode = 1
        continue
      }
      const tgzPath = join(tmp, tgzName)
      let entries
      try {
        entries = listTarball(tgzPath)
      } catch (err) {
        console.error(String(err?.message || err))
        process.exitCode = 1
        continue
      }
      console.log(`\n=== ${pkgRel} (${tgzName}) ===`)
      for (const e of entries) console.log(`  ${e}`)
      const audit = auditTarballEntries(entries)
      if (!audit.ok) {
        for (const v of audit.violations) {
          console.error(`  REJECT ${v.path} (${v.reason})`)
        }
        process.exitCode = 1
        continue
      }
      const names = entries.map((e) => e.replace(/^package\//, '').replace(/^\.\//, ''))
      if (!names.includes('LICENSE')) {
        console.error(`  REJECT missing LICENSE in tarball`)
        process.exitCode = 1
        continue
      }
      if (!names.includes('NOTICE')) {
        console.error(`  REJECT missing NOTICE in tarball (mandatory)`)
        process.exitCode = 1
        continue
      }
      console.log(`  OK (${entries.length} entries; LICENSE+NOTICE present)`)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }

  if (!process.exitCode) {
    console.log('\ncheck-package-tarball: all packages OK')
  }
}

const entry = process.argv[1] ? process.argv[1].replace(/\\/g, '/') : ''
if (entry.endsWith('check-package-tarball.mjs')) {
  main()
}
