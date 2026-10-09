#!/usr/bin/env node
/**
 * Production Cloudflare Pages deploy for streampulse.stream.
 *
 * Auth: CLOUDFLARE_API_TOKEN **or** logged-in wrangler OAuth (`wrangler login`).
 *
 * Account: set CLOUDFLARE_ACCOUNT_ID to the Gmail account that owns apex
 * `streampulse.stream` (Pages project `streampulse-web`). A second same-named
 * project on the ASU account serves `app.streampulse.stream` only — deploying
 * without the apex account ID silently updates the wrong project.
 *
 * Refuses to build unless every production input in pages-deploy-env.mjs is set
 * and well formed: VITE_SENTRY_DSN, VITE_POSTHOG_PROJECT_TOKEN,
 * VITE_TURNSTILE_SITE_KEY and VITE_PUBLIC_DISCORD_INVITE_URL (from the shell or a
 * .env.production file). Each can be waived on purpose with its own
 * PAGES_DEPLOY_ALLOW_NO_{SENTRY,POSTHOG,TURNSTILE,DISCORD}=1, which is printed
 * loudly. Only names are printed, never values.
 *
 * With VITE_SENTRY_DSN it also requires SENTRY_AUTH_TOKEN, SENTRY_ORG (default
 * streampulse), SENTRY_PROJECT (default streampulse-portal), uploads hidden
 * source maps via @sentry/vite-plugin, then deletes *.map from dist.
 *
 * Build uses VITE_BACKEND_URL when set; defaults to hosted API.
 * Portal release is always streampulse-portal@<full git SHA>.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, unlinkSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { verifyHostedAnalyticsRoutes, verifyHostedAccountRoutes } from './hosted-analytics-route-smoke.mjs'
import { assertDeploySourceIsOriginMaster, assertEdgeFreeze, describeEdgeFreeze } from './check-edge-freeze.mjs'
import { checkProductionBuildEnv, describeWaivedInputs } from './pages-deploy-env.mjs'
import { loadEnv } from 'vite'

const root = dirname(fileURLToPath(import.meta.url))
const webRoot = join(root, '..')
const repoRoot = join(webRoot, '..')

// First, before any check, build or upload: a production build without these
// inputs silently drops error reporting, analytics, the form's bot check or the
// Discord links. What the production Vite build will see is any .env.production
// file overridden by the shell. Names only; values are never printed.
const productionEnv = { ...process.env, ...loadEnv('production', webRoot, ['VITE_']) }
const inputCheck = checkProductionBuildEnv(productionEnv)
if (inputCheck.errors.length > 0) {
  console.error('pages:deploy:prod refuses to build production without its build inputs:')
  for (const error of inputCheck.errors) console.error(`  - ${error}`)
  process.exit(1)
}
for (const line of describeWaivedInputs(inputCheck.waived)) console.warn(line)

// No environment override: an edge architecture exception needs explicit review.
// The source check fails fast; the full check on the built dist/ runs again
// immediately before the upload.
function edgeCheck(check) {
  try {
    return check()
  } catch (error) {
    console.error(`pages:deploy:prod: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

// A second same-named Pages project on another account serves app.* only, and
// the edge-freeze amendment forbids a Worker there. Without an explicit account
// wrangler may reuse a cached or interactive one, so an admitted Worker needs
// CLOUDFLARE_ACCOUNT_ID and the apex project name. The account ID is never printed.
const APEX_PAGES_PROJECT = 'streampulse-web'
function requireApexTargetForWorker(gate, project) {
  if (!gate.admitted) return
  if (!process.env.CLOUDFLARE_ACCOUNT_ID?.trim()) {
    console.error('pages:deploy:prod: CLOUDFLARE_ACCOUNT_ID is required when a Pages Worker is admitted; set it to the account that owns apex streampulse.stream')
    process.exit(1)
  }
  if (project !== APEX_PAGES_PROJECT) {
    console.error(`pages:deploy:prod: a Pages Worker may be deployed only to the apex project ${APEX_PAGES_PROJECT}`)
    process.exit(1)
  }
}

const sourceGate = edgeCheck(() => assertEdgeFreeze(webRoot, { sourceOnly: true }))
console.log(describeEdgeFreeze(sourceGate))
const localWrangler = join(
  webRoot,
  process.platform === 'win32' ? 'node_modules/.bin/wrangler.cmd' : 'node_modules/.bin/wrangler',
)

const backendUrl = process.env.VITE_BACKEND_URL?.trim() || 'https://api.streampulse.stream'
if (!backendUrl.includes('api.streampulse.stream')) {
  console.error(`pages:deploy:prod requires VITE_BACKEND_URL=https://api.streampulse.stream (got ${backendUrl})`)
  process.exit(1)
}
const projectName = process.env.CLOUDFLARE_PAGES_PROJECT?.trim() || APEX_PAGES_PROJECT
requireApexTargetForWorker(sourceGate, projectName)

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
const viteSentryDsn = productionEnv.VITE_SENTRY_DSN?.trim() || ''

console.log(`Deploying git SHA ${sha}`)
assertCleanGitTree()
// ALLOW_DIRTY_PAGES_DEPLOY never covers this: HEAD must be a freshly fetched
// origin/master and every edge path must match it by content.
edgeCheck(() => assertDeploySourceIsOriginMaster(webRoot))

console.log('Running production deploy gates')
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
if (viteSentryDsn) {
  buildEnv.VITE_SENTRY_DSN = viteSentryDsn
}

console.log(`Building with VITE_BACKEND_URL=${backendUrl}`)
console.log(`Portal release ${portalRelease}`)
run('npx', ['vite', 'build'], buildEnv)
run('node', ['scripts/prerender.mjs'])
run('node', ['scripts/check-public-pages.mjs'])
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
  // The plugin stamps each chunk with a debug ID; without one, production stack
  // traces would not resolve. Report yes/no only.
  const assetsDir = join(webRoot, 'dist', 'assets')
  const entryChunks = readdirSync(assetsDir).filter(name => /^index-.+\.js$/.test(name))
  const hasDebugIds = entryChunks.some(name => readFileSync(join(assetsDir, name), 'utf8').includes('sentry-dbid-'))
  console.log(`Sentry debug IDs in the entry bundle: ${hasDebugIds ? 'yes' : 'no'}`)
  if (!hasDebugIds) {
    console.error('pages:deploy:prod: the entry bundle has no Sentry debug IDs; refusing to deploy unresolvable stack traces')
    process.exit(1)
  }
}

const hasApiToken = Boolean(process.env.CLOUDFLARE_API_TOKEN?.trim())
if (!hasApiToken) {
  console.warn(
    'pages:deploy:prod: CLOUDFLARE_API_TOKEN unset; using wrangler OAuth credentials (wrangler login)',
  )
}

// Production branch is `master` (not `main`) — `main` only updates preview alias.
// Wrangler 4+ reads CLOUDFLARE_ACCOUNT_ID from the environment; do not pass
// --account-id (removed from `pages deploy` and causes a hard failure).
const deployArgs = ['pages', 'deploy', 'dist', '--project-name', projectName, '--branch', 'master']
if (!process.env.CLOUDFLARE_ACCOUNT_ID?.trim()) {
  console.warn(
    'pages:deploy:prod: CLOUDFLARE_ACCOUNT_ID unset; wrangler may deploy the ASU app.* project instead of apex — set the Gmail account id that owns streampulse.stream',
  )
}

const builtGate = edgeCheck(() => assertEdgeFreeze(webRoot))
console.log(describeEdgeFreeze(builtGate))
requireApexTargetForWorker(builtGate, projectName)
edgeCheck(() => assertDeploySourceIsOriginMaster(webRoot))

console.log(`Deploying dist/ to Cloudflare Pages project ${projectName}`)
run(localWrangler, deployArgs)

if (process.env.SKIP_HOSTED_ROUTE_SMOKE !== '1') {
  console.log('Verifying hosted analytics deep route')
  try {
    await verifyHostedAnalyticsRoutes()
    console.log('Verifying hosted account routes without redirects')
    await verifyHostedAccountRoutes()
  } catch (error) {
    console.error(`pages:deploy:prod: hosted route smoke failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
