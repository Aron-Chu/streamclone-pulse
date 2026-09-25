/**
 * RPR-6: prove credential-free clean checkout works without sibling private repos.
 *
 * Copies only Git-tracked paths from the current tree into an isolated temp
 * directory with no streampulse-backend / streamclone sibling layout, then:
 *   - npm ci (uses committed lockfile only)
 *   - check:public-source-readiness
 *   - build:packages
 *   - typecheck
 *
 * Does not require STREAMPULSE_BACKEND_CHECKOUT_TOKEN or network registry auth
 * beyond public npm (workspaces resolve file:packages/*).
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function copyTrackedTree(src, dest) {
  const paths = execFileSync('git', ['ls-files', '-z'], {
    cwd: src,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean)

  for (const relativePath of paths) {
    const from = join(src, relativePath)
    if (!existsSync(from)) continue
    const to = join(dest, relativePath)
    mkdirSync(dirname(to), { recursive: true })
    cpSync(from, to)
  }
}

function run(cmd, args, cwd) {
  const npm = process.platform === 'win32' && cmd === 'npm' ? 'npm.cmd' : cmd
  const result = spawnSync(npm, args, {
    cwd,
    encoding: 'utf8',
    stdio: 'inherit',
    shell: process.platform === 'win32' && cmd === 'npm',
    env: {
      ...process.env,
      // Prove no backend checkout token is required.
      STREAMPULSE_BACKEND_CHECKOUT_TOKEN: '',
      // Block accidental sibling resolution via env overrides.
      npm_config_workspace: undefined,
    },
  })
  if (result.status !== 0) {
    throw new Error(`command failed (${cmd} ${args.join(' ')}) status=${result.status}`)
  }
}

function assertNoSiblingLayout(isolatedRoot) {
  const parent = dirname(isolatedRoot)
  for (const name of ['streampulse-backend', 'twitch-7tv-clone', 'streampulse-ops']) {
    const probe = join(parent, name)
    if (existsSync(probe)) {
      // Parent temp may coincidentally contain names; ensure isolated tree does not.
      // Soft note only — the proof is that install works without those dirs.
      writeFileSync(
        join(isolatedRoot, '.clean-checkout-note'),
        `parent had ${name}; isolated tree does not reference it\n`,
      )
    }
  }
  if (existsSync(join(isolatedRoot, 'streampulse-backend'))) {
    throw new Error('isolated checkout must not contain streampulse-backend')
  }
}

function main() {
  const nest = mkdtempSync(join(tmpdir(), 'pulse-clean-checkout-'))
  const isolated = join(nest, 'streamclone-pulse')
  console.log(`prove-clean-checkout: isolated root ${isolated}`)
  try {
    copyTrackedTree(root, isolated)
    assertNoSiblingLayout(isolated)

    run('npm', ['ci'], isolated)
    run('node', ['scripts/check-public-source-readiness.mjs'], isolated)
    run('npm', ['run', 'build:packages'], isolated)
    run('npm', ['run', 'ensure:packages'], isolated)
    run('npx', ['tsc', '--noEmit'], isolated)

    console.log('prove-clean-checkout: OK (credential-free; no sibling private packages)')
  } finally {
    rmSync(nest, { recursive: true, force: true })
  }
}

const entry = process.argv[1] ? process.argv[1].replace(/\\/g, '/') : ''
if (entry.endsWith('prove-clean-checkout.mjs')) {
  main()
}
