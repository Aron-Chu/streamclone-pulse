#!/usr/bin/env node

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { getBuildProvenance, readBuildProvenance } from './build-provenance.mjs'

function option(name, fallback) {
  const index = process.argv.indexOf(name)
  return index === -1 ? fallback : process.argv[index + 1]
}

// `repoRoot` may be a parent checkout when this script is invoked from a
// nested app (streampulse-web), while `distRoot` remains relative to cwd.
const repoRoot = resolve(process.cwd(), option('--repo-root', option('--root', '.')))
const distRoot = resolve(process.cwd(), option('--dist', 'dist'))
const repository = option('--repository', 'streamclone-pulse')
const scopeValue = option('--scope', '')
const scope = scopeValue ? scopeValue.split(',').filter(Boolean) : []
const metadata = readBuildProvenance(distRoot)

if (!existsSync(distRoot) || !metadata) {
  console.error(`[check-dist] missing ${resolve(distRoot, 'build-meta.json')}; run the build first`)
  process.exit(1)
}

const expected = getBuildProvenance({ repoRoot, repository, mode: metadata.mode, scope: metadata.inputScope ?? scope })
const fields = ['repository', 'commit', 'dirty', 'dirtyTreeHash', 'sourceFingerprint', 'packageCohortFingerprint', 'mode', 'buildId']
const mismatches = fields.filter((field) => metadata[field] !== expected[field])

if (mismatches.length) {
  console.error(`[check-dist] stale build metadata (${mismatches.join(', ')})`)
  console.error(`  artifact: ${metadata.buildId ?? 'unknown'} / ${metadata.sourceFingerprint ?? 'unknown'}`)
  console.error(`  current:  ${expected.buildId} / ${expected.sourceFingerprint}`)
  process.exit(1)
}

console.log(`[check-dist] fresh ${metadata.buildId} (${metadata.sourceFingerprint.slice(0, 12)})`)
