#!/usr/bin/env node
/**
 * Fail CI/deploy when known analytics overlap regressions reappear.
 * Run: npm run check:analytics-overlap (streampulse-web)
 *
 * Phase on master tip: enforce dead-duplicate deletion only.
 * Deeper console/hub contract checks land with the hub density WIP.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(webRoot, '..')

const deadFiles = [
  join(webRoot, 'src/ui/components/analytics/GlobalActivityChart.tsx'),
  join(webRoot, 'src/routes/analytics/ChannelDatePage.tsx'),
  join(webRoot, 'src/routes/analytics/ChannelSessionKeyRoute.tsx'),
  join(webRoot, 'src/routes/analytics/StreamsHubPage.tsx'),
  join(webRoot, 'src/routes/analytics/StreamsHubPlaceholder.tsx'),
  // Selected-moment detail has one owner: SelectedMomentCompactCard in the
  // Moments rail. This below-chart card was the second of four renderings of
  // the same selection.
  join(repoRoot, 'packages/analytics-console/src/components/analytics/SelectedMomentPanel.tsx'),
]

/**
 * Single-owner source checks: file must NOT contain the given needle.
 * @type {Array<{ file: string, needle: string, why: string }>}
 */
const forbiddenInSource = [
  {
    file: join(repoRoot, 'packages/pulse-charts/src/PulseMultiSignalChart.tsx'),
    needle: 'data-chart-viewport-controls',
    why: 'viewport controls belong in the console chart toolbar (AnalyticsChart range row), '
      + 'not floating over the plot where they covered the viewer peak',
  },
]

/** @type {string[]} */
const errors = []

for (const dead of deadFiles) {
  if (existsSync(dead)) {
    errors.push(`dead duplicate file must be deleted: ${dead}`)
  }
}

for (const { file, needle, why } of forbiddenInSource) {
  if (!existsSync(file)) continue
  if (readFileSync(file, 'utf8').includes(needle)) {
    errors.push(`${file} must not render [${needle}] — ${why}`)
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
