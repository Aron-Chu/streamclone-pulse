import { describe, expect, it } from 'vitest'
import {
  classifyChangedPaths,
  evaluateFinalGate,
  pathsFromDiffNameStatus,
} from '../scripts/ci-change-classifier.mjs'

describe('ci-change-classifier', () => {
  it('classifies docs-only markdown', () => {
    const r = classifyChangedPaths(['docs/pulse-extension/release.md', 'README.md'])
    expect(r.classification).toBe('docs-only')
    expect(r.run_extension).toBe(false)
    expect(r.run_portal).toBe(false)
    expect(r.run_e2e).toBe(false)
  })

  it('classifies portal-only', () => {
    const r = classifyChangedPaths(['streampulse-web/src/routes/public/Support.tsx'])
    expect(r.classification).toBe('portal')
    expect(r.run_portal).toBe(true)
    expect(r.run_extension).toBe(false)
    expect(r.run_e2e).toBe(false)
  })

  it('classifies extension-only packaging without forcing e2e for scripts alone', () => {
    const r = classifyChangedPaths(['scripts/zip-dist.mjs'])
    expect(r.run_extension).toBe(true)
    expect(r.run_portal).toBe(false)
  })

  it('classifies extension runtime with e2e', () => {
    const r = classifyChangedPaths(['src/background/api.ts', 'manifest.json'])
    expect(r.run_extension).toBe(true)
    expect(r.run_e2e).toBe(true)
    expect(r.classification).toBe('extension-e2e')
  })

  it('classifies src/ui as shared (extension + portal)', () => {
    const r = classifyChangedPaths(['src/ui/Overlay.tsx'])
    expect(r.classification).toBe('shared-ui')
    expect(r.run_extension).toBe(true)
    expect(r.run_portal).toBe(true)
    expect(r.run_e2e).toBe(true)
  })

  it('classifies workflow/config as full graph', () => {
    const r = classifyChangedPaths(['.github/workflows/ci.yml'])
    expect(r.classification).toBe('workflow')
    expect(r.run_extension).toBe(true)
    expect(r.run_portal).toBe(true)
    expect(r.run_e2e).toBe(true)
  })

  it('classifies unknown paths as fail-safe full', () => {
    const r = classifyChangedPaths(['weird/unknown.bin'])
    expect(r.classification).toBe('unknown')
    expect(r.run_extension).toBe(true)
    expect(r.run_portal).toBe(true)
  })

  it('handles renames (old and new paths)', () => {
    const paths = pathsFromDiffNameStatus('R100\tdocs/a.md\tdocs/b.md\n')
    expect(paths).toEqual(['docs/a.md', 'docs/b.md'])
    const r = classifyChangedPaths(paths)
    expect(r.classification).toBe('docs-only')
  })

  it('empty paths fail-safe full', () => {
    const r = classifyChangedPaths([])
    expect(r.classification).toBe('unknown')
    expect(r.run_extension).toBe(true)
  })

  it('forced-full dispatch overrides paths', () => {
    const r = classifyChangedPaths(['docs/only.md'], { forceFull: true })
    expect(r.classification).toBe('forced-full')
    expect(r.run_extension).toBe(true)
    expect(r.run_portal).toBe(true)
    expect(r.force_full).toBe(true)
  })

  it('package-lock forces full graph', () => {
    const r = classifyChangedPaths(['package-lock.json'])
    expect(r.classification).toBe('workflow')
  })
})

describe('evaluateFinalGate', () => {
  const base = {
    classification: 'docs-only',
    run_extension: false,
    run_portal: false,
    run_e2e: false,
    force_full: false,
    reason: 'docs',
    paths: [],
  }

  it('passes when docs-only skips heavies', () => {
    const r = evaluateFinalGate({
      guardResult: 'success',
      classification: base,
      jobResults: { extension: 'skipped', portal: 'skipped' },
    })
    expect(r.ok).toBe(true)
  })

  it('fails when guard failed', () => {
    const r = evaluateFinalGate({
      guardResult: 'failure',
      classification: base,
      jobResults: { extension: 'skipped', portal: 'skipped' },
    })
    expect(r.ok).toBe(false)
  })

  it('fails when classifier missing', () => {
    const r = evaluateFinalGate({
      guardResult: 'success',
      classification: null,
      jobResults: {},
    })
    expect(r.ok).toBe(false)
  })

  it('fails when required portal skipped', () => {
    const r = evaluateFinalGate({
      guardResult: 'success',
      classification: { ...base, classification: 'portal', run_portal: true },
      jobResults: { extension: 'skipped', portal: 'skipped' },
    })
    expect(r.ok).toBe(false)
  })

  it('fails when portal cancelled', () => {
    const r = evaluateFinalGate({
      guardResult: 'success',
      classification: { ...base, classification: 'portal', run_portal: true },
      jobResults: { extension: 'skipped', portal: 'cancelled' },
    })
    expect(r.ok).toBe(false)
  })

  it('requires all heavies on force-full', () => {
    const r = evaluateFinalGate({
      guardResult: 'success',
      classification: {
        ...base,
        classification: 'forced-full',
        run_extension: true,
        run_portal: true,
        force_full: true,
      },
      jobResults: { extension: 'success', portal: 'skipped' },
    })
    expect(r.ok).toBe(false)
  })

  it('passes force-full when both succeed', () => {
    const r = evaluateFinalGate({
      guardResult: 'success',
      classification: {
        ...base,
        classification: 'forced-full',
        run_extension: true,
        run_portal: true,
        force_full: true,
      },
      jobResults: { extension: 'success', portal: 'success' },
    })
    expect(r.ok).toBe(true)
  })
})
