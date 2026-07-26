/**
 * Atomic packaging: build + zip + validate the same target.
 * Usage: node scripts/package-extension-target.mjs <development|cws|edge>
 *
 * CWS and Edge share one store JS compile (identical target behavior), then
 * re-stamp the target-specific manifest and produce distinct ZIP filenames.
 */
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
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

function copyDir(src, dest) {
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  function walk(from, to) {
    for (const name of readdirSync(from)) {
      const s = join(from, name)
      const d = join(to, name)
      if (statSync(s).isDirectory()) {
        mkdirSync(d, { recursive: true })
        walk(s, d)
      } else {
        mkdirSync(dirname(d), { recursive: true })
        copyFileSync(s, d)
      }
    }
  }
  walk(src, dest)
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

const storeEnv = { ...process.env, EXTENSION_TARGET: 'cws' }
run('npx', ['vite', 'build'], storeEnv)
run('node', ['scripts/write-extension-build-provenance.mjs'], storeEnv)

const storeBuildCache = join(tmpdir(), `sp-store-build-${process.pid}`)
copyDir(join(root, 'dist'), storeBuildCache)

const targets = target === 'edge' ? ['edge'] : target === 'cws' ? ['cws'] : ['cws', 'edge']
for (const storeTarget of targets) {
  copyDir(storeBuildCache, join(root, 'dist'))
  packageOne(storeTarget, { ...process.env, EXTENSION_TARGET: storeTarget })
}

rmSync(storeBuildCache, { recursive: true, force: true })
