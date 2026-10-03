import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  APPROVAL_DOCUMENT, EDGE_PATHS, EXCEPTION_FILE, WRANGLER_CONFIG_FILES, assertDeploySourceIsOriginMaster, assertEdgeFreeze,
  assertEdgeFreezeStructural, pinnedRoutesBytes,
} from './check-edge-freeze.mjs'

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
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function fixture(t, {
  worker = committed.worker, routes = committed.routes, pin = committed.pin,
  dist = true, distWorker = worker, distRoutes = routes, nested = false,
} = {}) {
  const top = mkdtempSync(join(tmpdir(), 'pulse-edge-freeze-'))
  t.after(() => rmSync(top, { recursive: true, force: true }))
  const root = nested ? join(top, 'streampulse-web') : top
  mkdirSync(join(root, 'public'), { recursive: true })
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
  assert.throws(() => assertEdgeFreezeStructural(root, { now, ...options }), error => {
    assert.match(error.message, /^EDGE_FREEZE_APPROVAL_REQUIRED: /)
    assert.match(error.message, detail)
    return true
  })
}

test('the committed pin covers the committed Worker and routes with a 90-day expiry', () => {
  assert.deepEqual(Object.keys(committed.pin).sort(), ['approval', 'expires', 'routes', 'sha256'])
  assert.equal(committed.pin.sha256, sha256(committed.worker))
  assert.deepEqual(JSON.parse(committed.routes.toString('utf8')), committed.pin.routes)
  assert.equal(committed.routes.toString('utf8'), pinnedRoutesBytes(committed.pin.routes))
  assert.deepEqual(committed.pin.routes, { version: 1, include: ['/v1/account/*', '/v1/billing/*'], exclude: [] })
  assert.equal(committed.pin.expires, '2026-12-24')
  assert.equal(typeof committed.pin.approval, 'string')
  assert.ok(committed.pin.approval.trim())
})

test('production rejects the unapproved prepared relay and arbitrary approval text', t => {
  for (const approval of [committed.pin.approval, 'Owner approved this relay', 'streampulse-sdlc@' + 'a'.repeat(40) + ':../other.md']) {
    assert.throws(() => assertEdgeFreeze(fixture(t, { pin: { ...committed.pin, approval } }), { now }), /approval must reference an immutable merged streampulse-sdlc document/)
  }
})

function mergedApprovalFixture(t, policyOverrides = {}) {
  const top = mkdtempSync(join(tmpdir(), 'pulse-edge-approval-'))
  t.after(() => rmSync(top, { recursive: true, force: true }))
  const product = join(top, 'streamclone-pulse')
  const web = join(product, 'streampulse-web')
  const sdlc = join(top, 'streampulse-sdlc')
  mkdirSync(join(web, 'public'), { recursive: true }); mkdirSync(join(web, 'dist'))
  mkdirSync(sdlc)
  const config = join(top, 'gitconfig'); writeFileSync(config, '')
  const env = { ...process.env, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' }
  const fixtureGit = (cwd, ...args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', env })
    assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`)
    return result.stdout.trim()
  }
  fixtureGit(product, 'init', '--quiet', '--initial-branch=master')
  fixtureGit(sdlc, 'init', '--quiet', '--initial-branch=master')
  fixtureGit(sdlc, 'remote', 'add', 'origin', 'https://github.com/Aron-Chu/streampulse-sdlc.git')
  const policy = { version: 2, status: 'approved', workerSha256: committed.pin.sha256, routes: committed.pin.routes, expires: committed.pin.expires, ...policyOverrides }
  mkdirSync(dirname(join(sdlc, APPROVAL_DOCUMENT)), { recursive: true })
  const document = `# Synthetic test authority\n\n\`\`\`edge-approval-json\n${JSON.stringify(policy)}\n\`\`\`\n`
  writeFileSync(join(sdlc, APPROVAL_DOCUMENT), document)
  fixtureGit(sdlc, 'add', APPROVAL_DOCUMENT); fixtureGit(sdlc, 'commit', '--quiet', '-m', 'synthetic policy test')
  const revision = fixtureGit(sdlc, 'rev-parse', 'HEAD')
  fixtureGit(sdlc, 'update-ref', 'refs/remotes/origin/master', revision)
  const pin = { ...committed.pin, approval: `streampulse-sdlc@${revision}:${APPROVAL_DOCUMENT}` }
  writeFileSync(join(web, EXCEPTION_FILE), JSON.stringify(pin))
  for (const dir of ['public', 'dist']) {
    writeFileSync(join(web, dir, '_worker.js'), committed.worker)
    writeFileSync(join(web, dir, '_routes.json'), committed.routes)
  }
  return { web, sdlc, revision, fixtureGit, document, pin }
}

test('production admits only a merged immutable policy binding the exact prepared relay', t => {
  const { web, sdlc } = mergedApprovalFixture(t)
  assert.equal(assertEdgeFreeze(web, { now }).admitted.sha256, committed.pin.sha256)
  // An edited working-tree document is not an authority; only merged Git objects count.
  writeFileSync(join(sdlc, APPROVAL_DOCUMENT), 'working-tree text is deliberately ignored')
  assert.equal(assertEdgeFreeze(web, { now, sourceOnly: true }).admitted.sha256, committed.pin.sha256)
})

test('production rejects draft, mismatched, future/unmerged and superseded policy documents', t => {
  for (const policy of [{ status: 'draft' }, { version: 1 }, { workerSha256: 'b'.repeat(64) }, { expires: '2026-12-23' }, { routes: { ...committed.pin.routes, include: ['/v1/account/*'] } }, { bypass: true }]) {
    const { web } = mergedApprovalFixture(t, policy)
    assert.throws(() => assertEdgeFreeze(web, { now }), /approval document must be approved amendment version 2|does not bind the exact/)
  }
  const unmerged = mergedApprovalFixture(t)
  writeFileSync(join(unmerged.sdlc, APPROVAL_DOCUMENT), unmerged.document + '\nUnmerged change\n')
  unmerged.fixtureGit(unmerged.sdlc, 'commit', '--quiet', '-am', 'unmerged policy')
  const future = unmerged.fixtureGit(unmerged.sdlc, 'rev-parse', 'HEAD')
  writeFileSync(join(unmerged.web, EXCEPTION_FILE), JSON.stringify({ ...unmerged.pin, approval: `streampulse-sdlc@${future}:${APPROVAL_DOCUMENT}` }))
  assert.throws(() => assertEdgeFreeze(unmerged.web, { now }), /not merged into SDLC origin\/master/)
  const superseded = mergedApprovalFixture(t)
  writeFileSync(join(superseded.sdlc, APPROVAL_DOCUMENT), superseded.document + '\nRevoked\n')
  superseded.fixtureGit(superseded.sdlc, 'commit', '--quiet', '-am', 'supersede policy')
  superseded.fixtureGit(superseded.sdlc, 'update-ref', 'refs/remotes/origin/master', 'HEAD')
  assert.throws(() => assertEdgeFreeze(superseded.web, { now }), /superseded on SDLC origin\/master/)
})

test('production rejects an absent commit, wrong document path and noncanonical or credentialed origins', t => {
  for (const remote of ['https://github.com/other/streampulse-sdlc.git', 'https://credential@github.com/Aron-Chu/streampulse-sdlc.git', 'https://github.com/Aron-Chu/streampulse-sdlc.git?approved=1']) {
    const { web, sdlc, fixtureGit } = mergedApprovalFixture(t)
    fixtureGit(sdlc, 'remote', 'set-url', 'origin', remote)
    assert.throws(() => assertEdgeFreeze(web, { now }), /canonical streampulse-sdlc origin without embedded credentials/)
  }
  const { web, pin } = mergedApprovalFixture(t)
  writeFileSync(join(web, EXCEPTION_FILE), JSON.stringify({ ...pin, approval: `streampulse-sdlc@${'a'.repeat(40)}:${APPROVAL_DOCUMENT}` }))
  assert.throws(() => assertEdgeFreeze(web, { now }), /commit and SDLC origin\/master must exist locally/)
})

test('production rejects Git configuration URL rewriting of a foreign approval authority', t => {
  const { web, sdlc, fixtureGit } = mergedApprovalFixture(t)
  fixtureGit(sdlc, 'remote', 'set-url', 'origin', 'https://github.com/untrusted/fake.git')
  assert.throws(() => assertEdgeFreeze(web, { now }), /canonical streampulse-sdlc origin without embedded credentials/)
  const injected = {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'url.https://github.com/Aron-Chu/streampulse-sdlc.git.insteadOf',
    GIT_CONFIG_VALUE_0: 'https://github.com/untrusted/fake.git',
  }
  // Never read or replace an inherited value; these variables belong only to
  // this synthetic test process and are deleted even when the assertion fails.
  for (const name of Object.keys(injected)) assert.equal(Object.hasOwn(process.env, name), false)
  Object.assign(process.env, injected)
  try {
    assert.throws(() => assertEdgeFreeze(web, { now }), /Git authority or configuration environment overrides are not permitted/)
  } finally {
    for (const name of Object.keys(injected)) delete process.env[name]
  }
})

test('production rejects repository/config/object authority environment overrides without reading their values', t => {
  const { web } = mergedApprovalFixture(t)
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_NAMESPACE', 'GIT_REPLACE_REF_BASE', 'GIT_SHALLOW_FILE']) {
    assert.equal(Object.hasOwn(process.env, name), false)
    process.env[name] = 'synthetic-nonsecret-test-value'
    try {
      assert.throws(() => assertEdgeFreeze(web, { now }), /Git authority or configuration environment overrides are not permitted/)
    } finally { delete process.env[name] }
  }
})

test('production checks one raw local origin URL, ignoring insteadOf and conditional config includes', t => {
  const rewritten = mergedApprovalFixture(t)
  rewritten.fixtureGit(rewritten.sdlc, 'remote', 'set-url', 'origin', 'https://github.com/untrusted/fake.git')
  rewritten.fixtureGit(rewritten.sdlc, 'config', '--local', 'url.https://github.com/Aron-Chu/streampulse-sdlc.git.insteadOf', 'https://github.com/untrusted/fake.git')
  assert.throws(() => assertEdgeFreeze(rewritten.web, { now }), /canonical streampulse-sdlc origin without embedded credentials/)
  const duplicate = mergedApprovalFixture(t)
  duplicate.fixtureGit(duplicate.sdlc, 'config', '--local', '--add', 'remote.origin.url', 'https://github.com/Aron-Chu/streampulse-sdlc.git')
  assert.throws(() => assertEdgeFreeze(duplicate.web, { now }), /canonical streampulse-sdlc origin without embedded credentials/)
  const included = mergedApprovalFixture(t)
  included.fixtureGit(included.sdlc, 'config', '--local', '--unset-all', 'remote.origin.url')
  const includeFile = join(included.sdlc, '.git', 'synthetic-remote-config')
  writeFileSync(includeFile, '[remote "origin"]\nurl = https://github.com/Aron-Chu/streampulse-sdlc.git\n')
  included.fixtureGit(included.sdlc, 'config', '--local', `includeIf.gitdir:${included.sdlc.replaceAll('\\', '/')}/.git/.path`, includeFile.replaceAll('\\', '/'))
  assert.throws(() => assertEdgeFreeze(included.web, { now }), /canonical streampulse-sdlc origin without embedded credentials/)
})

test('admits the pinned Worker only when public/ and dist/ both carry it before expiry', t => {
  const result = assertEdgeFreezeStructural(fixture(t), { now })
  assert.deepEqual(result.admitted, {
    sha256: committed.pin.sha256, routes: committed.pin.routes, expires: '2026-12-24',
    approval: committed.pin.approval, checked: ['public', 'dist'],
  })
  assert.equal(assertEdgeFreezeStructural(fixture(t), { now: new Date('2026-12-23T23:59:59Z') }).admitted.sha256, committed.pin.sha256)
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

test('requires _routes.json in public/ and dist/ to be the exact pinned bytes', t => {
  const notExact = dir => new RegExp(`${dir}/_routes\\.json is not byte-for-byte JSON\\.stringify\\(pinned routes\\) plus a newline`)
  rejects(fixture(t, { routes: BROAD_ROUTES }), notExact('public'))
  rejects(fixture(t, { distRoutes: '{"version":1,"include":["/v1/account/*"],"exclude":[]}\n' }), notExact('dist'))
  rejects(fixture(t, { routes: '{"version":1,"include":["/v1/billing/*","/v1/account/*"],"exclude":[]}\n' }), notExact('public'))
  rejects(fixture(t, { routes: '{"version":1,"include":["/v1/account/*","/v1/billing/*"],"exclude":[],"extra":1}\n' }), notExact('public'))
  rejects(fixture(t, { routes: null }), /public\/_routes\.json is missing/)
  rejects(fixture(t, { routes: 'not json' }), notExact('public'))
  rejects(fixture(t, { worker: null }), /public\/_routes\.json without an admitted _worker\.js/, { sourceOnly: true })
})

test('rejects _routes.json that parses to the pinned routes but is not the pinned bytes', t => {
  // Duplicate keys parse to the pinned object (the last key wins), yet wrangler uploads these raw bytes.
  const duplicateKey = '{"version":1,"include":["/v1/*"],"include":["/v1/account/*","/v1/billing/*"],"exclude":[]}\n'
  const reformatted = `${JSON.stringify(committed.pin.routes, null, 2)}\n`
  const reordered = '{"include":["/v1/account/*","/v1/billing/*"],"exclude":[],"version":1}\n'
  const noNewline = JSON.stringify(committed.pin.routes)
  const crlf = `${JSON.stringify(committed.pin.routes)}\r\n`
  for (const routes of [duplicateKey, reformatted, reordered, noNewline, crlf]) {
    assert.deepEqual(JSON.parse(routes), committed.pin.routes, routes)
    rejects(fixture(t, { routes, distRoutes: routes }), /public\/_routes\.json is not byte-for-byte/)
    rejects(fixture(t, { distRoutes: routes }), /dist\/_routes\.json is not byte-for-byte/)
  }
})

test('rejects wrangler config and its deploy redirect in streampulse-web/ or any parent, worker or not', t => {
  assert.deepEqual(WRANGLER_CONFIG_FILES, ['wrangler.json', 'wrangler.jsonc', 'wrangler.toml', '.wrangler/deploy/config.json'])
  for (const name of WRANGLER_CONFIG_FILES) {
    const bindings = name.endsWith('.toml') ? '[[kv_namespaces]]\nbinding = "EDGE"\n' : '{"kv_namespaces":[{"binding":"EDGE"}]}'
    for (const options of [{}, { worker: null, routes: null }]) {
      const root = fixture(t, options)
      mkdirSync(dirname(join(root, name)), { recursive: true })
      writeFileSync(join(root, name), bindings)
      rejects(root, new RegExp(`${escape(name)} \\(wrangler config and bindings are never admitted\\)`))
      rejects(root, /wrangler config/, { sourceOnly: true })
    }
    const nested = fixture(t, { nested: true })
    mkdirSync(dirname(join(nested, '..', name)), { recursive: true })
    writeFileSync(join(nested, '..', name), bindings)
    rejects(nested, new RegExp(`\\.\\./${escape(name)} \\(wrangler config`))
  }
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

test('edge paths cover the Worker, routes, pin, gate, deploy script, Functions, and wrangler config', () => {
  assert.deepEqual(EDGE_PATHS, [
    'public/_worker.js', 'public/_routes.json', 'edge-freeze-exception.json',
    'scripts/check-edge-freeze.mjs', 'scripts/pages-deploy-prod.mjs', 'functions',
    'wrangler.json', 'wrangler.jsonc', 'wrangler.toml', '.wrangler/deploy/config.json',
  ])
})

test('has no environment-variable or CLI bypass, and the deploy runs every edge check before uploading', t => {
  const gate = readFileSync(join(webRoot, 'scripts/check-edge-freeze.mjs'), 'utf8')
  assert.match(gate, /Object\.keys\(process\.env\)/)
  assert.doesNotMatch(gate, /process\.env\[|process\.env\./)
  assert.doesNotMatch(gate, /process\.argv\[[2-9]\]/)
  const root = fixture(t, { worker: BROAD_WORKER })
  for (const name of ['EDGE_FREEZE_BYPASS', 'ALLOW_DIRTY_PAGES_DEPLOY', 'ALLOW_EDGE_WORKER']) process.env[name] = '1'
  t.after(() => { for (const name of ['EDGE_FREEZE_BYPASS', 'ALLOW_DIRTY_PAGES_DEPLOY', 'ALLOW_EDGE_WORKER']) delete process.env[name] })
  rejects(root, /does not match the pinned/)

  const deploy = readFileSync(join(webRoot, 'scripts/pages-deploy-prod.mjs'), 'utf8')
  const build = deploy.indexOf("run('npx', ['vite', 'build'], buildEnv)")
  const fullGate = deploy.indexOf('assertEdgeFreeze(webRoot))')
  const upload = deploy.indexOf('run(localWrangler, deployArgs)')
  assert.ok(deploy.includes('assertEdgeFreeze(webRoot, { sourceOnly: true })'))
  assert.ok(fullGate > build, 'full gate runs after the build')
  assert.ok(fullGate > 0 && fullGate < upload, 'full gate runs before wrangler uploads dist/')
  const sourceChecks = [...deploy.matchAll(/edgeCheck\(\(\) => assertDeploySourceIsOriginMaster\(webRoot\)\)/g)].map(match => match.index)
  assert.equal(sourceChecks.length, 2, 'the origin/master check runs before the build and again before upload')
  assert.ok(sourceChecks[0] > deploy.indexOf('\nassertCleanGitTree()\n') && sourceChecks[0] < build)
  assert.ok(sourceChecks[1] > fullGate && sourceChecks[1] < upload)
  const targetChecks = [...deploy.matchAll(/requireApexTargetForWorker\((sourceGate|builtGate), projectName\)/g)].map(match => match.index)
  assert.equal(targetChecks.length, 2)
  assert.ok(targetChecks[0] < build && targetChecks[1] > fullGate && targetChecks[1] < upload)
  const target = deploy.slice(deploy.indexOf('function requireApexTargetForWorker'), deploy.indexOf('const sourceGate'))
  assert.match(target, /if \(!process\.env\.CLOUDFLARE_ACCOUNT_ID\?\.trim\(\)\) \{\n\s+console\.error\('[^'$`]*'\)\n\s+process\.exit\(1\)/)
  assert.doesNotMatch(target, /ALLOW_DIRTY|\$\{process\.env/)
})

test('deploy source must be a fresh origin/master with byte-identical edge files', t => {
  const top = mkdtempSync(join(tmpdir(), 'pulse-edge-source-'))
  t.after(() => rmSync(top, { recursive: true, force: true }))
  // Hermetic git: no user or system config (hooks, signing, aliases) reaches the throwaway fixture repos.
  writeFileSync(join(top, 'gitconfig'), '')
  const hermetic = {
    GIT_CONFIG_GLOBAL: join(top, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  }
  const saved = Object.fromEntries(Object.keys(hermetic).map(name => [name, process.env[name]]))
  Object.assign(process.env, hermetic)
  t.after(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })
  const git = (cwd, ...args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
    assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`)
    return result.stdout.trim()
  }
  const origin = join(top, 'origin.git')
  const work = join(top, 'work')
  const web = join(work, 'streampulse-web')
  git(top, 'init', '--quiet', '--bare', '--initial-branch=master', origin)
  git(top, 'init', '--quiet', '--initial-branch=master', work)
  mkdirSync(join(web, 'public'), { recursive: true })
  writeFileSync(join(web, 'public/_worker.js'), committed.worker)
  writeFileSync(join(web, 'public/_routes.json'), committed.routes)
  writeFileSync(join(web, EXCEPTION_FILE), JSON.stringify(committed.pin, null, 2))
  writeFileSync(join(work, '.gitignore'), 'wrangler.toml\n')
  git(work, 'add', '-A')
  git(work, 'commit', '--quiet', '-m', 'fixture')
  git(work, 'remote', 'add', 'origin', origin)
  git(work, 'push', '--quiet', 'origin', 'master')
  assert.equal(assertDeploySourceIsOriginMaster(web).head, git(work, 'rev-parse', 'HEAD'))
  const refuses = detail => assert.throws(() => assertDeploySourceIsOriginMaster(web), error => {
    assert.match(error.message, /^EDGE_DEPLOY_SOURCE_REJECTED: /)
    assert.match(error.message, detail)
    return true
  })

  // A locally committed Worker plus a matching new pin is not origin/master.
  const changed = Buffer.concat([committed.worker, Buffer.from('// local\n')])
  writeFileSync(join(web, 'public/_worker.js'), changed)
  writeFileSync(join(web, EXCEPTION_FILE), JSON.stringify({ ...committed.pin, sha256: sha256(changed) }, null, 2))
  git(work, 'commit', '--quiet', '-am', 'local re-pin')
  refuses(/HEAD [0-9a-f]{40} is not origin\/master [0-9a-f]{40}/)
  git(work, 'reset', '--quiet', '--hard', 'refs/remotes/origin/master')
  assertDeploySourceIsOriginMaster(web)

  // assume-unchanged hides the edit from git status and git diff; the byte comparison does not.
  git(work, 'update-index', '--assume-unchanged', 'streampulse-web/public/_worker.js')
  writeFileSync(join(web, 'public/_worker.js'), changed)
  assert.equal(git(work, 'status', '--porcelain'), '')
  refuses(/public\/_worker\.js content differs from origin\/master/)
  git(work, 'update-index', '--no-assume-unchanged', 'streampulse-web/public/_worker.js')
  refuses(/uncommitted edge files/)
  git(work, 'checkout', '--quiet', '--', 'streampulse-web/public/_worker.js')

  // Staged edits, untracked wrangler config, and ignored wrangler config are refused too.
  writeFileSync(join(web, 'public/_routes.json'), BROAD_ROUTES)
  git(work, 'add', 'streampulse-web/public/_routes.json')
  refuses(/uncommitted edge files/)
  git(work, 'reset', '--quiet', '--hard', 'refs/remotes/origin/master')
  writeFileSync(join(web, 'wrangler.json'), '{}')
  refuses(/uncommitted edge files/)
  rmSync(join(web, 'wrangler.json'))
  writeFileSync(join(web, 'wrangler.toml'), '[vars]\n')
  assert.equal(git(work, 'status', '--porcelain'), '', 'wrangler.toml is ignored in the fixture')
  refuses(/wrangler\.toml exists locally but not on origin\/master/)
  rmSync(join(web, 'wrangler.toml'))
  assert.equal(assertDeploySourceIsOriginMaster(web).head, git(work, 'rev-parse', 'refs/remotes/origin/master'))
})
