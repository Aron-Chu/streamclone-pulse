#!/usr/bin/env node
/**
 * Credential-free production Pages *build* for streampulse.stream.
 * Must not require CLOUDFLARE_* or wrangler OAuth.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, unlinkSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))
const webRoot = join(root, '..')
const repoRoot = join(webRoot, '..')

if (process.env.CLOUDFLARE_API_TOKEN?.trim() || process.env.CLOUDFLARE_ACCOUNT_ID?.trim()) {
  console.error('pages:build:prod must be credential-free; unset CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID')
  process.exit(1)
}

const backendUrl = process.env.VITE_BACKEND_URL?.trim() || 'https://api.streampulse.stream'
if (!backendUrl.includes('api.streampulse.stream')) {
  console.error(`pages:build:prod requires VITE_BACKEND_URL=https://api.streampulse.stream (got ${backendUrl})`)
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

function resolveGitSha() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) {
    console.error('pages:build:prod could not resolve git SHA')
    process.exit(1)
  }
  const sha = (result.stdout || '').trim()
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    console.error(`pages:build:prod invalid git SHA: ${sha}`)
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
    console.error('pages:build:prod could not inspect git status')
    process.exit(1)
  }
  if ((result.stdout || '').trim() && process.env.ALLOW_DIRTY_PAGES_BUILD !== '1') {
    console.error('pages:build:prod refuses a dirty tree; set ALLOW_DIRTY_PAGES_BUILD=1 to override')
    process.exit(1)
  }
}

function deleteMapFiles(dir) {
  if (!existsSync(dir)) return 0
  let n = 0
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) n += deleteMapFiles(p)
    else if (name.endsWith('.map')) {
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

console.log(`Building git SHA ${sha}`)
assertCleanGitTree()

if (viteSentryDsn && !sentryAuth) {
  console.error('pages:build:prod: VITE_SENTRY_DSN is set but SENTRY_AUTH_TOKEN is missing')
  process.exit(1)
}

console.log('Running production build gates')
run('npx', ['tsc', '--noEmit', '-p', 'tsconfig.json'])
run('npx', ['tsc', '--noEmit', '-p', 'tsconfig.test.json'])
run('npm', ['test', '--', '--reporter=dot'])
run('node', ['scripts/check-analytics-tailwind.mjs'])
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
if (viteSentryDsn) buildEnv.VITE_SENTRY_DSN = viteSentryDsn

console.log(`Building with VITE_BACKEND_URL=${backendUrl}`)
run('npx', ['vite', 'build'], buildEnv)
run('node', ['scripts/prerender.mjs'])
run('node', ['scripts/check-public-pages.mjs'])
run('node', ['scripts/check-backend-url.mjs'])

const removed = deleteMapFiles(join(webRoot, 'dist'))
const remaining = countMapFiles(join(webRoot, 'dist'))
if (remaining > 0) {
  console.error(`pages:build:prod: ${remaining} .map files remain in dist after cleanup`)
  process.exit(1)
}
if (viteSentryDsn) {
  console.log(`Sentry source maps uploaded for ${portalRelease}; removed ${removed} local .map files`)
}
console.log('pages:build:prod complete (credential-free)')