// Private-beta edge freeze gate for the Cloudflare Pages deploy.
//
// Worker-free is always allowed. A Pages Worker is admitted only when all of
// these hold:
//   - it is the single file `_worker.js` in both public/ and dist/, and the
//     SHA-256 of each equals the `sha256` pin in edge-freeze-exception.json;
//   - `_routes.json` in public/ and dist/ is byte-for-byte
//     JSON.stringify(pinned routes) plus a newline (wrangler uploads the raw
//     bytes), and the pinned routes include nothing outside /v1/account/* and
//     /v1/billing/*;
//   - the current UTC time is before 00:00Z on the pinned `expires` date, and
//     that date is at most 90 days away;
//   - its approval references an immutable policy document already merged in
//     the canonical SDLC repo; that document binds this exact hash/routes/date;
//   - there is no Pages Functions directory and no other `_worker*` or
//     `_routes*` entry.
// A wrangler config (wrangler.json, wrangler.jsonc, wrangler.toml, or the
// .wrangler/deploy/config.json redirect) is never admitted, worker or not, in
// streampulse-web/ or any parent directory: `wrangler pages deploy` searches
// upward from its cwd and would upload the bindings (KV, D1, DO, Queues, vars)
// such a file declares.
// There is deliberately no environment-variable or CLI bypass.
//
// assertDeploySourceIsOriginMaster() is the production deploy's git check:
// HEAD must equal a freshly fetched origin/master, and every EDGE_PATHS entry
// must match origin/master by real content, not by index state.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

export const EXCEPTION_FILE = 'edge-freeze-exception.json'
const WORKER = '_worker.js'
const ROUTES = '_routes.json'
const PIN_FIELDS = ['approval', 'expires', 'routes', 'sha256']
const ROUTE_CEILING = new Set(['/v1/account/*', '/v1/billing/*'])
const MAX_EXCEPTION_MS = 90 * 24 * 60 * 60 * 1000
export const APPROVAL_DOCUMENT = 'docs/superpowers/specs/2026-10-01-cloudflare-edge-freeze-amendment-v2.md'
const APPROVAL_REFERENCE = new RegExp(`^streampulse-sdlc@([0-9a-f]{40}):${APPROVAL_DOCUMENT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
export const WRANGLER_CONFIG_FILES = ['wrangler.json', 'wrangler.jsonc', 'wrangler.toml', '.wrangler/deploy/config.json']
// Paths (relative to streampulse-web/) that decide what reaches the edge. The
// production deploy requires each to match origin/master exactly.
export const EDGE_PATHS = [
  'public/_worker.js', 'public/_routes.json', EXCEPTION_FILE,
  'scripts/check-edge-freeze.mjs', 'scripts/pages-deploy-prod.mjs', 'functions', ...WRANGLER_CONFIG_FILES,
]

function fail(detail) {
  throw new Error(`EDGE_FREEZE_APPROVAL_REQUIRED: ${detail}. The private-beta policy excludes a Pages BFF except for the single hash-pinned Worker in ${EXCEPTION_FILE}.`)
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fail(`${label} is not valid JSON`)
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isStringArray(value) {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function readPin(webRoot) {
  const path = join(webRoot, EXCEPTION_FILE)
  if (!existsSync(path)) return null
  const pin = readJson(path, EXCEPTION_FILE)
  if (!isPlainObject(pin) || !isDeepStrictEqual(Object.keys(pin).sort(), PIN_FIELDS)) {
    fail(`${EXCEPTION_FILE} must contain exactly ${PIN_FIELDS.join(', ')}`)
  }
  if (typeof pin.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(pin.sha256)) fail(`${EXCEPTION_FILE} sha256 must be 64 lowercase hex characters`)
  if (typeof pin.approval !== 'string' || !pin.approval.trim() || pin.approval.length > 200) fail(`${EXCEPTION_FILE} approval must be a non-empty reference`)
  const match = typeof pin.expires === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(pin.expires) : null
  const expiresAt = match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : Number.NaN
  if (!match || new Date(expiresAt).toISOString().slice(0, 10) !== pin.expires) fail(`${EXCEPTION_FILE} expires must be an ISO date (YYYY-MM-DD)`)
  const routes = pin.routes
  if (!isPlainObject(routes) || !isDeepStrictEqual(Object.keys(routes).sort(), ['exclude', 'include', 'version'])
    || routes.version !== 1 || !isStringArray(routes.include) || !isStringArray(routes.exclude)) {
    fail(`${EXCEPTION_FILE} routes must be a _routes.json object with version 1, include, and exclude`)
  }
  if (!routes.include.length || new Set(routes.include).size !== routes.include.length
    || routes.include.some(rule => !ROUTE_CEILING.has(rule))) {
    fail(`${EXCEPTION_FILE} routes may include only ${[...ROUTE_CEILING].join(' and ')}`)
  }
  return { ...pin, expiresAt }
}

// Mirrors wrangler's own lookup: the nearest config wins, from cwd upward.
function assertNoWranglerConfig(webRoot) {
  let dir = resolve(webRoot)
  for (;;) {
    for (const name of WRANGLER_CONFIG_FILES) {
      const path = join(dir, name)
      if (existsSync(path)) {
        fail(`${relative(webRoot, path).replaceAll('\\', '/')} (wrangler config and bindings are never admitted)`)
      }
    }
    const parent = dirname(dir)
    if (parent === dir) return
    dir = parent
  }
}

export function pinnedRoutesBytes(routes) {
  return `${JSON.stringify(routes)}\n`
}

function inspectDirectory(webRoot, dir) {
  const base = join(webRoot, dir)
  if (!existsSync(base)) return { worker: false, routes: false }
  for (const name of readdirSync(base)) {
    if (/^_worker/i.test(name) && name !== WORKER) fail(`${dir}/${name} (only a single ${WORKER} file can be admitted)`)
    if (/^_routes/i.test(name) && name !== ROUTES) fail(`${dir}/${name} (only ${ROUTES} can be admitted)`)
  }
  const worker = join(base, WORKER)
  const routes = join(base, ROUTES)
  const hasWorker = existsSync(worker)
  const hasRoutes = existsSync(routes)
  if (hasWorker && !lstatSync(worker).isFile()) fail(`${dir}/${WORKER} is not a regular file`)
  if (hasRoutes && !lstatSync(routes).isFile()) fail(`${dir}/${ROUTES} is not a regular file`)
  return { worker: hasWorker, routes: hasRoutes }
}

/**
 * Local source/build proof only: checks the prepared Worker, routes and expiry.
 * This does not authorize a deployment. Production must use assertEdgeFreeze.
 */
export function assertEdgeFreezeStructural(webRoot, { now = new Date(), sourceOnly = false } = {}) {
  if (existsSync(join(webRoot, 'functions'))) fail('functions (Pages Functions are never admitted)')
  assertNoWranglerConfig(webRoot)
  const dirs = sourceOnly ? ['public'] : ['public', 'dist']
  const found = Object.fromEntries(dirs.map(dir => [dir, inspectDirectory(webRoot, dir)]))
  const workers = dirs.filter(dir => found[dir].worker).map(dir => `${dir}/${WORKER}`)
  const routeFiles = dirs.filter(dir => found[dir].routes).map(dir => `${dir}/${ROUTES}`)
  if (!workers.length) {
    if (routeFiles.length) fail(`${routeFiles.join(', ')} without an admitted ${WORKER}`)
    return { admitted: null }
  }

  const pin = readPin(webRoot)
  if (!pin) fail(`${workers.join(', ')} has no ${EXCEPTION_FILE} pin`)
  const nowMs = now.getTime()
  if (!(nowMs < pin.expiresAt)) fail(`the ${EXCEPTION_FILE} pin expired at ${pin.expires}T00:00:00Z`)
  if (pin.expiresAt - nowMs > MAX_EXCEPTION_MS) fail(`the ${EXCEPTION_FILE} expiry ${pin.expires} is more than 90 days away`)

  for (const dir of dirs) {
    if (!found[dir].worker) fail(`${dir}/${WORKER} is missing; public/ and the built dist/ must carry the same pinned Worker (build first)`)
    const digest = sha256File(join(webRoot, dir, WORKER))
    if (digest !== pin.sha256) fail(`${dir}/${WORKER} sha256 ${digest} does not match the pinned ${pin.sha256}`)
    if (!found[dir].routes) fail(`${dir}/${ROUTES} is missing`)
    const routes = readFileSync(join(webRoot, dir, ROUTES))
    if (!routes.equals(Buffer.from(pinnedRoutesBytes(pin.routes), 'utf8'))) {
      fail(`${dir}/${ROUTES} is not byte-for-byte JSON.stringify(pinned routes) plus a newline`)
    }
  }
  return { admitted: { sha256: pin.sha256, routes: pin.routes, expires: pin.expires, approval: pin.approval, checked: dirs } }
}

function approvalGit(args, cwd) {
  const result = spawnSync('git', ['--no-pager', '--no-replace-objects', ...args], { cwd, encoding: 'utf8', maxBuffer: 1024 * 1024 })
  if (result.error) fail('the read-only SDLC approval check could not run git')
  return result
}

function assertNoGitAuthorityEnvironment() {
  // Inspect names only. Git author/committer identity cannot select a repo or
  // rewrite its authority; GIT_PAGER is inert because approvalGit always uses
  // --no-pager. Every other GIT_* override is denied, including future
  // config/object/repository-selection controls. Never inspect values.
  const identity = /^GIT_(?:AUTHOR|COMMITTER)_(?:NAME|EMAIL|DATE)$/i
  if (Object.keys(process.env).some(name => /^GIT_/i.test(name) && !identity.test(name) && name.toUpperCase() !== 'GIT_PAGER')) {
    fail('Git authority or configuration environment overrides are not permitted')
  }
}

/** Read only immutable Git objects and local remote-tracking ancestry. Never fetch. */
function assertMergedApproval(webRoot, admitted) {
  const reference = APPROVAL_REFERENCE.exec(admitted.approval)
  if (!reference) fail('approval must reference an immutable merged streampulse-sdlc document')
  const revision = reference[1]
  const common = approvalGit(['rev-parse', '--path-format=absolute', '--git-common-dir'], webRoot)
  if (common.status !== 0 || !common.stdout.trim()) fail('the canonical SDLC checkout cannot be resolved from this product checkout')
  // Linked worktrees resolve through the primary product .git directory, not
  // through a caller-selected folder or an environment/config override.
  const sdlcRoot = join(dirname(resolve(common.stdout.trim())), '..', 'streampulse-sdlc')
  // `remote get-url` applies insteadOf rewriting and is not an identity check.
  // Read only the one raw URL in this repo's own config, ignoring includes.
  const remote = approvalGit(['config', '--local', '--no-includes', '--get-all', 'remote.origin.url'], sdlcRoot)
  const urls = remote.stdout?.replace(/\r?\n$/, '').split(/\r?\n/) ?? []
  const canonicalRemote = /^(?:https:\/\/github\.com\/Aron-Chu\/streampulse-sdlc(?:\.git)?|git@github\.com:Aron-Chu\/streampulse-sdlc(?:\.git)?|ssh:\/\/git@github\.com\/Aron-Chu\/streampulse-sdlc(?:\.git)?)$/
  if (remote.status !== 0 || urls.length !== 1 || !canonicalRemote.test(urls[0])) fail('approval requires the canonical streampulse-sdlc origin without embedded credentials')
  const object = approvalGit(['rev-parse', '--verify', `${revision}^{commit}`], sdlcRoot)
  const master = approvalGit(['rev-parse', '--verify', 'refs/remotes/origin/master^{commit}'], sdlcRoot)
  if (object.status !== 0 || object.stdout.trim() !== revision || master.status !== 0) fail('approval commit and SDLC origin/master must exist locally')
  if (approvalGit(['merge-base', '--is-ancestor', revision, 'refs/remotes/origin/master'], sdlcRoot).status !== 0) fail('approval commit is not merged into SDLC origin/master')
  const immutable = approvalGit(['show', `${revision}:${APPROVAL_DOCUMENT}`], sdlcRoot)
  const current = approvalGit(['show', `refs/remotes/origin/master:${APPROVAL_DOCUMENT}`], sdlcRoot)
  if (immutable.status !== 0 || current.status !== 0 || immutable.stdout !== current.stdout) fail('approval document is missing or has been superseded on SDLC origin/master')
  const blocks = [...immutable.stdout.matchAll(/```edge-approval-json\r?\n([\s\S]*?)\r?\n```/g)]
  if (blocks.length !== 1) fail('approval document must contain exactly one edge-approval-json block')
  let policy
  try { policy = JSON.parse(blocks[0][1]) } catch { fail('approval document contains invalid edge-approval-json') }
  if (!isPlainObject(policy) || !isDeepStrictEqual(Object.keys(policy).sort(), ['expires', 'routes', 'status', 'version', 'workerSha256'])
    || policy.version !== 2 || policy.status !== 'approved') fail('approval document must be approved amendment version 2')
  if (policy.workerSha256 !== admitted.sha256 || policy.expires !== admitted.expires || !isDeepStrictEqual(policy.routes, admitted.routes)) {
    fail('approval document does not bind the exact Worker SHA-256, routes and expiry')
  }
}

/** Production approval gate. No CLI flag or environment override admits a draft. */
export function assertEdgeFreeze(webRoot, options = {}) {
  assertNoGitAuthorityEnvironment()
  const result = assertEdgeFreezeStructural(webRoot, options)
  if (result.admitted) assertMergedApproval(webRoot, result.admitted)
  return result
}

export function describeEdgeFreeze(result) {
  if (!result.admitted) return 'edge freeze gate passed: no Pages Worker'
  const { sha256, expires, approval, checked } = result.admitted
  return `edge freeze gate passed: ${checked.map(dir => `${dir}/${WORKER}`).join(' and ')} sha256 ${sha256} match the pin; `
    + `${ROUTES} matches; exception expires ${expires}T00:00:00Z; approval: ${approval}`
}

function git(args, cwd, encoding = 'utf8') {
  const result = spawnSync('git', args, { cwd, encoding, maxBuffer: 64 * 1024 * 1024 })
  if (result.error) sourceFail(`git ${args[0]} could not run`)
  return result
}

function sourceFail(detail) {
  throw new Error(`EDGE_DEPLOY_SOURCE_REJECTED: ${detail}. Production deploys only from a clean checkout of origin/master; no override exists.`)
}

/**
 * Fetches origin master, then requires HEAD == origin/master and every
 * EDGE_PATHS entry to match origin/master. Content is compared byte for byte
 * against the origin/master blob, so `git update-index --assume-unchanged`,
 * skip-worktree, ignored, or untracked files cannot hide an edge change.
 */
export function assertDeploySourceIsOriginMaster(webRoot) {
  const prefix = git(['rev-parse', '--show-prefix'], webRoot)
  if (prefix.status !== 0) sourceFail('not a git checkout')
  const webPrefix = prefix.stdout.trim()
  if (git(['fetch', '--quiet', 'origin', 'master'], webRoot).status !== 0) sourceFail('git fetch origin master failed')
  const head = git(['rev-parse', '--verify', 'HEAD^{commit}'], webRoot)
  const master = git(['rev-parse', '--verify', 'refs/remotes/origin/master^{commit}'], webRoot)
  if (head.status !== 0 || master.status !== 0) sourceFail('could not resolve HEAD and origin/master')
  const [headSha, masterSha] = [head.stdout.trim(), master.stdout.trim()]
  if (headSha !== masterSha) sourceFail(`HEAD ${headSha} is not origin/master ${masterSha}`)

  const status = git(['status', '--porcelain', '--untracked-files=all', '--', ...EDGE_PATHS], webRoot)
  if (status.status !== 0 || status.stdout.trim()) sourceFail(`uncommitted edge files (${EDGE_PATHS.join(', ')})`)
  if (git(['diff', '--quiet', 'refs/remotes/origin/master', '--', ...EDGE_PATHS], webRoot).status !== 0) {
    sourceFail('edge files differ from origin/master')
  }
  for (const path of EDGE_PATHS) {
    const spec = `refs/remotes/origin/master:${webPrefix}${path}`
    const type = git(['cat-file', '-t', spec], webRoot)
    const remoteType = type.status === 0 ? type.stdout.trim() : null
    const local = join(webRoot, path)
    const localExists = existsSync(local)
    if (!localExists && !remoteType) continue
    if (!localExists || !remoteType) sourceFail(`${path} ${localExists ? 'exists locally but not' : 'is missing locally but exists'} on origin/master`)
    if (remoteType !== 'blob' || !lstatSync(local).isFile()) sourceFail(`${path} must be a regular file identical to origin/master`)
    const blob = git(['cat-file', 'blob', spec], webRoot, 'buffer')
    if (blob.status !== 0 || !readFileSync(local).equals(blob.stdout)) sourceFail(`${path} content differs from origin/master`)
  }
  return { head: headSha }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(describeEdgeFreeze(assertEdgeFreeze(join(dirname(fileURLToPath(import.meta.url)), '..'))))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
