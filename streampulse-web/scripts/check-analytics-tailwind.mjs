#!/usr/bin/env node
/**
 * Guardrail: embedded @streampulse/* packages use Tailwind utilities, but the portal
 * only generates CSS for classes found in tailwind.config.js `content` (and explicit
 * fallbacks in analytics-tailwind.css). SVG <text> uses fill — missing utilities render black.
 *
 * Fails CI when:
 * - A workspace embed package is missing from Tailwind content
 * - pulse-charts introduces new fill-* axis classes without CSS fallbacks
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = join(here, '..')
const pulseRoot = join(webRoot, '..')

/** Packages whose TSX may emit Tailwind classes consumed under .sc-analytics-console */
const EMBED_PACKAGE_SRC = [
  join(pulseRoot, 'packages/analytics-console/src'),
  join(pulseRoot, 'packages/pulse-charts/src'),
]

const tailwindConfigPath = join(webRoot, 'tailwind.config.js')
const analyticsTailwindCssPath = join(webRoot, 'src/ui/analytics-tailwind.css')

function walkFiles(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue
      walkFiles(path, acc)
    } else if (/\.(tsx|ts|jsx|js)$/.test(name)) {
      acc.push(path)
    }
  }
  return acc
}

function extractFillClasses(source) {
  const found = new Set()
  const re = /\bfill-([a-z]+(?:-\d+)?(?:\/\d+)?)\b/g
  let match
  while ((match = re.exec(source)) !== null) {
    found.add(`fill-${match[1]}`)
  }
  return found
}

function cssEscapesClass(className) {
  return className.replace(/\//g, '\\/')
}

function readText(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch (err) {
    console.error(`check:analytics-tailwind: cannot read ${path}:`, err.message)
    process.exit(1)
  }
}

const tailwindConfig = readText(tailwindConfigPath)
const analyticsCss = readText(analyticsTailwindCssPath)

let failed = false

for (const srcRoot of EMBED_PACKAGE_SRC) {
  const rel = relative(pulseRoot, srcRoot).replace(/\\/g, '/')
  const needle = rel // e.g. packages/analytics-console/src
  if (!tailwindConfig.includes(needle) && !tailwindConfig.includes(`../${needle}`)) {
    console.error(
      `check:analytics-tailwind: tailwind.config.js content must include embed package path: ${needle}`,
    )
    failed = true
  }
}

const fillClasses = new Set()
for (const srcRoot of EMBED_PACKAGE_SRC) {
  for (const file of walkFiles(srcRoot)) {
    const source = readText(file)
    for (const cls of extractFillClasses(source)) {
      fillClasses.add(cls)
    }
  }
}

for (const cls of [...fillClasses].sort()) {
  const escaped = cssEscapesClass(cls)
  const hasFallback =
    analyticsCss.includes(`text.${escaped}`) ||
    analyticsCss.includes(`text.${cls}`) ||
    tailwindConfig.includes(`'${cls}'`) ||
    tailwindConfig.includes(`"${cls}"`)
  if (!hasFallback) {
    console.error(
      `check:analytics-tailwind: SVG fill utility "${cls}" has no fallback in analytics-tailwind.css ` +
        `(add .sc-analytics-console .sc-chart-root text.${escaped} rule) or safelist it`,
    )
    failed = true
  }
}

if (failed) {
  process.exit(1)
}

console.log(
  `check:analytics-tailwind OK (${EMBED_PACKAGE_SRC.length} embed packages, ${fillClasses.size} fill-* classes covered)`,
)
