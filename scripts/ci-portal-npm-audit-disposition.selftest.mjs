/**
 * Lightweight self-test for exact-GHSA disposition gate (no vitest install required).
 * Run: node scripts/ci-portal-npm-audit-disposition.selftest.mjs
 */
import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join as pathJoin } from 'node:path'

const root = pathJoin(dirname(fileURLToPath(import.meta.url)), '..')
const script = pathJoin(root, 'scripts', 'ci-portal-npm-audit-disposition.mjs')

function run(audit) {
  const path = pathJoin(tmpdir(), `sp-audit-selftest-${process.pid}-${Math.random()}.json`)
  writeFileSync(path, JSON.stringify(audit))
  try {
    return spawnSync(process.execPath, [script, path], { encoding: 'utf8', cwd: root })
  } finally {
    unlinkSync(path)
  }
}

const bad = run({
  vulnerabilities: {
    'react-router': {
      severity: 'high',
      via: [{ title: 'other', url: 'https://example.com' }],
    },
  },
})
if (bad.status === 0 || !String(bad.stderr).includes('GHSA-qwww-vcr4-c8h2')) {
  console.error('expected reject without exact GHSA', bad)
  process.exit(1)
}

const good = run({
  vulnerabilities: {
    'react-router': {
      severity: 'high',
      via: [{ url: 'https://github.com/advisories/GHSA-qwww-vcr4-c8h2' }],
    },
    'react-router-dom': {
      severity: 'high',
      via: [{ url: 'https://github.com/advisories/GHSA-qwww-vcr4-c8h2' }],
    },
  },
})
if (good.status !== 0) {
  console.error('expected accept with exact GHSA', good)
  process.exit(1)
}

console.log('ci-portal-npm-audit-disposition.selftest: OK')
