/**
 * Release-notes publishability gate shared by store packaging and validation.
 *
 * A store package is uploadable only when the packaged version's release-notes
 * entry has the exact status "released" and a `releasedAt` that is a real
 * `YYYY-MM-DD` calendar date. Ordinary store packaging
 * fails closed on an unreleased entry, and `package-extension-target.mjs` runs
 * this gate before building so a known rejection never overwrites `dist/` or
 * a previous store ZIP.
 *
 * CI must still prove every store target builds and validates while a branch's
 * notes are legitimately unreleased. That is the CI package probe:
 * `STREAMPULSE_CI_PACKAGE_PROBE=1`, honored only inside the GitHub Actions CI
 * workflow (`.github/workflows/ci.yml`) and refused on tag refs. Probe artifacts
 * carry the `-ci-probe-not-for-upload` suffix and a validation report with
 * `uploadable: false`, so nothing a probe produces can pass for a store
 * candidate.
 */

export const CI_PACKAGE_PROBE_ENV = 'STREAMPULSE_CI_PACKAGE_PROBE'
export const CI_PACKAGE_PROBE_SUFFIX = '-ci-probe-not-for-upload'

const CI_WORKFLOW_REF_MARKER = '/.github/workflows/ci.yml@'

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ enabled: boolean, error: string | null }}
 */
export function resolveCiPackageProbe(env = process.env) {
  const requested = env[CI_PACKAGE_PROBE_ENV]
  if (requested === undefined || requested === '') return { enabled: false, error: null }
  if (requested !== '1') {
    return { enabled: false, error: `${CI_PACKAGE_PROBE_ENV} must be "1" or unset` }
  }
  if (env.GITHUB_ACTIONS !== 'true' || env.CI !== 'true') {
    return { enabled: false, error: `${CI_PACKAGE_PROBE_ENV} is honored only inside GitHub Actions CI` }
  }
  if (!String(env.GITHUB_WORKFLOW_REF ?? '').includes(CI_WORKFLOW_REF_MARKER)) {
    return {
      enabled: false,
      error: `${CI_PACKAGE_PROBE_ENV} is honored only by .github/workflows/ci.yml`,
    }
  }
  if (String(env.GITHUB_REF ?? '').startsWith('refs/tags/')) {
    return { enabled: false, error: `${CI_PACKAGE_PROBE_ENV} is refused on tag refs` }
  }
  return { enabled: true, error: null }
}

/**
 * @param {{ notes: unknown, version: string, storeTarget: boolean, probe?: boolean }} input
 * @returns {{ failures: string[], oks: string[], notices: string[], publishable: boolean, uploadable: boolean }}
 */
export function evaluateReleaseNotesGate({ notes, version, storeTarget, probe = false }) {
  const failures = []
  const oks = []
  const notices = []
  let publishableEntry = null
  const result = () => {
    const publishable = failures.length === 0 && publishableEntry !== null
    return { failures, oks, notices, publishable, uploadable: storeTarget && publishable && !probe }
  }

  if (!notes || typeof notes !== 'object' || Array.isArray(notes)) {
    failures.push('release notes are missing or not a JSON object')
    return result()
  }

  if (notes.currentVersion !== version) {
    failures.push(
      `release-notes currentVersion=${JSON.stringify(notes.currentVersion)} != manifest version ${JSON.stringify(version)}`,
    )
  } else {
    oks.push(`release-notes currentVersion matches manifest ${version}`)
  }

  const entries = Array.isArray(notes.releases)
    ? notes.releases.filter((release) => release && release.version === version)
    : []
  if (entries.length === 0) {
    failures.push(`release-notes has no entry for packaged version ${version}`)
    return result()
  }
  if (entries.length > 1) {
    failures.push(`release-notes has ${entries.length} entries for version ${version}; exactly one is required`)
    return result()
  }

  const [entry] = entries

  if (!storeTarget) {
    notices.push(
      `release-notes entry ${version} status=${JSON.stringify(entry.status)} (development target does not require a publishable status)`,
    )
    return result()
  }

  if (entry.status === 'unreleased') {
    if (probe) {
      notices.push(
        `CI package probe: release-notes entry ${version} is still status="unreleased"; artifacts are NOT FOR UPLOAD`,
      )
    } else {
      failures.push(
        `release-notes entry ${version} is still status="unreleased" — store packages require "released" with a releasedAt date`,
      )
    }
    return result()
  }

  // Anything other than the exact two known states is a data error, never a
  // near-miss to accept: store packages publish only an exact "released".
  if (entry.status !== 'released') {
    failures.push(
      `release-notes entry ${version} has status=${JSON.stringify(entry.status)}; store packages accept only "released"`,
    )
    return result()
  }

  if (!isCalendarDate(entry.releasedAt)) {
    failures.push(
      `release-notes entry ${version} has releasedAt=${JSON.stringify(entry.releasedAt ?? null)}; store packages require a real calendar date as YYYY-MM-DD`,
    )
    return result()
  }

  publishableEntry = entry
  oks.push(`release-notes entry ${version} is publishable (status="released", releasedAt=${entry.releasedAt})`)
  if (probe) notices.push('CI package probe: artifacts are NOT FOR UPLOAD')
  return result()
}

/** `YYYY-MM-DD` naming a day that exists (rejects 2026-02-30, 2026-13-01, …). */
export function isCalendarDate(value) {
  if (typeof value !== 'string') return false
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const [year, month, day] = match.slice(1).map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}
