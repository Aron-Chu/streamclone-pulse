#!/usr/bin/env node
/** Run public, hub, and chart interaction audits against the same fresh production preview. */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const command = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const build = spawnSync(command, ['run', 'build:ci'], {
  cwd: webRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
if (build.status !== 0) process.exit(build.status ?? 1)

const audit = spawnSync(
  process.execPath,
  [
    join(webRoot, 'node_modules', 'playwright', 'cli.js'),
    'test',
    'tests/e2e/public-surface-audit.spec.ts',
    'tests/e2e/hub-audit-regression.spec.ts',
    'tests/e2e/analytics-hub-chart-contract.spec.ts',
    'tests/e2e/analytics-hub-ux.spec.ts',
    'tests/e2e/analytics-interaction-refinement.spec.ts',
    '--workers=1',
    ...process.argv.slice(2),
  ],
  {
    cwd: webRoot,
    env: { ...process.env, PORTAL_E2E_AUDIT_PREVIEW: '1' },
    stdio: 'inherit',
  },
)
process.exit(audit.status ?? 1)
