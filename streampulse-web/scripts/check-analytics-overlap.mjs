#!/usr/bin/env node
/**
 * Fail CI/deploy when known analytics overlap regressions reappear.
 * Run: npm run check:analytics-overlap (streampulse-web)
 *
 * Phase on master tip: enforce dead-duplicate deletion only.
 * Deeper console/hub contract checks land with the hub density WIP.
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const deadFiles = [
  join(webRoot, 'src/ui/components/analytics/GlobalActivityChart.tsx'),
  join(webRoot, 'src/routes/analytics/ChannelDatePage.tsx'),
  join(webRoot, 'src/routes/analytics/ChannelSessionKeyRoute.tsx'),
]

/** @type {string[]} */
const errors = []

for (const dead of deadFiles) {
  if (existsSync(dead)) {
    errors.push(`dead duplicate file must be deleted: ${dead}`)
  }
}

if (errors.length > 0) {
  console.error('check:analytics-overlap FAILED\n')
  for (const err of errors) {
    console.error(`  - ${err}`)
  }
  console.error('\nFix: delete or gate the old path — do not stack a third implementation.')
  process.exit(1)
}

console.log('check:analytics-overlap OK')
