#!/usr/bin/env node
/**
 * Production Cloudflare Pages deploy for streampulse.stream.
 * Requires CLOUDFLARE_API_TOKEN (and optionally CLOUDFLARE_ACCOUNT_ID).
 *
 * When VITE_SENTRY_DSN is set, also requires:
 *   SENTRY_AUTH_TOKEN, SENTRY_ORG (default streampulse), SENTRY_PROJECT (default streampulse-portal)
 * and uploads hidden source maps via @sentry/vite-plugin, then deletes *.map from dist.
 *
 * Build uses VITE_BACKEND_URL when set; defaults to hosted API.
 * Portal release is always streampulse-portal@<full git SHA>.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, unlinkSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))
const webRoot = join(root, '..')
const repoRoot = join(webRoot, '..')
const localWrangler = join(
  webRoot,
  process.platform === 'win32' ? 'node_modules/.bin/wrangler.cmd' : 'node_modules/.bin/wrangler',
)

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

function resolveGitSha() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) {
    console.error('pages:deploy:prod could not resolve git SHA (git rev-parse HEAD)')
    process.exit(1)
  }
  const sha = (result.stdout || '').trim()
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    console.error(`pages:deploy:prod invalid git SHA: ${sha}`)
    process.exit(1)
  }
  return sha
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
  if ((result.stdout || '').trim() && process.env.ALLOW_DIRTY_PAGES_DEPLOY !== '1') {
    console.error('pages:deploy:prod refuses a dirty tree; set ALLOW_DIRTY_PAGES_DEPLOY=1 to override')
    process.exit(1)
  }
}

function deleteMapFiles(dir) {
  if (!existsSync(dir)) return 0
  let n = 0
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) {
      n += deleteMapFiles(p)
    } else if (name.endsWith('.map')) {
      unlinkSync(p)
      n += 1
    }
  }
  return n
}

function countMapFiles(dir) {
  if (!existsSync(dir)) return 0
  let n = 0
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) n += countMapFiles(p)
    else if (name.endsWith('.map')) n += 1
  }
  return n
}

const sha = resolveGitSha()
const portalRelease = `streampulse-portal@${sha}`
const viteSentryDsn = process.env.VITE_SENTRY_DSN?.trim() || ''
const sentryAuth = process.env.SENTRY_AUTH_TOKEN?.trim() || ''

console.log(`Deploying git SHA ${sha}`)
assertCleanGitTree()

if (viteSentryDsn && !sentryAuth) {
  console.error('pages:deploy:prod: VITE_SENTRY_DSN is set but SENTRY_AUTH_TOKEN is missing')
  process.exit(1)
}

console.log('Running production deploy gates')
run('npx', ['tsc', '--noEmit', '-p', 'tsconfig.json'])
run('node', ['scripts/check-analytics-routes-spa.mjs'])
run('node', ['scripts/check-analytics-links.mjs'])
run('node', ['scripts/check-analytics-overlap.mjs'])

const buildEnv = {
  VITE_BACKEND_URL: backendUrl,
  VITE_PORTAL_VERSION: portalRelease,
  SENTRY_RELEASE: portalRelease,
  SENTRY_ORG: process.env.SENTRY_ORG?.trim() || 'streampulse',
  SENTRY_PROJECT: process.env.SENTRY_PROJECT?.trim() || 'streampulse-portal',
}
if (viteSentryDsn) {
  buildEnv.VITE_SENTRY_DSN = viteSentryDsn
}

console.log(`Building with VITE_BACKEND_URL=${backendUrl}`)
console.log(`Portal release ${portalRelease}`)
run('npx', ['vite', 'build'], buildEnv)
run('node', ['scripts/check-backend-url.mjs'])

// Ensure maps are gone from deploy artifact (plugin should already delete after upload).
const removed = deleteMapFiles(join(webRoot, 'dist'))
const remaining = countMapFiles(join(webRoot, 'dist'))
if (remaining > 0) {
  console.error(`pages:deploy:prod: ${remaining} .map files remain in dist after cleanup`)
  process.exit(1)
}
if (viteSentryDsn) {
  console.log(`Sentry source maps uploaded for ${portalRelease}; removed ${removed} local .map files`)
}

if (!process.env.CLOUDFLARE_API_TOKEN?.trim()) {
  console.error('pages:deploy:prod requires CLOUDFLARE_API_TOKEN')
  process.exit(1)
}

// Production branch is `master` (not `main`) — `main` only updates preview alias.
const deployArgs = ['pages', 'deploy', 'dist', '--project-name', projectName, '--branch', 'master']
if (process.env.CLOUDFLARE_ACCOUNT_ID?.trim()) {
  deployArgs.push('--account-id', process.env.CLOUDFLARE_ACCOUNT_ID.trim())
}

console.log(`Deploying dist/ to Cloudflare Pages project ${projectName}`)
run(localWrangler, deployArgs)
