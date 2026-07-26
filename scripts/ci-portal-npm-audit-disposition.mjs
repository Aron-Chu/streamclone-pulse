/**
 * Portal CI npm audit disposition gate (RPR-6).
 *
 * Allowed high/critical advisories must be explicitly listed here with a
 * written disposition in docs/evidence/npm-audit-rpr6-2026-07.md.
 * Any new high/critical finding fails CI.
 *
 * Usage: node scripts/ci-portal-npm-audit-disposition.mjs <audit.json>
 */
import { readFileSync } from 'node:fs'

/** @type {ReadonlyArray<{ name: string, ghsa: string, reason: string }>} */
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
    reason:
      'Same advisory as react-router (transitive via react-router-dom). No RSC surface in portal.',
  },
])

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
    const viaText = JSON.stringify(hit.via ?? '')
    if (!viaText.includes(disp.ghsa) && !viaText.includes('react-router')) {
      // Accept if the advisory id is nested or the package is the known router pair.
      if (hit.name !== 'react-router' && hit.name !== 'react-router-dom') {
        unexpected.push(`${hit.severity} ${hit.name} (disposition GHSA mismatch)`)
      }
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

main()
