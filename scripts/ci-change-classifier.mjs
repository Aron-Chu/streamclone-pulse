/**
 * Repository-owned CI change classifier.
 * Pure functions — no network; safe for unit tests and Actions.
 */

/** @typedef {'docs-only'|'portal'|'extension'|'shared-ui'|'extension-e2e'|'workflow'|'unknown'|'forced-full'} Classification */

/**
 * @typedef {object} ClassifyResult
 * @property {Classification} classification
 * @property {boolean} run_extension
 * @property {boolean} run_portal
 * @property {boolean} run_e2e
 * @property {boolean} force_full
 * @property {string} reason
 * @property {string[]} paths
 */

const DOC_EXT = /\.(md|mdx|txt)$/i
const IMAGE_DOC = /\.(png|jpe?g|gif|webp|svg)$/i

/** Paths that always force the full CI graph. */
const WORKFLOW_FORCE = [
  /^\.github\//,
  /^package\.json$/,
  /^package-lock\.json$/,
  /^streampulse-web\/package\.json$/,
  /^streampulse-web\/package-lock\.json$/,
  /^scripts\/ci-/,
  /^scripts\/ci-change-classifier/,
  /^vitest\.config/,
  /^tsconfig/,
  /^vite\.config/,
  /^playwright\.config/,
]

const PORTAL_PREFIX = /^streampulse-web\//
/**
 * Portal imports `@pulse-ext/ui` → `src/ui/**`, which transitively pulls `src/shared/**`
 * (analyticsLinks, pastVods, emoteUrl, storage shims, etc.). Conservative rule: any
 * change under src/ui or src/shared runs both extension and portal.
 */
const SHARED_EXT_PORTAL = /^src\/(ui|shared)\//
const EXT_E2E = /^(tests\/e2e\/|playwright\.config|scripts\/capture-extension|scripts\/capture-cws)/
const EXT_RUNTIME = /^(src\/|manifest\.json|popup\/|options\/|public\/|tests\/(?!e2e\/)|scripts\/(zip-dist|validate-extension|extension-package|write-extension|gen-icons|gen-cws|package|extension-target))/

/**
 * Normalize path separators and strip leading ./ 
 * @param {string} p
 */
export function normalizePath(p) {
  return String(p || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .trim()
}

/**
 * @param {string} path
 */
function isDocOnlyPath(path) {
  const p = normalizePath(path)
  if (!p) return false
  if (p.startsWith('docs/') || p.startsWith('store/cws/')) {
    return DOC_EXT.test(p) || IMAGE_DOC.test(p) || /\/README$/i.test(p) || p.endsWith('/README.md')
  }
  if (DOC_EXT.test(p) && !p.startsWith('streampulse-web/') && !p.startsWith('src/')) {
    // root / AGENTS / CONTRIBUTING style docs
    if (/^(AGENTS|CLAUDE|README|CONTRIBUTING|LICENSE|SECURITY|SUPPORT|CODE_OF_CONDUCT)/i.test(p)) return true
    if (p.startsWith('.cursor/') && DOC_EXT.test(p)) return true
  }
  return false
}

/**
 * @param {string} path
 */
function matchesForceFull(path) {
  const p = normalizePath(path)
  return WORKFLOW_FORCE.some((re) => re.test(p))
}

/**
 * Classify a list of changed paths.
 * @param {string[]} paths
 * @param {{ forceFull?: boolean }} [opts]
 * @returns {ClassifyResult}
 */
export function classifyChangedPaths(paths, opts = {}) {
  const forceFull = Boolean(opts.forceFull)
  const normalized = [...new Set((paths || []).map(normalizePath).filter(Boolean))]

  if (forceFull) {
    return {
      classification: 'forced-full',
      run_extension: true,
      run_portal: true,
      run_e2e: true,
      force_full: true,
      reason: 'force-full dispatch or explicit force',
      paths: normalized,
    }
  }

  if (normalized.length === 0) {
    return {
      classification: 'unknown',
      run_extension: true,
      run_portal: true,
      run_e2e: true,
      force_full: false,
      reason: 'empty path set — fail-safe full graph',
      paths: normalized,
    }
  }

  if (normalized.some(matchesForceFull)) {
    return {
      classification: 'workflow',
      run_extension: true,
      run_portal: true,
      run_e2e: true,
      force_full: false,
      reason: 'workflow/config/lockfile/classifier change',
      paths: normalized,
    }
  }

  let portal = false
  let extension = false
  let sharedUi = false
  let e2e = false
  let unknown = false
  let docsOnly = true

  for (const raw of normalized) {
    const p = normalizePath(raw)
    if (isDocOnlyPath(p)) continue

    docsOnly = false

    if (SHARED_EXT_PORTAL.test(p)) {
      sharedUi = true
      extension = true
      portal = true
      e2e = true
      continue
    }
    if (PORTAL_PREFIX.test(p)) {
      portal = true
      continue
    }
    if (EXT_E2E.test(p)) {
      extension = true
      e2e = true
      continue
    }
    if (EXT_RUNTIME.test(p) || p === 'manifest.json') {
      extension = true
      // runtime / lifecycle / manifest / vite already covered; e2e for those
      if (
        p.startsWith('src/') ||
        p === 'manifest.json' ||
        p.startsWith('vite.config') ||
        p.startsWith('tests/')
      ) {
        e2e = true
      }
      continue
    }

    // packaging scripts without e2e trigger
    if (p.startsWith('scripts/')) {
      extension = true
      continue
    }

    unknown = true
  }

  if (unknown) {
    return {
      classification: 'unknown',
      run_extension: true,
      run_portal: true,
      run_e2e: true,
      force_full: false,
      reason: 'unclassified path — fail-safe full graph',
      paths: normalized,
    }
  }

  if (docsOnly) {
    return {
      classification: 'docs-only',
      run_extension: false,
      run_portal: false,
      run_e2e: false,
      force_full: false,
      reason: 'documentation/assets only',
      paths: normalized,
    }
  }

  if (sharedUi) {
    return {
      classification: 'shared-ui',
      run_extension: true,
      run_portal: true,
      run_e2e: true,
      force_full: false,
      reason: 'src/ui or src/shared imported by portal via @pulse-ext/ui',
      paths: normalized,
    }
  }

  if (extension && portal) {
    return {
      classification: 'unknown',
      run_extension: true,
      run_portal: true,
      run_e2e: true,
      force_full: false,
      reason: 'mixed extension+portal paths without shared-ui alone',
      paths: normalized,
    }
  }

  if (portal && !extension) {
    return {
      classification: 'portal',
      run_extension: false,
      run_portal: true,
      run_e2e: false,
      force_full: false,
      reason: 'streampulse-web only',
      paths: normalized,
    }
  }

  if (extension) {
    return {
      classification: e2e ? 'extension-e2e' : 'extension',
      run_extension: true,
      run_portal: false,
      run_e2e: e2e,
      force_full: false,
      reason: e2e ? 'extension runtime/e2e harness change' : 'extension packaging/non-runtime change',
      paths: normalized,
    }
  }

  return {
    classification: 'unknown',
    run_extension: true,
    run_portal: true,
    run_e2e: true,
    force_full: false,
    reason: 'fallback fail-safe',
    paths: normalized,
  }
}

/**
 * Parse `git diff --name-status` / name-only lines including renames.
 * Accepts lines like `R100\told\tnew`, `M\tpath`, or bare paths.
 * @param {string} text
 * @returns {string[]}
 */
export function pathsFromDiffNameStatus(text) {
  const out = []
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parts = trimmed.split(/\t/)
    if (parts.length >= 3 && /^R\d*/.test(parts[0])) {
      out.push(parts[1], parts[2])
      continue
    }
    if (parts.length >= 2 && /^[AMDCRT]$/.test(parts[0])) {
      out.push(parts[1])
      if (parts[2]) out.push(parts[2])
      continue
    }
    // name-only
    out.push(parts[parts.length - 1])
  }
  return [...new Set(out.map(normalizePath).filter(Boolean))]
}

/**
 * Parse extension-job E2E execution proof.
 * Expected: "true" | "false" | "skipped" (string outputs from Actions).
 * @param {unknown} raw
 * @returns {'true'|'false'|'skipped'|null}
 */
export function normalizeE2eProof(raw) {
  const v = String(raw ?? '').trim().toLowerCase()
  if (v === 'true' || v === 'false' || v === 'skipped') return v
  return null
}

/**
 * Validate final-gate inputs.
 * @param {object} input
 * @param {'success'|'failure'|'cancelled'|'skipped'} input.guardResult
 * @param {ClassifyResult|null} input.classification
 * @param {{extension?: string, portal?: string}} input.jobResults result of needs.*.result
 * @param {string|undefined|null} [input.e2eExecuted] extension job output proof
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function evaluateFinalGate(input) {
  const errors = []
  const guard = input.guardResult
  if (guard !== 'success') {
    errors.push(`guard result is ${guard}`)
  }

  const c = input.classification
  if (!c || typeof c !== 'object') {
    errors.push('classifier output missing or invalid')
    return { ok: false, errors }
  }
  for (const key of ['run_extension', 'run_portal', 'run_e2e', 'force_full', 'classification']) {
    if (!(key in c)) errors.push(`classifier missing ${key}`)
  }
  if (errors.length) return { ok: false, errors }

  const ext = input.jobResults?.extension ?? 'skipped'
  const portal = input.jobResults?.portal ?? 'skipped'

  const expectExt = Boolean(c.run_extension) || Boolean(c.force_full)
  const expectPortal = Boolean(c.run_portal) || Boolean(c.force_full)
  const expectE2e = Boolean(c.run_e2e) || Boolean(c.force_full)

  if (c.force_full) {
    for (const [name, res] of [
      ['extension', ext],
      ['portal', portal],
    ]) {
      if (res !== 'success') errors.push(`force-full requires ${name}=success, got ${res}`)
    }
  } else {
    if (expectExt) {
      if (ext === 'skipped') errors.push('extension was unexpectedly skipped')
      else if (ext === 'failure' || ext === 'cancelled') errors.push(`extension ${ext}`)
    } else if (ext !== 'skipped' && ext !== 'success') {
      // If it ran anyway, still must not fail
      if (ext === 'failure' || ext === 'cancelled') errors.push(`extension ${ext}`)
    }

    if (expectPortal) {
      if (portal === 'skipped') errors.push('portal was unexpectedly skipped')
      else if (portal === 'failure' || portal === 'cancelled') errors.push(`portal ${portal}`)
    } else if (portal === 'failure' || portal === 'cancelled') {
      errors.push(`portal ${portal}`)
    }
  }

  // E2E execution proof — only meaningful when the extension job was expected.
  if (expectExt || expectE2e) {
    if (ext === 'failure' || ext === 'cancelled') {
      // already recorded above when expectExt; still note e2e when required
      if (expectE2e && ext !== 'failure' && ext !== 'cancelled') {
        /* noop */
      }
    } else if (ext === 'skipped' && expectE2e) {
      errors.push('e2e was required but extension job skipped')
    } else if (ext === 'success' || (expectE2e && ext !== 'skipped')) {
      const proof = normalizeE2eProof(input.e2eExecuted)
      if (expectE2e) {
        if (proof == null) errors.push('e2e execution proof missing or malformed')
        else if (proof === 'skipped') errors.push('e2e was required but proof is skipped')
        else if (proof !== 'true') errors.push(`e2e was required but proof is ${proof}`)
      } else {
        // E2E not required: proof must be skipped (or absent treated as skipped for older classifiers)
        if (proof != null && proof !== 'skipped' && proof !== 'false') {
          // Allow true if it ran anyway, but false is invalid when job succeeded without e2e step writing skipped
          if (proof === 'false') errors.push('e2e proof is false while extension succeeded')
        }
        if (proof == null && expectExt && ext === 'success') {
          errors.push('e2e execution proof missing (expected skipped when run_e2e=false)')
        }
      }
    }
  }

  return { ok: errors.length === 0, errors }
}

/**
 * CLI entry: read paths from argv or stdin list file.
 */
export function formatGithubOutput(result) {
  const lines = [
    `classification=${result.classification}`,
    `run_extension=${result.run_extension}`,
    `run_portal=${result.run_portal}`,
    `run_e2e=${result.run_e2e}`,
    `force_full=${result.force_full}`,
    `reason=${result.reason}`,
  ]
  return lines.join('\n')
}
