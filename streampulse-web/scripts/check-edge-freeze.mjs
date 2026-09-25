// Private-beta edge freeze gate for the Cloudflare Pages deploy.
//
// Worker-free is always allowed. A Pages Worker is admitted only when all of
// these hold:
//   - it is the single file `_worker.js` in both public/ and dist/, and the
//     SHA-256 of each equals the `sha256` pin in edge-freeze-exception.json;
//   - `_routes.json` in public/ and dist/ equals the pinned `routes` exactly,
//     and the pinned routes include nothing outside /v1/account/* and
//     /v1/billing/*;
//   - the current UTC time is before 00:00Z on the pinned `expires` date, and
//     that date is at most 90 days away;
//   - there is no Pages Functions directory and no other `_worker*` or
//     `_routes*` entry.
// There is deliberately no environment-variable or CLI bypass.
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

export const EXCEPTION_FILE = 'edge-freeze-exception.json'
const WORKER = '_worker.js'
const ROUTES = '_routes.json'
const PIN_FIELDS = ['approval', 'expires', 'routes', 'sha256']
const ROUTE_CEILING = new Set(['/v1/account/*', '/v1/billing/*'])
const MAX_EXCEPTION_MS = 90 * 24 * 60 * 60 * 1000

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
 * Throws EDGE_FREEZE_APPROVAL_REQUIRED unless the Pages output is worker-free
 * or carries exactly the pinned Worker and routes before the pin expires.
 * `sourceOnly` skips dist/ for the pre-build check; the deploy always runs the
 * full check on the built dist/ before uploading.
 */
export function assertEdgeFreeze(webRoot, { now = new Date(), sourceOnly = false } = {}) {
  if (existsSync(join(webRoot, 'functions'))) fail('functions (Pages Functions are never admitted)')
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
    const routes = readJson(join(webRoot, dir, ROUTES), `${dir}/${ROUTES}`)
    if (!isDeepStrictEqual(routes, pin.routes)) fail(`${dir}/${ROUTES} does not equal the pinned routes`)
  }
  return { admitted: { sha256: pin.sha256, routes: pin.routes, expires: pin.expires, approval: pin.approval, checked: dirs } }
}

export function describeEdgeFreeze(result) {
  if (!result.admitted) return 'edge freeze gate passed: no Pages Worker'
  const { sha256, expires, approval, checked } = result.admitted
  return `edge freeze gate passed: ${checked.map(dir => `${dir}/${WORKER}`).join(' and ')} sha256 ${sha256} match the pin; `
    + `${ROUTES} matches; exception expires ${expires}T00:00:00Z; approval: ${approval}`
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(describeEdgeFreeze(assertEdgeFreeze(join(dirname(fileURLToPath(import.meta.url)), '..'))))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
