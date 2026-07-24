/**
 * Build + zip + validate a non-Firefox extension packaging target.
 * Usage: node scripts/package-extension-target.mjs <cws|edge>
 */
import { spawnSync } from 'node:child_process'
import { resolveExtensionTarget } from './extension-target.mjs'

const target = resolveExtensionTarget(process.argv[2])
if (target === 'development') {
  console.error('package-extension-target.mjs is for store targets (cws|edge)')
  process.exit(1)
}

const env = { ...process.env, EXTENSION_TARGET: target }

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', env, shell: true, cwd: process.cwd() })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run('npx', ['vite', 'build'])
run('node', ['scripts/write-extension-build-provenance.mjs'])
run('node', ['scripts/zip-dist.mjs'])
run('node', ['scripts/validate-extension-package.mjs', `--target=${target}`])
console.log(`package:${target} complete`)
