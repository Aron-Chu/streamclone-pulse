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
const BELOW_HIGH = Object.freeze(['info', 'low', 'moderate'])
const ROUTER_ADVISORY = Object.freeze({
  source: 1124282,
  name: 'react-router',
  dependency: 'react-router',
  title: 'React Router: RSC Mode CSRF Bypass Allows Action Execution Before 400 Response',
  url: 'https://github.com/advisories/GHSA-qwww-vcr4-c8h2',
  severity: 'high',
  range: '>=7.12.0 <8.3.0',
})

export const PICOMATCH_GHSA = 'GHSA-fc5q-39xc-vjpf'
const PICOMATCH_ADVISORY = Object.freeze({
  source: 1247710,
  name: 'picomatch',
  dependency: 'picomatch',
  title: 'picomatch vulnerable to ReDoS through single-branch repeated extglobs',
  url: `https://github.com/advisories/${PICOMATCH_GHSA}`,
  severity: 'high',
  range: '<=4.0.7',
})

/**
 * The picomatch exception is temporary: no patched release existed when it was
 * reviewed. From this instant it stops matching and CI fails until the graph is
 * patched, reviewed again, or removed.
 */
export const PICOMATCH_DISPOSITION_EXPIRES = '2026-12-02T00:00:00.000Z'

/**
 * Reviewed development-only graphs, one per lock identity. Each package lists
 * its exact installed nodes (lock path -> locked version) and the audit `via`
 * parents that carry this one advisory. This is not a package-wide waiver: a
 * second high advisory, changed version, production node, missing or extra
 * node, or unreviewed parent needs a new disposition review.
 */
const PICOMATCH_BUILD_GRAPHS = Object.freeze({
  // Root lock: the extension's Vite build and Vitest runner.
  'streamclone-pulse': Object.freeze({
    picomatch: { nodes: { 'node_modules/picomatch': '4.0.5' }, parents: [] },
    fdir: { nodes: { 'node_modules/fdir': '6.5.0' }, parents: ['picomatch'] },
    tinyglobby: { nodes: { 'node_modules/tinyglobby': '0.2.17' }, parents: ['fdir', 'picomatch'] },
    vite: {
      nodes: {
        'node_modules/vite': '8.1.6',
        'node_modules/vite-node/node_modules/vite': '7.3.7',
        'node_modules/vitest/node_modules/vite': '7.3.7',
      },
      parents: ['fdir', 'picomatch', 'tinyglobby'],
    },
    '@vitejs/plugin-react': { nodes: { 'node_modules/@vitejs/plugin-react': '6.0.2' }, parents: ['vite'] },
    vitest: { nodes: { 'node_modules/vitest': '3.2.7' }, parents: ['picomatch', 'tinyglobby'] },
  }),
  // Portal lock: Vite, Vitest and the Tailwind 3 CSS build.
  'streampulse-web': Object.freeze({
    picomatch: {
      nodes: {
        'node_modules/picomatch': '2.3.2',
        'node_modules/tinyglobby/node_modules/picomatch': '4.0.5',
        'node_modules/vite-node/node_modules/picomatch': '4.0.5',
        'node_modules/vite/node_modules/picomatch': '4.0.5',
        'node_modules/vitest/node_modules/picomatch': '4.0.5',
      },
      parents: [],
    },
    anymatch: { nodes: { 'node_modules/anymatch': '3.1.3' }, parents: ['picomatch'] },
    readdirp: { nodes: { 'node_modules/readdirp': '3.6.0' }, parents: ['picomatch'] },
    micromatch: { nodes: { 'node_modules/micromatch': '4.0.8' }, parents: ['picomatch'] },
    chokidar: { nodes: { 'node_modules/chokidar': '3.6.0' }, parents: ['anymatch', 'readdirp'] },
    'fast-glob': { nodes: { 'node_modules/fast-glob': '3.3.3' }, parents: ['micromatch'] },
    fdir: {
      nodes: {
        'node_modules/tinyglobby/node_modules/fdir': '6.5.0',
        'node_modules/vite-node/node_modules/fdir': '6.5.0',
        'node_modules/vitest/node_modules/fdir': '6.5.0',
      },
      parents: ['picomatch'],
    },
    tinyglobby: { nodes: { 'node_modules/tinyglobby': '0.2.17' }, parents: ['fdir', 'picomatch'] },
    sucrase: { nodes: { 'node_modules/sucrase': '3.35.1' }, parents: ['tinyglobby'] },
    tailwindcss: { nodes: { 'node_modules/tailwindcss': '3.4.19' }, parents: ['chokidar', 'fast-glob', 'micromatch'] },
    vite: {
      nodes: {
        'node_modules/vite': '8.1.6',
        'node_modules/vite-node/node_modules/vite': '7.3.7',
        'node_modules/vitest/node_modules/vite': '7.3.7',
      },
      parents: ['fdir', 'picomatch', 'tinyglobby'],
    },
    '@vitejs/plugin-react': { nodes: { 'node_modules/@vitejs/plugin-react': '6.0.2' }, parents: ['vite'] },
    vitest: { nodes: { 'node_modules/vitest': '3.2.7' }, parents: ['picomatch', 'tinyglobby'] },
  }),
})

/** Every package name any reviewed build-only graph may exempt. */
export const BUILD_ONLY_PACKAGES = Object.freeze(
  [...new Set(Object.values(PICOMATCH_BUILD_GRAPHS).flatMap((graph) => Object.keys(graph)))].sort(),
)

const PICOMATCH_REASON =
  'Exact locked development-only Vite/Vitest/Tailwind graph; the advisory needs an attacker-supplied glob pattern and every pattern here comes from the reviewed checkout. No affected module ships in browser output. No patched picomatch release exists; this exception expires ' +
  `${PICOMATCH_DISPOSITION_EXPIRES.slice(0, 10)}. See docs/evidence/npm-audit-rpr6-2026-07.md.`

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

/** The lock's own name, only when its root package agrees with it. */
function lockIdentity(lock) {
  if (!isRecord(lock) || !isRecord(lock.packages) || !isRecord(lock.packages[''])) return undefined
  return typeof lock.name === 'string' && lock.packages[''].name === lock.name ? lock.name : undefined
}

/** True when the picomatch exception no longer applies at `now`. */
export function picomatchDispositionExpired(now) {
  return !(now instanceof Date) || Number.isNaN(now.getTime()) || now.getTime() >= Date.parse(PICOMATCH_DISPOSITION_EXPIRES)
}

/** A `via` entry that cannot by itself make a package high (a lower advisory or a lower package). */
function isBelowHighVia(vulns, entry) {
  if (typeof entry === 'string') return isRecord(vulns[entry]) && BELOW_HIGH.includes(vulns[entry].severity)
  return isRecord(entry) && BELOW_HIGH.includes(entry.severity)
}

function matchesBuildOnlyPackage(vulns, name, expected, graph, lock) {
  const info = vulns[name]
  if (!isRecord(info) || info.severity !== 'high' || !Array.isArray(info.nodes) || !Array.isArray(info.via)) return false
  if (info.nodes.length !== Object.keys(expected.nodes).length || new Set(info.nodes).size !== info.nodes.length) return false
  for (const node of info.nodes) {
    if (typeof node !== 'string' || !Object.hasOwn(expected.nodes, node)) return false
    const installed = lock.packages[node]
    if (!isRecord(installed) || installed.dev !== true || installed.version !== expected.nodes[node]) return false
  }
  if (expected.parents.length === 0) {
    // The advisory package itself carries exactly this one advisory.
    return info.via.length === 1 && advisoryMetadataMatches(info.via[0], { ...PICOMATCH_ADVISORY, ghsa: PICOMATCH_GHSA }, 'high')
  }
  // Lower-severity advisories (vitest's moderate ones) cannot make a package
  // high. Every high-carrying edge must be one reviewed parent in this graph.
  const carriers = info.via.filter((entry) => !isBelowHighVia(vulns, entry))
  return (
    carriers.length === expected.parents.length &&
    new Set(carriers).size === carriers.length &&
    carriers.every((entry) => typeof entry === 'string' && expected.parents.includes(entry) && Object.hasOwn(graph, entry))
  )
}

/**
 * Whole-graph check for the build-only picomatch exception. Every reviewed
 * package of this lock must be present and exact, even when only the leaf is
 * being dispositioned; a partial, changed, production, or expired graph and a
 * lock without a reviewed graph never qualify.
 */
export function auditHasExactBuildOnlyPicomatchGraph(vulns, name, lock, now) {
  if (picomatchDispositionExpired(now) || !isRecord(vulns)) return false
  const identity = lockIdentity(lock)
  const graph = identity && Object.hasOwn(PICOMATCH_BUILD_GRAPHS, identity) ? PICOMATCH_BUILD_GRAPHS[identity] : undefined
  if (!graph || !Object.hasOwn(graph, name)) return false
  return Object.entries(graph).every(([pkg, expected]) => matchesBuildOnlyPackage(vulns, pkg, expected, graph, lock))
}

/** Fail the production build if any reviewed build tool reaches a browser chunk. */
export function assertBuildOnlyAuditRuntimeBoundary(bundle) {
  const forbidden = new Set()
  for (const chunk of Object.values(bundle)) {
    if (chunk.type !== 'chunk') continue
    for (const id of Object.keys(chunk.modules)) {
      const normalized = id.replaceAll('\\', '/')
      if (BUILD_ONLY_PACKAGES.some((name) => normalized.includes(`/node_modules/${name}/`))) {
        forbidden.add(id)
      }
    }
  }
  if (forbidden.size) throw new Error(`Build-only audit dependency in browser output:\n${[...forbidden].join('\n')}`)
}

/**
 * Decide every high/critical finding. `readLock` is called only when a
 * finding could be covered by a reviewed build-only graph.
 *
 * @param {Record<string, any>} vulns
 * @param {{ readLock: () => unknown, now: Date }} context
 */
export function evaluateHighs(vulns, { readLock, now }) {
  /** @type {Array<{ name: string, severity: string }>} */
  const highs = []
  for (const [name, info] of Object.entries(vulns)) {
    const severity = String(info?.severity ?? '')
    if (severity === 'high' || severity === 'critical') highs.push({ name, severity })
  }

  const allowed = new Map(DISPOSITIONED_HIGHS.map((d) => [d.name, d]))
  const lock = highs.some((hit) => BUILD_ONLY_PACKAGES.includes(hit.name)) ? readLock() : undefined
  /** @type {Array<{ name: string, severity: string, ghsa: string, reason: string }>} */
  const dispositioned = []
  /** @type {string[]} */
  const unexpected = []
  for (const hit of highs) {
    if (BUILD_ONLY_PACKAGES.includes(hit.name)) {
      if (auditHasExactBuildOnlyPicomatchGraph(vulns, hit.name, lock, now)) {
        dispositioned.push({ ...hit, ghsa: PICOMATCH_GHSA, reason: PICOMATCH_REASON })
      } else if (picomatchDispositionExpired(now)) {
        unexpected.push(`${hit.severity} ${hit.name} (build-only ${PICOMATCH_GHSA} disposition expired ${PICOMATCH_DISPOSITION_EXPIRES})`)
      } else {
        unexpected.push(`${hit.severity} ${hit.name} (disposition requires the exact reviewed build-only ${PICOMATCH_GHSA} graph)`)
      }
      continue
    }
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
    dispositioned.push({ ...hit, ghsa: disp.ghsa, reason: disp.reason })
  }
  return { highs, dispositioned, unexpected }
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

  // npm audit is invoked from the package directory in both existing CI jobs.
  const { highs, dispositioned, unexpected } = evaluateHighs(audit.vulnerabilities, {
    readLock: () => JSON.parse(readFileSync('package-lock.json', 'utf8')),
    now: new Date(),
  })
  const explained = new Set()
  for (const hit of dispositioned) {
    console.log(`dispositioned ${hit.severity} ${hit.name}: ${hit.ghsa}`)
    if (!explained.has(hit.reason)) console.log(`  ${hit.reason}`)
    explained.add(hit.reason)
  }

  if (unexpected.length) {
    console.error('ci-portal-npm-audit-disposition: unexpected high/critical findings:')
    for (const u of unexpected) console.error(`  ${u}`)
    console.error('Update docs/evidence/npm-audit-rpr6-2026-07.md and the reviewed dispositions, or fix.')
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
