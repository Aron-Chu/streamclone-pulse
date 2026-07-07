#!/usr/bin/env node
/**
 * Production Cloudflare Pages deploy for streampulse.stream.
 * Requires CLOUDFLARE_API_TOKEN (and optionally CLOUDFLARE_ACCOUNT_ID).
 *
 * Build uses VITE_BACKEND_URL when set; defaults to hosted API.
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))
const webRoot = join(root, '..')

const backendUrl = process.env.VITE_BACKEND_URL?.trim() || 'https://api.streampulse.stream'
if (!backendUrl.includes('api.streampulse.stream')) {
  console.error(`pages:deploy:prod requires VITE_BACKEND_URL=https://api.streampulse.stream (got ${backendUrl})`)
  process.exit(1)
}
const projectName = process.env.CLOUDFLARE_PAGES_PROJECT?.trim() || 'streampulse-web'

function run(cmd, args, env = {}) {
  const result = spawnSync(cmd, args, {
    cwd: webRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...env },
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

console.log('Running production deploy gates')
run('npx', ['tsc', '--noEmit', '-p', 'tsconfig.json'])
run('node', ['scripts/check-analytics-routes-spa.mjs'])
run('node', ['scripts/check-analytics-links.mjs'])

console.log(`Building with VITE_BACKEND_URL=${backendUrl}`)
run('npx', ['vite', 'build'], { VITE_BACKEND_URL: backendUrl })
run('node', ['scripts/check-backend-url.mjs'])

if (!process.env.CLOUDFLARE_API_TOKEN?.trim()) {
  console.error('pages:deploy:prod requires CLOUDFLARE_API_TOKEN')
  process.exit(1)
}

const deployArgs = ['pages', 'deploy', 'dist', '--project-name', projectName, '--branch', 'main']
if (process.env.CLOUDFLARE_ACCOUNT_ID?.trim()) {
  deployArgs.push('--account-id', process.env.CLOUDFLARE_ACCOUNT_ID.trim())
}

console.log(`Deploying dist/ to Cloudflare Pages project ${projectName}`)
run('npx', ['wrangler', ...deployArgs])
