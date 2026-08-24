#!/usr/bin/env node
/**
 * Minimal production Cloudflare Pages *deploy* phase.
 * Requires an existing dist/ from pages:build:prod. Does not rebuild.
 *
 * Auth: CLOUDFLARE_API_TOKEN (preferred) or wrangler OAuth.
 * Account: CLOUDFLARE_ACCOUNT_ID required (fail closed).
 * Break-glass dirty tree: ALLOW_DIRTY_PAGES_DEPLOY=1 plus BREAK_GLASS_JUSTIFICATION.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))
const webRoot = join(root, '..')
const repoRoot = join(webRoot, '..')
const distDir = join(webRoot, 'dist')
const localWrangler = join(
  webRoot,
  process.platform === 'win32' ? 'node_modules/.bin/wrangler.cmd' : 'node_modules/.bin/wrangler',
)

const projectName = process.env.CLOUDFLARE_PAGES_PROJECT?.trim() || 'streampulse-web'
if (!/^[a-z0-9-]+$/i.test(projectName)) {
  console.error('pages:deploy:prod: CLOUDFLARE_PAGES_PROJECT failed allowlist')
  process.exit(1)
}

function run(cmd, args, env = {}) {
  const result = spawnSync(cmd, args, {
    cwd: webRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...env },
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function assertCleanGitTree() {
  const result = spawnSync('git', ['status', '--porcelain'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) {
    console.error('pages:deploy:prod could not inspect git status')
    process.exit(1)
  }
  if ((result.stdout || '').trim()) {
    if (process.env.ALLOW_DIRTY_PAGES_DEPLOY === '1' && process.env.BREAK_GLASS_JUSTIFICATION?.trim()) {
      console.warn(`pages:deploy:prod break-glass dirty deploy: ${process.env.BREAK_GLASS_JUSTIFICATION.trim()}`)
    } else {
      console.error(
        'pages:deploy:prod refuses a dirty tree; set ALLOW_DIRTY_PAGES_DEPLOY=1 and BREAK_GLASS_JUSTIFICATION',
      )
      process.exit(1)
    }
  }
}

if (!existsSync(distDir)) {
  console.error('pages:deploy:prod requires dist/; run npm run pages:build:prod first')
  process.exit(1)
}

if (!process.env.CLOUDFLARE_ACCOUNT_ID?.trim()) {
  console.error('pages:deploy:prod requires CLOUDFLARE_ACCOUNT_ID (fail closed)')
  process.exit(1)
}

assertCleanGitTree()

const hasApiToken = Boolean(process.env.CLOUDFLARE_API_TOKEN?.trim())
if (!hasApiToken) {
  console.warn('pages:deploy:prod: CLOUDFLARE_API_TOKEN unset; using wrangler OAuth credentials')
}

const deployArgs = ['pages', 'deploy', 'dist', '--project-name', projectName, '--branch', 'master']
console.log(`Deploying existing dist/ to Cloudflare Pages project ${projectName}`)
run(localWrangler, deployArgs)