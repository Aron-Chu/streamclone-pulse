#!/usr/bin/env node
/**
 * Fail CI/deploy when known analytics overlap regressions reappear.
 * Run: npm run check:analytics-overlap (streampulse-web)
 *
 * Phase on master tip: enforce dead-duplicate deletion only.
 * Deeper console/hub contract checks land with the hub density WIP.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(webRoot, '..')

/** Every .ts/.tsx file under a directory (no node_modules). */
function listSourceFiles(dir) {
  /** @type {string[]} */
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listSourceFiles(path))
    else if (/\.(?:ts|tsx|mts|cts)$/.test(entry.name)) out.push(path)
  }
  return out
}

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
// session chart part (plan §1.2, D1, D7) now has one zoom UI, the hub's: the
// shared ChartNavigator (variant d3) in SpChart's navigator slot under the
// plot, hosted in an unpositioned [data-session-chart-navigator] element. The
// only other view control is the toolbar's one range seg
// ([data-session-range-seg], SessionChartToolbar.tsx). The retired
// PulseMultiSignalChart stays in its package but is never mounted.
const analyticsDir = join(repoRoot, 'packages/analytics-console/src/components/analytics')
const consoleChartFile = join(analyticsDir, 'AnalyticsChart.tsx')
const sessionPartFiles = [
  'AnalyticsChart.tsx',
  'SessionSpChart.tsx',
  'SessionChartToolbar.tsx',
  'SessionChartPins.tsx',
  'SessionChartLayers.tsx',
  'sessionSpChartModel.ts',
  'SessionShowOnChart.tsx',
  'SessionEmotesOnChart.tsx',
].map(name => join(analyticsDir, name)).filter(file => existsSync(file))
const sessionSources = new Map(sessionPartFiles.map(file => [file, readFileSync(file, 'utf8')]))
let rangeSegs = 0
for (const [file, source] of sessionSources) {
  for (const needle of ['data-chart-viewport-controls', 'data-chart-range-row']) {
    if (source.includes(needle)) {
      errors.push(`${file} must not render [${needle}] — the shared ChartNavigator under the plot is the only zoom UI`)
    }
  }
  if (/aria-label=\{?["'`]Zoom (?:in|out)\b|>\s*Zoom (?:in|out)\s*</.test(source)) {
    errors.push(`${file} must not render its own Zoom in / Zoom out button — they live only in ChartNavigator`)
  }
  const segs = (source.match(/\bdata-session-range-seg\b/g) ?? []).length
  rangeSegs += segs
  if (segs > 0 && !file.endsWith('SessionChartToolbar.tsx')) {
    errors.push(`${file} must not render [data-session-range-seg] — the one range seg lives in SessionChartToolbar.tsx`)
  }
}
if (sessionSources.size > 0 && rangeSegs !== 1) {
  errors.push(`the session chart part must render exactly one [data-session-range-seg] (found ${rangeSegs})`)
}
if (existsSync(consoleChartFile)) {
  const source = sessionSources.get(consoleChartFile) ?? readFileSync(consoleChartFile, 'utf8')
  const stackAt = source.search(/<div[^>]*\bdata-session-chart-stack\b/)
  const plotAt = source.indexOf('<SessionSpChart', Math.max(0, stackAt))
  const slotAt = source.indexOf('navigator={', Math.max(0, plotAt))
  const navigatorUseAt = source.indexOf('<SessionNavigator', Math.max(0, slotAt))
  if (stackAt < 0 || plotAt < 0) {
    errors.push(`${consoleChartFile} must render <SessionSpChart> inside [data-session-chart-stack]`)
  } else if (slotAt < 0 || navigatorUseAt < 0) {
    errors.push(`${consoleChartFile} must pass <SessionNavigator> as <SessionSpChart navigator={…}>, so it renders under the plot`)
  }
  const hosts = [...source.matchAll(/<div[^>]*\bdata-session-chart-navigator\b[^>]*>/g)]
  if (hosts.length !== 1) {
    errors.push(`${consoleChartFile} must host the navigator in exactly one [data-session-chart-navigator] element (found ${hosts.length})`)
  }
  for (const match of hosts) {
    if (/className=["{`][^"`}]*\b(?:absolute|fixed|sticky)\b/.test(match[0]) || /style=\{\{[^}]*position/.test(match[0])) {
      errors.push(`${consoleChartFile} must not position [data-session-chart-navigator] — it would cover the plot`)
    }
    const hostAt = match.index ?? 0
    const hostEnd = source.indexOf('</div>', hostAt)
    const navigatorAt = source.indexOf('<ChartNavigator', hostAt)
    if (navigatorAt < 0 || (hostEnd >= 0 && navigatorAt > hostEnd)) {
      errors.push(`${consoleChartFile} must render <ChartNavigator> inside [data-session-chart-navigator]`)
    } else if (!/variant=["']d3["']/.test(source.slice(navigatorAt, source.indexOf('/>', navigatorAt)))) {
      errors.push(`${consoleChartFile} must render the d3 ChartNavigator (variant="d3") under the session chart`)
    }
  }
  if ((source.match(/<ChartNavigator\b/g) ?? []).length !== 1) {
    errors.push(`${consoleChartFile} must render exactly one <ChartNavigator>`)
  }
}

// D7: PulseMultiSignalChart stays in its package, unmounted.
const sourceRoots = [join(repoRoot, 'packages/analytics-console/src'), join(webRoot, 'src')]
const mountsRetiredChart = /import\s*\{[^}]*\bPulseMultiSignalChart(?:Inner)?\b[^}]*\}\s*from|from\s*['"][^'"]*\/PulseMultiSignalChart(?:\.tsx?)?['"]|<PulseMultiSignalChart(?:Inner)?\b/
for (const root of sourceRoots) {
  if (!existsSync(root)) continue
  for (const file of listSourceFiles(root)) {
    if (/\.test\.[cm]?[jt]sx?$|[\\/]__tests__[\\/]|[\\/]__fixtures__[\\/]/.test(file)) continue
    if (mountsRetiredChart.test(readFileSync(file, 'utf8'))) {
      errors.push(`${file} must not import or mount PulseMultiSignalChart — the session chart is SpChart (D7)`)
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
