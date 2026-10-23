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
const BRACES_ADVISORY = Object.freeze({
  source: 1240992,
  name: 'braces',
  dependency: 'braces',
  title: 'braces vulnerable to stack-exhaustion denial of service through deeply nested patterns',
  url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm',
  severity: 'high',
  range: '<=3.0.3',
})

// This is the reviewed build-only chain, not a package-wide advisory waiver.
const BRACES_BUILD_CHAIN = Object.freeze({
  braces: { version: '3.0.3', parents: [] },
  chokidar: { version: '3.6.0', parents: ['braces'] },
  'fast-glob': { version: '3.3.3', parents: ['micromatch'] },
  micromatch: { version: '4.0.8', parents: ['braces'] },
  tailwindcss: { version: '3.4.19', parents: ['chokidar', 'fast-glob', 'micromatch'] },
})

// Release branch release/ext-0.2.2-candidate-20261022 only. It keeps the tested
// vite 8.0.16 so the shipped 0.2.2 bytes stay the same; master has the real fix
// (#145). Remove this when 0.2.2 ships or the branch is retired.
const VITE_DEV_SERVER_RANGES = Object.freeze(['>=7.0.0 <=7.3.6', '>=8.0.0 <=8.1.5'])
const VITE_DEV_SERVER_ADVISORIES = Object.freeze(
  [
    // [GHSA, severity, title, npm source for the 7.x range, npm source for the 8.x range]
    ['GHSA-587h-7wmj-h5pm', 'high', 'launch-editor: `fs.existsSync()` existence check can be bypassed on Windows', 1242659, 1242660],
    ['GHSA-698v-4r3x-3vcv', 'moderate', 'launch-editor: escapeCmdArgs() omits % escaping on Windows', 1242623, 1242624],
    ['GHSA-r825-w8mm-5pxw', 'moderate', 'launch-editor: Editor CLI flag misinterpretation causing arbitrary command execution for some editors', 1242652, 1242653],
    ['GHSA-rq7h-c2jc-7f22', 'moderate', 'Vite: Files outside `server.fs.allow` could be served when project paths match system paths on non-Windows machine', 1242731, 1242732],
    ['GHSA-9jrq-w75r-8gcw', 'low', 'Vite: Cross origin script execution through Vite custom middleware', 1242725, 1242726],
  ].flatMap(([ghsa, severity, title, ...sources]) =>
    sources.map((source, index) => Object.freeze({
      source, name: 'vite', dependency: 'vite', title, severity, ghsa,
      url: `https://github.com/advisories/${ghsa}`, range: VITE_DEV_SERVER_RANGES[index],
    })),
  ),
)
// The exact dev-only vite installs, the same in the root and streampulse-web locks.
const VITE_DEV_SERVER_NODES = Object.freeze({
  'node_modules/vite': '8.0.16',
  'node_modules/vite-node/node_modules/vite': '7.3.6',
  'node_modules/vitest/node_modules/vite': '7.3.6',
})
const VITE_DEV_SERVER_LOCKS = Object.freeze(['streamclone-pulse', 'streampulse-web'])

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
  ...Object.keys(BRACES_BUILD_CHAIN).map((name) => ({
    name,
    ghsa: 'GHSA-vfj7-8cjw-p6xm',
    advisory: BRACES_ADVISORY,
    reason:
      'Exact locked Tailwind 3 development-only chain; repository-controlled build globs, no affected module in emitted browser chunks or dependency-free Pages Worker. No patched braces release exists. See docs/evidence/npm-audit-rpr6-2026-07.md.',
  })),
  {
    name: 'vite',
    ghsa: 'GHSA-587h-7wmj-h5pm',
    advisory: VITE_DEV_SERVER_ADVISORIES[0],
    reason:
      'Release branch release/ext-0.2.2-candidate-20261022 only. Dev-server code (launch-editor, custom middleware, server.fs.allow), not in any shipped file. Only the exact dev installs vite 8.0.16 and nested 7.3.6, and only GHSA-587h-7wmj-h5pm, GHSA-698v-4r3x-3vcv, GHSA-r825-w8mm-5pxw, GHSA-rq7h-c2jc-7f22 and GHSA-9jrq-w75r-8gcw. Master has the real fix (#145, vite 8.1.6). Expires when 0.2.2 ships or this branch is retired. See docs/evidence/npm-audit-vite-release-0.2.2-2026-10.md.',
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

/**
 * Follow only the reviewed graph. Every via entry must belong to this exact
 * advisory; a second advisory, changed version, production node, missing node,
 * redirected dependency, or cycle requires a new disposition review.
 */
export function auditHasExactBuildOnlyBracesGhsa(vulns, name, lock) {
  // The extension/root package has no reviewed occurrence of this advisory.
  if (!Object.hasOwn(BRACES_BUILD_CHAIN, name) || lock?.name !== 'streampulse-web' || lock?.packages?.['']?.name !== 'streampulse-web') return false
  function matchesNode(nodeName, visited) {
    const expected = Object.hasOwn(BRACES_BUILD_CHAIN, nodeName) ? BRACES_BUILD_CHAIN[nodeName] : undefined
    const info = vulns[nodeName]
    const node = `node_modules/${nodeName}`
    const installed = lock.packages[node]
    if (
      !expected || visited.has(nodeName) || !isRecord(info) || info.severity !== 'high' ||
      !Array.isArray(info.nodes) || info.nodes.length !== 1 || info.nodes[0] !== node ||
      installed?.dev !== true || installed?.version !== expected.version ||
      !Array.isArray(info.via)
    ) return false
    const nextVisited = new Set(visited).add(nodeName)
    if (nodeName === 'braces') {
      return info.via.length === 1 && advisoryMetadataMatches(
        info.via[0], { ...BRACES_ADVISORY, ghsa: 'GHSA-vfj7-8cjw-p6xm' }, 'high',
      )
    }
    if (info.via.length !== expected.parents.length || new Set(info.via).size !== info.via.length) return false
    return info.via.every((entry) =>
      typeof entry === 'string' && expected.parents.includes(entry) && matchesNode(entry, nextVisited),
    )
  }
  // Require the complete reviewed graph even for the leaf package entry.
  return matchesNode('tailwindcss', new Set())
}

/**
 * Release-branch vite disposition. The audit must list exactly the ten reviewed
 * advisory records (no extra, duplicate or missing one) and exactly the three
 * reviewed installs, each locked dev-only at its reviewed version.
 */
export function auditHasExactViteDevServerAdvisories(vulns, lock) {
  const info = vulns.vite
  const nodes = Object.keys(VITE_DEV_SERVER_NODES)
  if (!VITE_DEV_SERVER_LOCKS.includes(lock?.name) || lock?.packages?.['']?.name !== lock.name) return false
  if (!isRecord(info) || info.severity !== 'high' || !Array.isArray(info.via) || !Array.isArray(info.nodes)) return false
  if (info.nodes.length !== nodes.length || !nodes.every((node) => info.nodes.includes(node))) return false
  if (!nodes.every((node) => lock.packages[node]?.dev === true && lock.packages[node]?.version === VITE_DEV_SERVER_NODES[node])) return false
  if (info.via.length !== VITE_DEV_SERVER_ADVISORIES.length) return false
  return VITE_DEV_SERVER_ADVISORIES.every((advisory) =>
    info.via.filter((entry) => advisoryMetadataMatches(entry, advisory, advisory.severity)).length === 1,
  )
}

/** Fail the production build if any reviewed build tool reaches a browser chunk. */
export function assertBuildOnlyBracesRuntimeBoundary(bundle) {
  const forbidden = new Set()
  for (const chunk of Object.values(bundle)) {
    if (chunk.type !== 'chunk') continue
    for (const id of Object.keys(chunk.modules)) {
      const normalized = id.replaceAll('\\', '/')
      if (Object.keys(BRACES_BUILD_CHAIN).some((name) => normalized.includes(`/node_modules/${name}/`))) {
        forbidden.add(id)
      }
    }
  }
  if (forbidden.size) throw new Error(`Build-only audit dependency in browser output:\n${[...forbidden].join('\n')}`)
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
  // npm audit is invoked from the package directory in both existing CI jobs.
  // Read its lock only when a lock-bound disposition is actually needed.
  const buildOnlyLock = highs.some((hit) => Object.hasOwn(BRACES_BUILD_CHAIN, hit.name) || hit.name === 'vite')
    ? JSON.parse(readFileSync('package-lock.json', 'utf8'))
    : undefined
  /** @type {string[]} */
  const unexpected = []
  for (const hit of highs) {
    const disp = allowed.get(hit.name)
    if (!disp) {
      unexpected.push(`${hit.severity} ${hit.name} (no disposition)`)
      continue
    }
    const matches = Object.hasOwn(BRACES_BUILD_CHAIN, hit.name)
      ? auditHasExactBuildOnlyBracesGhsa(vulns, hit.name, buildOnlyLock)
      : hit.name === 'vite'
        ? auditHasExactViteDevServerAdvisories(vulns, buildOnlyLock)
        : auditHasExactGhsa(vulns, hit.name, disp.ghsa, disp.parent, hit.severity, disp.advisory)
    if (!matches) {
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
