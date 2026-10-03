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
import { auditHasExactBuildOnlyBracesGhsa, assertBuildOnlyBracesRuntimeBoundary } from './ci-portal-npm-audit-disposition.mjs'

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

const buildOnlyFixture = JSON.parse(readFileSync(pathJoin(fixtures, 'npm-audit-build-only-braces.json'), 'utf8'))
const portalLock = JSON.parse(readFileSync(pathJoin(root, 'streampulse-web/package-lock.json'), 'utf8'))
const buildOnly = run('npm-audit-build-only-braces.json', ['--npm-exit-code', '1'], pathJoin(root, 'streampulse-web'))
assert.equal(buildOnly.status, 0, buildOnly.stderr)
for (const name of Object.keys(buildOnlyFixture.vulnerabilities)) {
  assert.equal(auditHasExactBuildOnlyBracesGhsa(buildOnlyFixture.vulnerabilities, name, portalLock), true, name)
}

function rejectChangedBuildOnly(label, change) {
  const vulns = structuredClone(buildOnlyFixture.vulnerabilities)
  const lock = structuredClone(portalLock)
  change(vulns, lock)
  assert.equal(auditHasExactBuildOnlyBracesGhsa(vulns, 'tailwindcss', lock), false, label)
}
rejectChangedBuildOnly('second advisory on same package', (v) => v.braces.via.push({ ...v.braces.via[0], url: 'https://github.com/advisories/GHSA-other-xxxx-xxxx' }))
rejectChangedBuildOnly('wrong advisory', (v) => { v.braces.via[0].url = 'https://github.com/advisories/GHSA-other-xxxx-xxxx' })
rejectChangedBuildOnly('changed advisory metadata', (v) => { v.braces.via[0].range = '<=3.0.4' })
rejectChangedBuildOnly('critical severity', (v) => { v.braces.severity = 'critical' })
rejectChangedBuildOnly('missing advisory node', (v) => { delete v.braces })
rejectChangedBuildOnly('unreviewed parent', (v) => { v.micromatch.via = ['another-package'] })
rejectChangedBuildOnly('cycle', (v) => { v.chokidar.via = ['tailwindcss'] })
rejectChangedBuildOnly('extra parent advisory', (v) => v.micromatch.via.push(v.braces.via[0]))
rejectChangedBuildOnly('duplicate parent', (v) => { v.tailwindcss.via = ['micromatch', 'micromatch', 'chokidar'] })
rejectChangedBuildOnly('missing parent edge', (v) => { v.tailwindcss.via = ['micromatch'] })
rejectChangedBuildOnly('additional installed node', (v) => v.braces.nodes.push('node_modules/other/node_modules/braces'))
rejectChangedBuildOnly('missing lock entry', (_v, l) => { delete l.packages['node_modules/braces'] })
rejectChangedBuildOnly('production dependency', (_v, l) => { l.packages['node_modules/braces'].dev = false })
rejectChangedBuildOnly('new locked version', (_v, l) => { l.packages['node_modules/braces'].version = '3.0.4' })
rejectChangedBuildOnly('root lock lookalike', (_v, l) => { l.name = 'streamclone-pulse'; l.packages[''].name = 'streamclone-pulse' })
rejectChangedBuildOnly('mismatched lock identity', (_v, l) => { l.packages[''].name = 'streamclone-pulse' })
const leafOnly = { braces: buildOnlyFixture.vulnerabilities.braces }
assert.equal(auditHasExactBuildOnlyBracesGhsa(leafOnly, 'braces', portalLock), false, 'partial chain cannot qualify')

assert.doesNotThrow(() => assertBuildOnlyBracesRuntimeBoundary({
  'index.js': { type: 'chunk', modules: { '/repo/src/main.tsx': {} } },
  'style.css': { type: 'asset', source: '/* compiled utilities */' },
}))
for (const name of Object.keys(buildOnlyFixture.vulnerabilities)) {
  // Even a lazy, nested, Windows-path module must refuse publication.
  assert.throws(() => assertBuildOnlyBracesRuntimeBoundary({
    'index.js': { type: 'chunk', modules: { '/repo/src/main.tsx': {} } },
    'lazy.js': { type: 'chunk', modules: { [`C:\\repo\\node_modules\\other\\node_modules\\${name}\\index.js`]: {} } },
  }), /Build-only audit dependency in browser output/, name)
}

console.log('ci-portal-npm-audit-disposition.selftest: OK')
