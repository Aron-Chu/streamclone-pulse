/**
 * Atomic packaging: build + zip + validate the same target.
 * Usage: node scripts/package-extension-target.mjs <development|cws|edge|firefox>
 *
 * Every target receives its own compile because runtime privacy/diagnostics
 * behavior is selected with the compile-time __EXTENSION_TARGET__ constant.
 *
 * Store targets check release-notes publishability before building, so a
 * package that validation would reject never overwrites dist/ or a prior ZIP.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { loadManifestForTarget, resolveExtensionTarget } from './extension-target.mjs'
import { evaluateReleaseNotesGate, resolveCiPackageProbe } from './lib/release-notes-gate.mjs'

const target = resolveExtensionTarget(process.argv[2] ?? process.env.EXTENSION_TARGET)
const root = process.cwd()

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env,
    shell: true,
    cwd: root,
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function stampManifest(storeTarget) {
  const manifest = loadManifestForTarget(storeTarget)
  writeFileSync(join(root, 'dist', 'manifest.json'), JSON.stringify(manifest, null, 2))
  writeFileSync(
    join(root, 'dist', 'extension-target.json'),
    JSON.stringify({ target: storeTarget, version: manifest.version }, null, 2),
  )
}

function preflightStoreReleaseNotes(storeTarget) {
  const stop = (message) => {
    console.error(`FAIL: ${message}`)
    console.error(`package:${storeTarget} stopped before building; dist/ and existing packages were not modified`)
    process.exit(1)
  }
  const probe = resolveCiPackageProbe()
  if (probe.error) stop(probe.error)
  let notes
  try {
    notes = JSON.parse(readFileSync(join(root, 'src/shared/release-notes.json'), 'utf8'))
  } catch (err) {
    stop(`src/shared/release-notes.json unreadable: ${err instanceof Error ? err.message : err}`)
  }
  const gate = evaluateReleaseNotesGate({
    notes,
    version: loadManifestForTarget(storeTarget).version,
    storeTarget: true,
    probe: probe.enabled,
  })
  for (const message of gate.notices) console.log(`NOTE: ${message}`)
  if (gate.failures.length) stop(gate.failures.join('; '))
}

function packageOne(storeTarget, env) {
  stampManifest(storeTarget)
  run('node', ['scripts/zip-dist.mjs', `--target=${storeTarget}`], env)
  run('node', ['scripts/validate-extension-package.mjs', `--target=${storeTarget}`], env)
  console.log(`package:${storeTarget} complete`)
}

if (target === 'development') {
  const env = { ...process.env, EXTENSION_TARGET: 'development' }
  run('npx', ['vite', 'build'], env)
  run('node', ['scripts/write-extension-build-provenance.mjs'], env)
  packageOne('development', env)
  process.exit(0)
}

preflightStoreReleaseNotes(target)
const storeEnv = { ...process.env, EXTENSION_TARGET: target }
run('npx', ['vite', 'build'], storeEnv)
run('node', ['scripts/write-extension-build-provenance.mjs'], storeEnv)
packageOne(target, storeEnv)
