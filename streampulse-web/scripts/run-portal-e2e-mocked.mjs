#!/usr/bin/env node
/**
 * Run the required mocked portal Playwright suite against Vite preview.
 * Sets PORTAL_E2E_MOCKED=1 so playwright.config.ts uses build+preview on :4173.
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))
const webRoot = join(root, '..')

const env = {
  ...process.env,
  PORTAL_E2E_MOCKED: '1',
  VITE_BACKEND_URL: process.env.VITE_BACKEND_URL?.trim() || 'https://api.streampulse.stream',
}

const extra = process.argv.slice(2)
const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['playwright', 'test', '--project=portal-mocked', ...extra],
  {
    cwd: webRoot,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  },
)

process.exit(result.status ?? 1)
