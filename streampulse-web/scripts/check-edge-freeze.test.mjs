import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EXCEPTION_FILE, assertEdgeFreeze } from './check-edge-freeze.mjs'

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const committed = {
  worker: readFileSync(join(webRoot, 'public/_worker.js')),
  routes: readFileSync(join(webRoot, 'public/_routes.json')),
  pin: JSON.parse(readFileSync(join(webRoot, EXCEPTION_FILE), 'utf8')),
}
// Fixed clock: expiry is enforced by the deploy gate, not by the date CI runs.
const now = new Date('2026-09-25T12:00:00Z')
// The broad /v1/* forwarder that master carried before this change (ED-1).
const BROAD_WORKER = `export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/v1/')) {
      url.hostname = 'api.streampulse.stream'
      url.protocol = 'https:'
      url.port = '443'
      return fetch(new Request(url.toString(), request))
    }
    return env.ASSETS.fetch(request)
  },
}
`
const BROAD_ROUTES = '{"version":1,"include":["/v1/*"],"exclude":[]}\n'
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

function fixture(t, {
  worker = committed.worker, routes = committed.routes, pin = committed.pin,
  dist = true, distWorker = worker, distRoutes = routes,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'pulse-edge-freeze-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'public'))
  if (worker !== null) writeFileSync(join(root, 'public/_worker.js'), worker)
  if (routes !== null) writeFileSync(join(root, 'public/_routes.json'), routes)
  if (dist) {
    mkdirSync(join(root, 'dist'))
    if (distWorker !== null) writeFileSync(join(root, 'dist/_worker.js'), distWorker)
    if (distRoutes !== null) writeFileSync(join(root, 'dist/_routes.json'), distRoutes)
  }
  if (pin !== null) writeFileSync(join(root, EXCEPTION_FILE), typeof pin === 'string' ? pin : JSON.stringify(pin, null, 2))
  return root
}

function rejects(root, detail, options = {}) {
  assert.throws(() => assertEdgeFreeze(root, { now, ...options }), error => {
    assert.match(error.message, /^EDGE_FREEZE_APPROVAL_REQUIRED: /)
    assert.match(error.message, detail)
    return true
  })
}

test('the committed pin covers the committed Worker and routes with a 90-day expiry', () => {
  assert.deepEqual(Object.keys(committed.pin).sort(), ['approval', 'expires', 'routes', 'sha256'])
  assert.equal(committed.pin.sha256, sha256(committed.worker))
  assert.deepEqual(JSON.parse(committed.routes.toString('utf8')), committed.pin.routes)
  assert.deepEqual(committed.pin.routes, { version: 1, include: ['/v1/account/*', '/v1/billing/*'], exclude: [] })
  assert.equal(committed.pin.expires, '2026-12-24')
  assert.equal(typeof committed.pin.approval, 'string')
  assert.ok(committed.pin.approval.trim())
})

test('admits the pinned Worker only when public/ and dist/ both carry it before expiry', t => {
  const result = assertEdgeFreeze(fixture(t), { now })
  assert.deepEqual(result.admitted, {
    sha256: committed.pin.sha256, routes: committed.pin.routes, expires: '2026-12-24',
    approval: committed.pin.approval, checked: ['public', 'dist'],
  })
  assert.equal(assertEdgeFreeze(fixture(t), { now: new Date('2026-12-23T23:59:59Z') }).admitted.sha256, committed.pin.sha256)
})

test('worker-free output passes with or without a pin', t => {
  assert.deepEqual(assertEdgeFreeze(fixture(t, { worker: null, routes: null }), { now }), { admitted: null })
  assert.deepEqual(assertEdgeFreeze(fixture(t, { worker: null, routes: null, pin: null }), { now }), { admitted: null })
})

test('rejects the old broad /v1/* Worker, with or without its broad routes', t => {
  rejects(fixture(t, { worker: BROAD_WORKER }), /public\/_worker\.js sha256 [0-9a-f]{64} does not match the pinned/)
  rejects(fixture(t, { worker: BROAD_WORKER, routes: BROAD_ROUTES }), /does not match the pinned/)
  rejects(fixture(t, { worker: BROAD_WORKER, routes: BROAD_ROUTES, pin: null }), /has no edge-freeze-exception\.json pin/)
  const repinned = { ...committed.pin, sha256: sha256(BROAD_WORKER), routes: JSON.parse(BROAD_ROUTES) }
  rejects(fixture(t, { worker: BROAD_WORKER, routes: BROAD_ROUTES, pin: repinned }), /routes may include only/)
})

test('rejects Pages Functions even next to the pinned Worker', t => {
  const root = fixture(t)
  mkdirSync(join(root, 'functions'))
  rejects(root, /functions \(Pages Functions are never admitted\)/)
  rejects(root, /functions/, { sourceOnly: true })
  const workerFree = fixture(t, { worker: null, routes: null })
  mkdirSync(join(workerFree, 'functions'))
  rejects(workerFree, /Pages Functions/)
})

test('rejects a one-byte change in the source or the built Worker', t => {
  const changed = Buffer.from(committed.worker)
  changed[changed.length - 1] ^= 1
  rejects(fixture(t, { worker: changed, distWorker: committed.worker }), /public\/_worker\.js sha256 .* does not match/)
  rejects(fixture(t, { distWorker: changed }), /dist\/_worker\.js sha256 .* does not match/)
  rejects(fixture(t, { worker: changed, dist: false }), /public\/_worker\.js sha256/, { sourceOnly: true })
})

test('rejects an expired pin, a past date, and an expiry more than 90 days away', t => {
  rejects(fixture(t), /pin expired at 2026-12-24T00:00:00Z/, { now: new Date('2026-12-24T00:00:00Z') })
  rejects(fixture(t, { pin: { ...committed.pin, expires: '2026-09-01' } }), /pin expired at 2026-09-01/)
  rejects(fixture(t, { pin: { ...committed.pin, expires: '2027-06-01' } }), /more than 90 days away/)
  rejects(fixture(t, { pin: { ...committed.pin, expires: '2026-13-01' } }), /expires must be an ISO date/)
  rejects(fixture(t, { pin: { ...committed.pin, expires: '2026-12-24T12:00:00Z' } }), /expires must be an ISO date/)
})

test('requires _routes.json in public/ and dist/ to equal the pinned routes exactly', t => {
  rejects(fixture(t, { routes: BROAD_ROUTES }), /public\/_routes\.json does not equal the pinned routes/)
  rejects(fixture(t, { distRoutes: '{"version":1,"include":["/v1/account/*"],"exclude":[]}' }), /dist\/_routes\.json does not equal/)
  rejects(fixture(t, { routes: '{"version":1,"include":["/v1/billing/*","/v1/account/*"],"exclude":[]}' }), /does not equal/)
  rejects(fixture(t, { routes: '{"version":1,"include":["/v1/account/*","/v1/billing/*"],"exclude":[],"extra":1}' }), /does not equal/)
  rejects(fixture(t, { routes: null }), /public\/_routes\.json is missing/)
  rejects(fixture(t, { routes: 'not json' }), /public\/_routes\.json is not valid JSON/)
  rejects(fixture(t, { worker: null }), /public\/_routes\.json without an admitted _worker\.js/, { sourceOnly: true })
})

test('requires the built dist/ to carry the same Worker as public/', t => {
  rejects(fixture(t, { distWorker: null }), /dist\/_worker\.js is missing/)
  rejects(fixture(t, { dist: false }), /dist\/_worker\.js is missing/)
  rejects(fixture(t, { worker: null, routes: null, distWorker: committed.worker, distRoutes: committed.routes }),
    /public\/_worker\.js is missing/)
  assert.equal(assertEdgeFreeze(fixture(t, { dist: false }), { now, sourceOnly: true }).admitted.sha256, committed.pin.sha256)
})

test('rejects any other Worker or routes entry', t => {
  const extraModule = fixture(t)
  writeFileSync(join(extraModule, 'public/_worker.mjs'), BROAD_WORKER)
  rejects(extraModule, /public\/_worker\.mjs \(only a single _worker\.js file can be admitted\)/)
  const directory = fixture(t, { distWorker: null })
  mkdirSync(join(directory, 'dist/_worker.js'))
  writeFileSync(join(directory, 'dist/_worker.js/index.js'), BROAD_WORKER)
  rejects(directory, /dist\/_worker\.js is not a regular file/)
  const extraRoutes = fixture(t)
  writeFileSync(join(extraRoutes, 'dist/_routes.backup.json'), BROAD_ROUTES)
  rejects(extraRoutes, /dist\/_routes\.backup\.json/)
})

test('rejects a missing, malformed, or extended pin', t => {
  rejects(fixture(t, { pin: null }), /public\/_worker\.js, dist\/_worker\.js has no edge-freeze-exception\.json pin/)
  rejects(fixture(t, { pin: '{' }), /edge-freeze-exception\.json is not valid JSON/)
  rejects(fixture(t, { pin: { ...committed.pin, bypass: true } }), /must contain exactly approval, expires, routes, sha256/)
  rejects(fixture(t, { pin: { ...committed.pin, sha256: committed.pin.sha256.toUpperCase() } }), /sha256 must be 64 lowercase hex/)
  rejects(fixture(t, { pin: { ...committed.pin, approval: ' ' } }), /approval must be a non-empty reference/)
  rejects(fixture(t, { pin: { ...committed.pin, routes: { ...committed.pin.routes, version: 2 } } }), /routes must be a _routes\.json object/)
})

test('has no environment-variable or CLI bypass, and the deploy runs the full gate before uploading', t => {
  const gate = readFileSync(join(webRoot, 'scripts/check-edge-freeze.mjs'), 'utf8')
  assert.doesNotMatch(gate, /process\.env/)
  assert.doesNotMatch(gate, /process\.argv\[[2-9]\]/)
  const root = fixture(t, { worker: BROAD_WORKER })
  for (const name of ['EDGE_FREEZE_BYPASS', 'ALLOW_DIRTY_PAGES_DEPLOY', 'ALLOW_EDGE_WORKER']) process.env[name] = '1'
  t.after(() => { for (const name of ['EDGE_FREEZE_BYPASS', 'ALLOW_DIRTY_PAGES_DEPLOY', 'ALLOW_EDGE_WORKER']) delete process.env[name] })
  rejects(root, /does not match the pinned/)

  const deploy = readFileSync(join(webRoot, 'scripts/pages-deploy-prod.mjs'), 'utf8')
  const fullGate = deploy.indexOf('assertEdgeFreeze(webRoot)')
  const upload = deploy.indexOf('run(localWrangler, deployArgs)')
  assert.ok(deploy.includes('assertEdgeFreeze(webRoot, { sourceOnly: true })'))
  assert.ok(fullGate > deploy.indexOf("run('npx', ['vite', 'build'], buildEnv)"), 'full gate runs after the build')
  assert.ok(fullGate > 0 && fullGate < upload, 'full gate runs before wrangler uploads dist/')
  assert.ok(deploy.includes('assertEdgeFilesCommitted()'))
})
