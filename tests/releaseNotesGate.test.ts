import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  CI_PACKAGE_PROBE_ENV,
  CI_PACKAGE_PROBE_SUFFIX,
  evaluateReleaseNotesGate,
  isCalendarDate,
  resolveCiPackageProbe,
} from '../scripts/lib/release-notes-gate.mjs'
import { targetArtifactNames } from '../scripts/extension-package-lib.mjs'

const read = (relative: string) => readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), 'utf8')

const ciEnv = {
  [CI_PACKAGE_PROBE_ENV]: '1',
  CI: 'true',
  GITHUB_ACTIONS: 'true',
  GITHUB_WORKFLOW_REF: 'Aron-Chu/streamclone-pulse/.github/workflows/ci.yml@refs/pull/9/merge',
  GITHUB_REF: 'refs/pull/9/merge',
}

function notes(entry: Record<string, unknown>, currentVersion = '9.9.9', extra: unknown[] = []) {
  return { schemaVersion: 1, currentVersion, releases: [{ version: '9.9.9', title: 't', summary: 's', ...entry }, ...extra] }
}

describe('resolveCiPackageProbe', () => {
  it('is off when unset or empty', () => {
    expect(resolveCiPackageProbe({})).toEqual({ enabled: false, error: null })
    expect(resolveCiPackageProbe({ [CI_PACKAGE_PROBE_ENV]: '' })).toEqual({ enabled: false, error: null })
  })

  it('is honored only inside the GitHub Actions CI workflow on a non-tag ref', () => {
    expect(resolveCiPackageProbe(ciEnv)).toEqual({ enabled: true, error: null })
  })

  it('refuses every other context instead of silently packaging', () => {
    const cases: Record<string, string | undefined>[] = [
      { ...ciEnv, [CI_PACKAGE_PROBE_ENV]: 'true' },
      { ...ciEnv, [CI_PACKAGE_PROBE_ENV]: '0' },
      { ...ciEnv, GITHUB_ACTIONS: undefined },
      { ...ciEnv, CI: undefined },
      { ...ciEnv, GITHUB_WORKFLOW_REF: 'Aron-Chu/streamclone-pulse/.github/workflows/release-artifacts.yml@refs/tags/v9.9.9' },
      { ...ciEnv, GITHUB_WORKFLOW_REF: undefined },
      { ...ciEnv, GITHUB_REF: 'refs/tags/v9.9.9' },
    ]
    for (const env of cases) {
      const result = resolveCiPackageProbe(env)
      expect(result.enabled, JSON.stringify(env)).toBe(false)
      expect(result.error, JSON.stringify(env)).toMatch(new RegExp(CI_PACKAGE_PROBE_ENV))
    }
  })
})

describe('evaluateReleaseNotesGate', () => {
  it('rejects an unreleased entry for ordinary store packaging', () => {
    const gate = evaluateReleaseNotesGate({ notes: notes({ status: 'unreleased', releasedAt: null }), version: '9.9.9', storeTarget: true })
    expect(gate.failures).toHaveLength(1)
    expect(gate.failures[0]).toMatch(/still status="unreleased"/)
    expect(gate.publishable).toBe(false)
    expect(gate.uploadable).toBe(false)
  })

  it('lets only the CI probe continue past an unreleased entry, never as uploadable', () => {
    const gate = evaluateReleaseNotesGate({ notes: notes({ status: 'unreleased', releasedAt: null }), version: '9.9.9', storeTarget: true, probe: true })
    expect(gate.failures).toEqual([])
    expect(gate.notices.join(' ')).toMatch(/NOT FOR UPLOAD/)
    expect(gate.uploadable).toBe(false)
  })

  it('accepts a released entry with a date, and a probe of it is still not uploadable', () => {
    const released = notes({ status: 'released', releasedAt: '2026-09-30' })
    const real = evaluateReleaseNotesGate({ notes: released, version: '9.9.9', storeTarget: true })
    expect(real.failures).toEqual([])
    expect(real.uploadable).toBe(true)
    expect(evaluateReleaseNotesGate({ notes: released, version: '9.9.9', storeTarget: true, probe: true }).uploadable).toBe(false)
  })

  it('accepts only the exact "released" status, for real and probe packaging alike', () => {
    const statuses: unknown[] = ['draft', 'Released', 'RELEASED', 'released ', 'rc', 'published', '', null, undefined, 1, true]
    for (const status of statuses) {
      for (const probe of [false, true]) {
        const gate = evaluateReleaseNotesGate({ notes: notes({ status, releasedAt: '2026-09-30' }), version: '9.9.9', storeTarget: true, probe })
        expect(gate.failures, `status=${JSON.stringify(status)} probe=${probe}`).toHaveLength(1)
        expect(gate.failures[0]).toMatch(/store packages accept only "released"/)
        expect(gate.uploadable).toBe(false)
      }
    }
  })

  it('rejects a released entry whose releasedAt is missing, malformed, or impossible', () => {
    const invalid: unknown[] = [
      null, undefined, '', 20260930, '2026/09/30', '30-09-2026', '2026-9-30', '2026-09-3', ' 2026-09-30',
      '2026-09-30T00:00:00Z', '2026-09-30 ', 'yesterday', 'Sep 30, 2026',
      '2026-02-30', '2026-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-09-00', '2026-09-32',
    ]
    for (const releasedAt of invalid) {
      for (const probe of [false, true]) {
        const gate = evaluateReleaseNotesGate({ notes: notes({ status: 'released', releasedAt }), version: '9.9.9', storeTarget: true, probe })
        expect(gate.failures, `releasedAt=${JSON.stringify(releasedAt)} probe=${probe}`).toHaveLength(1)
        expect(gate.failures[0]).toMatch(/real calendar date as YYYY-MM-DD/)
        expect(gate.uploadable).toBe(false)
      }
    }
  })

  it('recognizes real calendar dates, including leap days', () => {
    for (const value of ['2026-08-31', '2026-12-31', '2028-02-29', '2000-02-29']) expect(isCalendarDate(value), value).toBe(true)
    for (const value of ['2100-02-29', '1900-02-29', '2026-06-31']) expect(isCalendarDate(value), value).toBe(false)
  })

  it('keeps structural failures hard even for the probe', () => {
    const probe = { version: '9.9.9', storeTarget: true, probe: true }
    expect(evaluateReleaseNotesGate({ ...probe, notes: notes({ status: 'released', releasedAt: null }) }).failures[0]).toMatch(/real calendar date/)
    expect(evaluateReleaseNotesGate({ ...probe, notes: notes({ status: 'unreleased' }, '9.9.8') }).failures[0]).toMatch(/currentVersion/)
    expect(evaluateReleaseNotesGate({ ...probe, notes: { currentVersion: '9.9.9', releases: [] } }).failures[0]).toMatch(/no entry/)
    expect(evaluateReleaseNotesGate({ ...probe, notes: notes({ status: 'unreleased' }, '9.9.9', [{ version: '9.9.9', status: 'released', releasedAt: '2026-08-31' }]) }).failures[0]).toMatch(/exactly one/)
    expect(evaluateReleaseNotesGate({ ...probe, notes: null }).failures[0]).toMatch(/not a JSON object/)
  })

  it('only notes status for the development target', () => {
    const gate = evaluateReleaseNotesGate({ notes: notes({ status: 'unreleased' }), version: '9.9.9', storeTarget: false })
    expect(gate.failures).toEqual([])
    expect(gate.uploadable).toBe(false)
  })
})

describe('CI probe artifacts', () => {
  it('are renamed not-for-upload for store targets only', () => {
    expect(targetArtifactNames('cws', '9.9.9')).toEqual({
      zipName: 'streampulse-extension-cws-9.9.9.zip',
      checksumName: 'streampulse-extension-cws-9.9.9.zip.sha256',
      reportName: 'streampulse-extension-cws-9.9.9.validation.json',
    })
    expect(targetArtifactNames('cws', '9.9.9', { ciProbe: true })).toEqual({
      zipName: `streampulse-extension-cws-9.9.9${CI_PACKAGE_PROBE_SUFFIX}.zip`,
      checksumName: `streampulse-extension-cws-9.9.9${CI_PACKAGE_PROBE_SUFFIX}.zip.sha256`,
      reportName: `streampulse-extension-cws-9.9.9${CI_PACKAGE_PROBE_SUFFIX}.validation.json`,
    })
    expect(targetArtifactNames('development', '9.9.9', { ciProbe: true }).zipName).toBe('streampulse-extension-development-9.9.9.zip')
  })
})

describe('workflow wiring', () => {
  it('sets the probe only on the CI store-target packaging step', () => {
    const ci = read('.github/workflows/ci.yml')
    const occurrences = ci.split(`${CI_PACKAGE_PROBE_ENV}: '1'`).length - 1
    expect(occurrences).toBe(1)
    const step = ci.slice(ci.indexOf('- name: Store-target package validation'))
    expect(step.slice(0, 900)).toContain(`${CI_PACKAGE_PROBE_ENV}: '1'`)
    expect(ci).toContain('--zip "streampulse-extension-firefox-${VERSION}-ci-probe-not-for-upload.zip"')
  })

  it('refuses the probe and probe artifacts when building release artifacts', () => {
    const release = read('.github/workflows/release-artifacts.yml')
    expect(release).not.toContain(`${CI_PACKAGE_PROBE_ENV}: '1'`)
    expect(release).toContain(`if [[ -n "\${${CI_PACKAGE_PROBE_ENV}:-}" ]]; then`)
    expect(release).toContain("compgen -G '*-ci-probe-not-for-upload*'")
  })

  it('checks release notes before building a store package', () => {
    const source = read('scripts/package-extension-target.mjs')
    expect(source.indexOf('preflightStoreReleaseNotes(target)')).toBeGreaterThan(-1)
    expect(source.indexOf('preflightStoreReleaseNotes(target)')).toBeLessThan(source.indexOf("run('npx', ['vite', 'build'], storeEnv)"))
  })
})
