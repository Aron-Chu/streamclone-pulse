/**
 * Lightweight self-test for exact-GHSA disposition gate (no vitest install required).
 * Uses in-repo fixtures (no os.tmpdir writes — avoids CodeQL js/insecure-temporary-file).
 * Run: node scripts/ci-portal-npm-audit-disposition.selftest.mjs
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join as pathJoin } from 'node:path'

const root = pathJoin(dirname(fileURLToPath(import.meta.url)), '..')
const script = pathJoin(root, 'scripts', 'ci-portal-npm-audit-disposition.mjs')
const fixtures = pathJoin(root, 'scripts', 'fixtures')

function run(fixtureName, extraArgs = []) {
  return spawnSync(process.execPath, [script, ...extraArgs, pathJoin(fixtures, fixtureName)], {
    encoding: 'utf8',
    cwd: root,
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

console.log('ci-portal-npm-audit-disposition.selftest: OK')
