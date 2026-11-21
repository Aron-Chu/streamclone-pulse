/**
 * Lightweight self-test for exact-GHSA disposition gate (no vitest install required).
 * Uses in-repo fixtures (no os.tmpdir writes — avoids CodeQL js/insecure-temporary-file).
 * Run: node scripts/ci-portal-npm-audit-disposition.selftest.mjs
 */
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join as pathJoin } from 'node:path'
import {
  BUILD_ONLY_PACKAGES,
  PICOMATCH_DISPOSITION_EXPIRES,
  assertBuildOnlyAuditRuntimeBoundary,
  auditHasExactBuildOnlyPicomatchGraph,
  evaluateHighs,
} from './ci-portal-npm-audit-disposition.mjs'

const root = pathJoin(dirname(fileURLToPath(import.meta.url)), '..')
const script = pathJoin(root, 'scripts', 'ci-portal-npm-audit-disposition.mjs')
const fixtures = pathJoin(root, 'scripts', 'fixtures')

function run(fixtureName, extraArgs = [], cwd = root) {
  return spawnSync(process.execPath, [script, ...extraArgs, pathJoin(fixtures, fixtureName)], {
    encoding: 'utf8',
    cwd,
  })
}

const wrong = run('npm-audit-wrong-ghsa.json')
if (wrong.status === 0 || !String(wrong.stderr).includes('GHSA-qwww-vcr4-c8h2')) {
  console.error('expected reject without exact GHSA', wrong)
  process.exit(1)
}

const parentOnly = run('npm-audit-dom-via-parent.json')
if (parentOnly.status !== 0) {
  console.error('expected accept when react-router-dom via is parent name and parent has GHSA', parentOnly)
  process.exit(1)
}

const missingDomGhsaButHasRouter = run('npm-audit-missing-ghsa-on-dom.json')
if (missingDomGhsaButHasRouter.status !== 0) {
  console.error('expected accept for react-router-only high with exact GHSA', missingDomGhsaButHasRouter)
  process.exit(1)
}

const malformed = run('npm-audit-malformed.json')
if (malformed.status === 0 || !String(malformed.stderr).includes('could not parse npm audit JSON')) {
  console.error('expected reject for malformed npm audit JSON', malformed)
  process.exit(1)
}

const missingSchema = run('npm-audit-missing-vulnerability-schema.json')
if (missingSchema.status === 0 || !String(missingSchema.stderr).includes('vulnerabilities object is required')) {
  console.error('expected reject for missing vulnerability schema', missingSchema)
  process.exit(1)
}

const auditError = run('npm-audit-dom-via-parent.json', ['--npm-exit-code', '2'])
if (auditError.status === 0 || !String(auditError.stderr).includes('npm audit command failed with exit code 2')) {
  console.error('expected reject for npm audit command error', auditError)
  process.exit(1)
}

const extraHigh = run('npm-audit-extra-high.json')
if (extraHigh.status === 0 || !String(extraHigh.stderr).includes('some-new-package')) {
  console.error('expected reject for an extra high advisory', extraHigh)
  process.exit(1)
}

const mismatchedMetadata = run('npm-audit-mismatched-metadata.json')
if (mismatchedMetadata.status === 0 || !String(mismatchedMetadata.stderr).includes('matching advisory metadata')) {
  console.error('expected reject for mismatched advisory metadata', mismatchedMetadata)
  process.exit(1)
}


// Build-only picomatch exception: exact reviewed graph per lock, before its expiry.
const beforeExpiry = new Date('2026-11-20T00:00:00.000Z')
const atExpiry = new Date(PICOMATCH_DISPOSITION_EXPIRES)
const lockAt = (dir) => JSON.parse(readFileSync(pathJoin(root, dir, 'package-lock.json'), 'utf8'))
const fixture = (name) => JSON.parse(readFileSync(pathJoin(fixtures, name), 'utf8'))
const graphs = {
  root: { audit: fixture('npm-audit-build-only-picomatch-root.json'), lock: lockAt('.') },
  portal: { audit: fixture('npm-audit-build-only-picomatch-portal.json'), lock: lockAt('streampulse-web') },
}

for (const [label, { audit, lock }] of Object.entries(graphs)) {
  const result = evaluateHighs(audit.vulnerabilities, { readLock: () => lock, now: beforeExpiry })
  assert.deepEqual(result.unexpected, [], `${label}: real audit is fully covered`)
  assert.ok(result.dispositioned.length > 0, `${label}: graph exercised`)
  for (const hit of result.highs) {
    assert.equal(auditHasExactBuildOnlyPicomatchGraph(audit.vulnerabilities, hit.name, lock, beforeExpiry), true, `${label} ${hit.name}`)
  }
  const expired = evaluateHighs(audit.vulnerabilities, { readLock: () => lock, now: atExpiry })
  assert.equal(expired.dispositioned.length, 0, `${label}: nothing passes at the expiry instant`)
  assert.ok(expired.unexpected.every((line) => line.includes('disposition expired')), `${label}: expiry is named`)
  for (const bad of [undefined, new Date('not a date'), '2026-11-20']) {
    assert.equal(auditHasExactBuildOnlyPicomatchGraph(audit.vulnerabilities, 'picomatch', lock, bad), false, `${label}: invalid clock`)
  }
}

// One lock's graph never covers the other lock.
assert.equal(auditHasExactBuildOnlyPicomatchGraph(graphs.portal.audit.vulnerabilities, 'tailwindcss', graphs.root.lock, beforeExpiry), false, 'portal graph on root lock')
assert.equal(auditHasExactBuildOnlyPicomatchGraph(graphs.root.audit.vulnerabilities, 'vite', graphs.portal.lock, beforeExpiry), false, 'root graph on portal lock')

// The CLI reads the lock in its working directory, so the portal report fails from the root.
const portalFromRoot = run('npm-audit-build-only-picomatch-portal.json', ['--npm-exit-code', '1'], root)
assert.notEqual(portalFromRoot.status, 0, 'portal report against the root lock')
assert.match(String(portalFromRoot.stderr), /tailwindcss \((?:disposition requires the exact reviewed build-only GHSA-fc5q-39xc-vjpf graph|build-only GHSA-fc5q-39xc-vjpf disposition expired)/)

function rejectChangedPortalGraph(label, change, name = 'tailwindcss') {
  const vulns = structuredClone(graphs.portal.audit.vulnerabilities)
  const lock = structuredClone(graphs.portal.lock)
  change(vulns, lock)
  assert.equal(auditHasExactBuildOnlyPicomatchGraph(vulns, name, lock, beforeExpiry), false, label)
}
const advisory = graphs.portal.audit.vulnerabilities.picomatch.via[0]
rejectChangedPortalGraph('second advisory on picomatch', (v) => v.picomatch.via.push({ ...advisory, source: 1, url: 'https://github.com/advisories/GHSA-other-xxxx-xxxx' }))
rejectChangedPortalGraph('lower advisory beside it on picomatch', (v) => v.picomatch.via.push({ ...advisory, severity: 'moderate', url: 'https://github.com/advisories/GHSA-other-xxxx-xxxx' }))
rejectChangedPortalGraph('wrong advisory', (v) => { v.picomatch.via[0].url = 'https://github.com/advisories/GHSA-other-xxxx-xxxx' })
rejectChangedPortalGraph('changed advisory range', (v) => { v.picomatch.via[0].range = '<=4.0.8' })
rejectChangedPortalGraph('changed advisory source', (v) => { v.picomatch.via[0].source = 1247711 })
rejectChangedPortalGraph('critical severity', (v) => { v.picomatch.severity = 'critical' })
rejectChangedPortalGraph('missing graph package', (v) => { delete v.chokidar })
rejectChangedPortalGraph('missing advisory package', (v) => { delete v.picomatch }, 'vite')
rejectChangedPortalGraph('unreviewed parent', (v) => { v.micromatch.via = ['another-package'] })
rejectChangedPortalGraph('parent outside this graph', (v) => { v.micromatch.via = ['react-router'] })
rejectChangedPortalGraph('cycle', (v) => { v.chokidar.via = ['tailwindcss'] })
rejectChangedPortalGraph('duplicate parent', (v) => { v.tailwindcss.via = ['micromatch', 'micromatch', 'chokidar', 'fast-glob'] })
rejectChangedPortalGraph('missing parent edge', (v) => { v.tailwindcss.via = ['micromatch', 'chokidar'] })
rejectChangedPortalGraph('extra high advisory on a parent', (v) => v.micromatch.via.push({ ...advisory, name: 'micromatch', dependency: 'micromatch' }))
rejectChangedPortalGraph('lower package turned high', (v) => { v['@vitest/mocker'].severity = 'high' }, 'vitest')
rejectChangedPortalGraph('lower edge to an unknown package', (v) => v.vitest.via.push('unknown-package'), 'vitest')
rejectChangedPortalGraph('additional installed node', (v) => v.picomatch.nodes.push('node_modules/other/node_modules/picomatch'))
rejectChangedPortalGraph('duplicate installed node', (v) => { v.tailwindcss.nodes = ['node_modules/tailwindcss', 'node_modules/tailwindcss'] })
rejectChangedPortalGraph('missing installed node', (v) => { v.vite.nodes = ['node_modules/vite'] })
rejectChangedPortalGraph('missing lock entry', (_v, l) => { delete l.packages['node_modules/picomatch'] })
rejectChangedPortalGraph('production dependency', (_v, l) => { l.packages['node_modules/vite/node_modules/picomatch'].dev = false })
rejectChangedPortalGraph('optional-only flag instead of dev', (_v, l) => { delete l.packages['node_modules/sucrase'].dev; l.packages['node_modules/sucrase'].devOptional = true })
rejectChangedPortalGraph('new locked version', (_v, l) => { l.packages['node_modules/picomatch'].version = '2.3.3' })
rejectChangedPortalGraph('root lock lookalike', (_v, l) => { l.name = 'streamclone-pulse'; l.packages[''].name = 'streamclone-pulse' })
rejectChangedPortalGraph('mismatched lock identity', (_v, l) => { l.packages[''].name = 'streamclone-pulse' })
rejectChangedPortalGraph('lock name from the prototype', (_v, l) => { l.name = 'constructor'; l.packages[''].name = 'constructor' })
rejectChangedPortalGraph('name outside the graph', () => {}, 'react-router')
const leafOnly = { picomatch: graphs.portal.audit.vulnerabilities.picomatch }
assert.equal(auditHasExactBuildOnlyPicomatchGraph(leafOnly, 'picomatch', graphs.portal.lock, beforeExpiry), false, 'partial graph cannot qualify')

// A lower advisory on vitest (already in the real report) does not block the graph,
// but a new high finding outside the graph still fails the whole report.
{
  const vulns = structuredClone(graphs.portal.audit.vulnerabilities)
  vulns['some-new-package'] = { name: 'some-new-package', severity: 'high', via: ['picomatch'], nodes: ['node_modules/some-new-package'] }
  const result = evaluateHighs(vulns, { readLock: () => graphs.portal.lock, now: beforeExpiry })
  assert.deepEqual(result.unexpected, ['high some-new-package (no disposition)'])
}

// No lock read when nothing could be build-only.
evaluateHighs({}, { readLock: () => { throw new Error('lock read without need') }, now: beforeExpiry })

assert.doesNotThrow(() => assertBuildOnlyAuditRuntimeBoundary({
  'index.js': { type: 'chunk', modules: { '/repo/src/main.tsx': {}, '\0vite/preload-helper.js': {}, '/repo/node_modules/vite-node/dist/x.js': {} } },
  'style.css': { type: 'asset', source: '/* compiled utilities */' },
}))
for (const name of BUILD_ONLY_PACKAGES) {
  // Even a lazy, nested, Windows-path module must refuse publication.
  assert.throws(() => assertBuildOnlyAuditRuntimeBoundary({
    'index.js': { type: 'chunk', modules: { '/repo/src/main.tsx': {} } },
    'lazy.js': { type: 'chunk', modules: { [`C:\\repo\\node_modules\\other\\node_modules\\${name.replace('/', '\\')}\\index.js`]: {} } },
  }), /Build-only audit dependency in browser output/, name)
}

console.log('ci-portal-npm-audit-disposition.selftest: OK')
