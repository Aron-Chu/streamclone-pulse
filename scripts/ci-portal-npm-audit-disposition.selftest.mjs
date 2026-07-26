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

function run(fixtureName) {
  return spawnSync(process.execPath, [script, pathJoin(fixtures, fixtureName)], {
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

console.log('ci-portal-npm-audit-disposition.selftest: OK')
