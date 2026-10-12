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
    why: 'viewport controls belong in the shared ChartNavigator under the plot, '
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
// package), and later as a second, stream-only zoom row above the plot. The
// stream chart now has exactly one zoom UI, the hub's: the shared
// ChartNavigator, rendered after the plot inside the chart stack and never
// floating over it.
const consoleChartFile = join(repoRoot, 'packages/analytics-console/src/components/analytics/AnalyticsChart.tsx')
if (existsSync(consoleChartFile)) {
  const source = readFileSync(consoleChartFile, 'utf8')
  for (const needle of ['data-chart-viewport-controls', 'data-chart-range-row']) {
    if (source.includes(needle)) {
      errors.push(`${consoleChartFile} must not render [${needle}] — the shared ChartNavigator under the plot is the only zoom UI`)
    }
  }
  const stackAt = source.search(/<div[^>]*\bdata-session-chart-stack\b/)
  const plotAt = source.indexOf('<PulseMultiSignalChartInner', Math.max(0, stackAt))
  const navigatorAt = source.indexOf('<ChartNavigator', Math.max(0, stackAt))
  if (stackAt < 0 || plotAt < 0 || navigatorAt < 0) {
    errors.push(`${consoleChartFile} must render <PulseMultiSignalChartInner> and <ChartNavigator> inside [data-session-chart-stack]`)
  } else if (navigatorAt < plotAt) {
    errors.push(`${consoleChartFile} must render <ChartNavigator> after <PulseMultiSignalChartInner>, under the plot`)
  }
  const hosts = [...source.matchAll(/<div[^>]*\bdata-session-chart-navigator\b[^>]*>/g)]
  if (hosts.length === 0) {
    errors.push(`${consoleChartFile} must host the navigator in a [data-session-chart-navigator] element`)
  }
  for (const match of hosts) {
    if (/className=["{`][^"`}]*\b(?:absolute|fixed|sticky)\b/.test(match[0])) {
      errors.push(`${consoleChartFile} must not position [data-session-chart-navigator] absolute/fixed/sticky — it would cover the plot`)
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
