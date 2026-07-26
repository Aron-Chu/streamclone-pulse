/**
 * Portal CI npm audit disposition gate (RPR-6 / public security closeout).
 *
 * Allowed high/critical advisories must be explicitly listed here with a
 * written disposition in docs/evidence/npm-audit-rpr6-2026-07.md.
 * Any new high/critical finding fails CI.
 *
 * Hard rule: a dispositioned package MUST be backed by the exact GHSA id
 * either in its own audit `via` payload or (for direct dependents like
 * react-router-dom) in the dispositioned parent package's `via` within the
 * same audit document.
 *
 * Usage: node scripts/ci-portal-npm-audit-disposition.mjs <audit.json>
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** @type {ReadonlyArray<{ name: string, ghsa: string, reason: string, parent?: string }>} */
export const DISPOSITIONED_HIGHS = Object.freeze([
  {
    name: 'react-router',
    ghsa: 'GHSA-qwww-vcr4-c8h2',
    reason:
      'Advisory requires React Router RSC Mode; streampulse-web is a classic Vite SPA client router with no RSC. Tracked upgrade to react-router@>=8.3.0 is a follow-up (major). See docs/evidence/npm-audit-rpr6-2026-07.md.',
  },
  {
    name: 'react-router-dom',
    ghsa: 'GHSA-qwww-vcr4-c8h2',
    parent: 'react-router',
    reason:
      'Same advisory as react-router (npm often lists react-router-dom via as the parent package name only). No RSC surface in portal.',
  },
])

/**
 * @param {unknown} via
 * @returns {string[]}
 */
function extractGhsas(via) {
  const text = JSON.stringify(via ?? '')
  const matches = text.match(/GHSA-[a-z0-9-]+/gi) ?? []
  return matches.map((g) => g.toUpperCase())
}

/**
 * @param {Record<string, { via?: unknown }>} vulns
 * @param {string} name
 * @param {string} ghsa
 * @param {string | undefined} parent
 */
function auditHasExactGhsa(vulns, name, ghsa, parent) {
  const target = ghsa.toUpperCase()
  const self = extractGhsas(vulns[name]?.via)
  if (self.includes(target)) return true
  if (parent) {
    const parentGhsas = extractGhsas(vulns[parent]?.via)
    if (parentGhsas.includes(target)) return true
    // npm may only list the parent package name as a string via entry.
    const viaText = JSON.stringify(vulns[name]?.via ?? '')
    if (viaText.includes(`"${parent}"`) || viaText.includes(`"${parent}@`)) {
      return parentGhsas.includes(target)
    }
  }
  return false
}

function main() {
  const path = process.argv[2]
  if (!path) {
    console.error('usage: ci-portal-npm-audit-disposition.mjs <audit.json>')
    process.exit(2)
  }
  const audit = JSON.parse(readFileSync(path, 'utf8'))
  const vulns = audit.vulnerabilities ?? {}
  /** @type {Array<{ name: string, severity: string, via: unknown }>} */
  const highs = []
  for (const [name, info] of Object.entries(vulns)) {
    const severity = String(info?.severity ?? '')
    if (severity === 'high' || severity === 'critical') {
      highs.push({ name, severity, via: info?.via })
    }
  }

  const allowed = new Map(DISPOSITIONED_HIGHS.map((d) => [d.name, d]))
  /** @type {string[]} */
  const unexpected = []
  for (const hit of highs) {
    const disp = allowed.get(hit.name)
    if (!disp) {
      unexpected.push(`${hit.severity} ${hit.name} (no disposition)`)
      continue
    }
    if (!auditHasExactGhsa(vulns, hit.name, disp.ghsa, disp.parent)) {
      unexpected.push(
        `${hit.severity} ${hit.name} (disposition requires exact ${disp.ghsa} in audit via; not found)`,
      )
      continue
    }
    console.log(`dispositioned ${hit.severity} ${hit.name}: ${disp.ghsa}`)
    console.log(`  ${disp.reason}`)
  }

  if (unexpected.length) {
    console.error('ci-portal-npm-audit-disposition: unexpected high/critical findings:')
    for (const u of unexpected) console.error(`  ${u}`)
    console.error('Update docs/evidence/npm-audit-rpr6-2026-07.md and DISPOSITIONED_HIGHS, or fix.')
    process.exit(1)
  }

  if (highs.length === 0) {
    console.log('ci-portal-npm-audit-disposition: no high/critical findings')
  } else {
    console.log(
      `ci-portal-npm-audit-disposition: OK (${highs.length} dispositioned high/critical; none unexpected)`,
    )
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
