/**
 * Atomic packaging: build + zip + validate the same target.
 * Usage: node scripts/package-extension-target.mjs <development|cws|edge|firefox>
 *
 * Every target receives its own compile because runtime privacy/diagnostics
 * behavior is selected with the compile-time __EXTENSION_TARGET__ constant.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { loadManifestForTarget, resolveExtensionTarget } from './extension-target.mjs'

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

const storeEnv = { ...process.env, EXTENSION_TARGET: target }
run('npx', ['vite', 'build'], storeEnv)
run('node', ['scripts/write-extension-build-provenance.mjs'], storeEnv)
packageOne(target, storeEnv)
