/**
 * npm audit disposition gate (RPR-6 / public security closeout).
 *
 * Allowed high/critical advisories must be explicitly listed here with a
 * written disposition in docs/evidence/npm-audit-rpr6-2026-07.md.
 * Any new high/critical finding fails CI. The report and npm command status
 * are both validated; an error cannot be converted into an empty audit.
 *
 * Hard rule: a dispositioned package MUST be backed by the exact GHSA id
 * either in its own audit `via` payload or (for direct dependents like
 * react-router-dom) in the dispositioned parent package's `via` within the
 * same audit document.
 *
 * Usage: node scripts/ci-portal-npm-audit-disposition.mjs [--npm-exit-code <0|1>] <audit.json|->
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const AUDIT_REPORT_VERSION = 2
const SEVERITIES = Object.freeze(['info', 'low', 'moderate', 'high', 'critical'])
const ROUTER_ADVISORY = Object.freeze({
  source: 1124282,
  name: 'react-router',
  dependency: 'react-router',
  title: 'React Router: RSC Mode CSRF Bypass Allows Action Execution Before 400 Response',
  url: 'https://github.com/advisories/GHSA-qwww-vcr4-c8h2',
  severity: 'high',
  range: '>=7.12.0 <8.3.0',
})

/** @type {ReadonlyArray<{ name: string, ghsa: string, reason: string, parent?: string, advisory: Readonly<Record<string, unknown>> }>} */
export const DISPOSITIONED_HIGHS = Object.freeze([
  {
    name: 'react-router',
    ghsa: 'GHSA-qwww-vcr4-c8h2',
    advisory: ROUTER_ADVISORY,
    reason:
      'Advisory requires React Router RSC Mode; streampulse-web is a classic Vite SPA client router with no RSC. Tracked upgrade to react-router@>=8.3.0 is a follow-up (major). See docs/evidence/npm-audit-rpr6-2026-07.md.',
  },
  {
    name: 'react-router-dom',
    ghsa: 'GHSA-qwww-vcr4-c8h2',
    parent: 'react-router',
    advisory: ROUTER_ADVISORY,
    reason:
      'Same advisory as react-router (npm often lists react-router-dom via as the parent package name only). No RSC surface in portal.',
  },
])

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Validate the npm v2 report shape and its package-count metadata before any
 * disposition is considered.
 *
 * @param {unknown} audit
 * @returns {string[]}
 */
export function validateAuditSchema(audit) {
  /** @type {string[]} */
  const errors = []
  if (!isRecord(audit)) return ['report must be a JSON object']
  if (audit.auditReportVersion !== AUDIT_REPORT_VERSION) {
    errors.push(`auditReportVersion must be ${AUDIT_REPORT_VERSION}`)
  }
  if (!isRecord(audit.vulnerabilities)) {
    errors.push('vulnerabilities object is required')
    return errors
  }
  if (!isRecord(audit.metadata) || !isRecord(audit.metadata.vulnerabilities)) {
    errors.push('metadata.vulnerabilities object is required')
    return errors
  }

  const counts = /** @type {Record<string, number>} */ ({})
  for (const severity of SEVERITIES) {
    const value = audit.metadata.vulnerabilities[severity]
    if (!Number.isInteger(value) || value < 0) {
      errors.push(`metadata.vulnerabilities.${severity} must be a non-negative integer`)
    } else {
      counts[severity] = value
    }
  }
  const total = audit.metadata.vulnerabilities.total
  if (!Number.isInteger(total) || total < 0) {
    errors.push('metadata.vulnerabilities.total must be a non-negative integer')
  }

  /** @type {Record<string, number>} */
  const actual = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0]))
  for (const [name, info] of Object.entries(audit.vulnerabilities)) {
    if (!isRecord(info)) {
      errors.push(`vulnerabilities.${name} must be an object`)
      continue
    }
    if (info.name !== name) errors.push(`vulnerabilities.${name}.name does not match its key`)
    if (!SEVERITIES.includes(info.severity)) {
      errors.push(`vulnerabilities.${name}.severity is invalid`)
    } else {
      actual[info.severity] += 1
    }
    if (!Array.isArray(info.via) || info.via.length === 0) {
      errors.push(`vulnerabilities.${name}.via must be a non-empty array`)
    }
  }

  for (const severity of SEVERITIES) {
    if (counts[severity] !== undefined && counts[severity] !== actual[severity]) {
      errors.push(
        `metadata.vulnerabilities.${severity}=${counts[severity]} does not match ${actual[severity]} vulnerability entries`,
      )
    }
  }
  if (Number.isInteger(total) && total !== Object.keys(audit.vulnerabilities).length) {
    errors.push(
      `metadata.vulnerabilities.total=${total} does not match ${Object.keys(audit.vulnerabilities).length} vulnerability entries`,
    )
  }
  return errors
}

/**
 * @param {unknown} via
 * @returns {string[]}
 */
function extractGhsas(via) {
  const text = JSON.stringify(via ?? '')
  const matches = text.match(/GHSA-[a-z0-9-]+/gi) ?? []
  return matches.map((g) => g.toUpperCase())
}

function viaEntries(via) {
  return Array.isArray(via) ? via : [via]
}

/**
 * @param {unknown} entry
 * @param {Readonly<Record<string, unknown>>} advisory
 * @param {string} severity
 */
function advisoryMetadataMatches(entry, advisory, severity) {
  if (!isRecord(entry)) return false
  return (
    entry.source === advisory.source &&
    entry.name === advisory.name &&
    entry.dependency === advisory.dependency &&
    entry.title === advisory.title &&
    entry.url === advisory.url &&
    entry.severity === severity &&
    entry.range === advisory.range &&
    extractGhsas(entry.url).includes(String(advisory.ghsa ?? 'GHSA-qwww-vcr4-c8h2').toUpperCase())
  )
}

/** @param {unknown} via @param {string} parent */
function hasParentReference(via, parent) {
  return viaEntries(via).some((entry) => entry === parent)
}

/**
 * @param {Record<string, { via?: unknown }>} vulns
 * @param {string} name
 * @param {string} ghsa
 * @param {string | undefined} parent
 * @param {string} severity
 * @param {Readonly<Record<string, unknown>>} advisory
 */
function auditHasExactGhsa(vulns, name, ghsa, parent, severity, advisory) {
  const selfEntries = viaEntries(vulns[name]?.via)
  if (selfEntries.some((entry) => advisoryMetadataMatches(entry, { ...advisory, ghsa }, severity))) return true
  if (parent && hasParentReference(vulns[name]?.via, parent)) {
    const parentEntries = viaEntries(vulns[parent]?.via)
    return parentEntries.some((entry) => advisoryMetadataMatches(entry, { ...advisory, ghsa }, severity))
  }
  return false
}

function parseArgs(argv) {
  let auditExitCode
  let path
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--npm-exit-code') {
      const raw = argv[index + 1]
      if (!raw || !/^\d+$/.test(raw)) throw new Error('--npm-exit-code requires a numeric value')
      auditExitCode = Number(raw)
      index += 1
      continue
    }
    if (path) throw new Error(`unexpected argument: ${arg}`)
    path = arg
  }
  return { path, auditExitCode }
}

function main() {
  const { path, auditExitCode } = parseArgs(process.argv.slice(2))
  if (!path) {
    console.error('usage: ci-portal-npm-audit-disposition.mjs [--npm-exit-code <0|1>] <audit.json|->')
    process.exitCode = 2
    return
  }
  if (auditExitCode !== undefined && auditExitCode !== 0 && auditExitCode !== 1) {
    throw new Error(`npm audit command failed with exit code ${auditExitCode}`)
  }

  let audit
  try {
    audit = JSON.parse(readFileSync(path === '-' ? 0 : path, 'utf8'))
  } catch (error) {
    throw new Error(`could not parse npm audit JSON: ${error.message}`)
  }
  const schemaErrors = validateAuditSchema(audit)
  if (schemaErrors.length) {
    throw new Error(`invalid npm audit report:\n  ${schemaErrors.join('\n  ')}`)
  }
  const vulns = audit.vulnerabilities
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
    if (!auditHasExactGhsa(vulns, hit.name, disp.ghsa, disp.parent, hit.severity, disp.advisory)) {
      unexpected.push(
        `${hit.severity} ${hit.name} (disposition requires exact ${disp.ghsa} with matching advisory metadata)`,
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
  try {
    main()
  } catch (error) {
    console.error(`ci-portal-npm-audit-disposition: ${error.message}`)
    process.exitCode = 1
  }
}
