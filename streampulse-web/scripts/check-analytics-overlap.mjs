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

// The console range controls once came back as an `absolute right-2 top-2`
// overlay inside the plot stack (the guard above only covers the chart
// package). Keep them in their own row before the plot and never floating.
const consoleChartFile = join(repoRoot, 'packages/analytics-console/src/components/analytics/AnalyticsChart.tsx')
if (existsSync(consoleChartFile)) {
  const source = readFileSync(consoleChartFile, 'utf8')
  const rowAt = source.search(/<div[^>]*\bdata-chart-range-row\b/)
  const stackAt = source.search(/<div[^>]*\bdata-session-chart-stack\b/)
  if (rowAt < 0) {
    errors.push(`${consoleChartFile} must render the chart range controls in a [data-chart-range-row]`)
  } else if (stackAt >= 0 && rowAt > stackAt) {
    errors.push(`${consoleChartFile} must place [data-chart-range-row] before [data-session-chart-stack], not over the plot`)
  }
  for (const needle of ['data-chart-range-row', 'data-chart-viewport-controls']) {
    for (const match of source.matchAll(new RegExp(`<div[^>]*\\b${needle}\\b[^>]*>`, 'g'))) {
      if (/className=["{`][^"`}]*\b(?:absolute|fixed|sticky)\b/.test(match[0])) {
        errors.push(`${consoleChartFile} must not position [${needle}] absolute/fixed/sticky — it covered the plot`)
      }
    }
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
