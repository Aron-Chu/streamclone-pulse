import { describe, expect, it } from 'vitest'
import {
  classifyChangedPaths,
  evaluateFinalGate,
  normalizeE2eProof,
  pathsFromDiffNameStatus,
} from '../scripts/ci-change-classifier.mjs'

const SHARED_DEPS = [
  'src/shared/analyticsLinks.ts',
  'src/shared/pastVods.ts',
  'src/shared/emoteUrl.ts',
]

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
    expect(r.run_e2e).toBe(false)
    expect(r.classification).toBe('extension')
  })

  it('classifies extension runtime with e2e', () => {
    const r = classifyChangedPaths(['src/background/api.ts', 'manifest.json'])
    expect(r.run_extension).toBe(true)
    expect(r.run_e2e).toBe(true)
    expect(r.run_portal).toBe(false)
    expect(r.classification).toBe('extension-e2e')
  })

  for (const path of SHARED_DEPS) {
    it(`classifies known portal shared dependency ${path}`, () => {
      const r = classifyChangedPaths([path])
      expect(r.classification).toBe('shared-ui')
      expect(r.run_extension).toBe(true)
      expect(r.run_portal).toBe(true)
      expect(r.run_e2e).toBe(true)
    })
  }

  it('classifies a new file under src/shared as shared', () => {
    const r = classifyChangedPaths(['src/shared/brandNewHelper.ts'])
    expect(r.classification).toBe('shared-ui')
    expect(r.run_extension).toBe(true)
    expect(r.run_portal).toBe(true)
    expect(r.run_e2e).toBe(true)
  })

  it('classifies direct src/ui changes as shared', () => {
    const r = classifyChangedPaths(['src/ui/Overlay.tsx'])
    expect(r.classification).toBe('shared-ui')
    expect(r.run_extension).toBe(true)
    expect(r.run_portal).toBe(true)
    expect(r.run_e2e).toBe(true)
  })

  const PORTAL_CONTENT_DEPS = [
    'src/content/bridge.ts',
    'src/content/twitch.ts',
    'src/content/twitchVodDiscovery.ts',
    'src/content/twitchChat.ts',
    'src/content/twitchChatControls.ts',
    'src/content/twitchLayout.ts',
    'src/content/twitchSidebarChrome.ts',
    'src/content/routeSyncScheduler.ts',
    'src/content/resolveOverlayHostVisibility.ts',
    'src/content/mount.tsx',
    'src/content/livePoll.ts',
    'src/content/entry.ts',
    'src/content/contentActivation.ts',
  ]

  for (const path of PORTAL_CONTENT_DEPS) {
    it(`classifies portal-bundled content module ${path}`, () => {
      const r = classifyChangedPaths([path])
      expect(r.classification).toBe('shared-ui')
      expect(r.run_extension).toBe(true)
      expect(r.run_portal).toBe(true)
      expect(r.run_e2e).toBe(true)
    })
  }

  it('classifies a newly introduced content dependency as shared', () => {
    const r = classifyChangedPaths(['src/content/brandNewPortalDep.ts'])
    expect(r.classification).toBe('shared-ui')
    expect(r.run_extension).toBe(true)
    expect(r.run_portal).toBe(true)
    expect(r.run_e2e).toBe(true)
  })

  it('fails final gate when content change requires portal but portal skipped', () => {
    const c = classifyChangedPaths(['src/content/bridge.ts'])
    expect(c.run_portal).toBe(true)
    const gate = evaluateFinalGate({
      guardResult: 'success',
      classification: c,
      jobResults: { extension: 'success', portal: 'skipped' },
      e2eExecuted: 'true',
    })
    expect(gate.ok).toBe(false)
    expect(gate.errors.some((e) => /portal/i.test(e))).toBe(true)
  })

  it('classifies workflow/config as full graph', () => {
    const r = classifyChangedPaths(['.github/workflows/ci.yml'])
    expect(r.classification).toBe('workflow')
    expect(r.run_extension).toBe(true)
    expect(r.run_portal).toBe(true)
    expect(r.run_e2e).toBe(true)
  })

  it('classifies classifier script changes as workflow full graph', () => {
    const r = classifyChangedPaths(['scripts/ci-change-classifier.mjs'])
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
    expect(r.run_e2e).toBe(true)
  })

  it('handles renames (old and new paths)', () => {
    const paths = pathsFromDiffNameStatus('R100\tdocs/a.md\tdocs/b.md\n')
    expect(paths).toEqual(['docs/a.md', 'docs/b.md'])
    const r = classifyChangedPaths(paths)
    expect(r.classification).toBe('docs-only')
  })

  it('rename into src/shared forces shared portal+extension', () => {
    const paths = pathsFromDiffNameStatus('R100\tsrc/background/old.ts\tsrc/shared/newShared.ts\n')
    const r = classifyChangedPaths(paths)
    expect(r.run_portal).toBe(true)
    expect(r.run_extension).toBe(true)
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

  it('PR-mode mixed portal+extension without shared alone is fail-safe full', () => {
    const r = classifyChangedPaths([
      'streampulse-web/src/main.tsx',
      'src/background/api.ts',
    ])
    expect(r.run_extension).toBe(true)
    expect(r.run_portal).toBe(true)
    expect(r.run_e2e).toBe(true)
  })
})

describe('normalizeE2eProof', () => {
  it('accepts true/false/skipped', () => {
    expect(normalizeE2eProof('true')).toBe('true')
    expect(normalizeE2eProof('FALSE')).toBe('false')
    expect(normalizeE2eProof('skipped')).toBe('skipped')
  })
  it('rejects malformed', () => {
    expect(normalizeE2eProof('')).toBe(null)
    expect(normalizeE2eProof('yes')).toBe(null)
    expect(normalizeE2eProof(undefined)).toBe(null)
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
        run_e2e: true,
        force_full: true,
      },
      jobResults: { extension: 'success', portal: 'skipped' },
      e2eExecuted: 'true',
    })
    expect(r.ok).toBe(false)
  })

  it('passes force-full when both succeed and e2e proof true', () => {
    const r = evaluateFinalGate({
      guardResult: 'success',
      classification: {
        ...base,
        classification: 'forced-full',
        run_extension: true,
        run_portal: true,
        run_e2e: true,
        force_full: true,
      },
      jobResults: { extension: 'success', portal: 'success' },
      e2eExecuted: 'true',
    })
    expect(r.ok).toBe(true)
  })

  it('fails when e2e required but proof skipped', () => {
    const r = evaluateFinalGate({
      guardResult: 'success',
      classification: {
        ...base,
        classification: 'extension-e2e',
        run_extension: true,
        run_e2e: true,
      },
      jobResults: { extension: 'success', portal: 'skipped' },
      e2eExecuted: 'skipped',
    })
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => /e2e/i.test(e))).toBe(true)
  })

  it('fails when e2e required but proof absent', () => {
    const r = evaluateFinalGate({
      guardResult: 'success',
      classification: {
        ...base,
        classification: 'extension-e2e',
        run_extension: true,
        run_e2e: true,
      },
      jobResults: { extension: 'success', portal: 'skipped' },
    })
    expect(r.ok).toBe(false)
  })

  it('fails when e2e required but proof false', () => {
    const r = evaluateFinalGate({
      guardResult: 'success',
      classification: {
        ...base,
        classification: 'extension-e2e',
        run_extension: true,
        run_e2e: true,
      },
      jobResults: { extension: 'success', portal: 'skipped' },
      e2eExecuted: 'false',
    })
    expect(r.ok).toBe(false)
  })

  it('fails when e2e required but extension cancelled', () => {
    const r = evaluateFinalGate({
      guardResult: 'success',
      classification: {
        ...base,
        classification: 'extension-e2e',
        run_extension: true,
        run_e2e: true,
      },
      jobResults: { extension: 'cancelled', portal: 'skipped' },
      e2eExecuted: 'true',
    })
    expect(r.ok).toBe(false)
  })

  it('passes when e2e not required and proof skipped', () => {
    const r = evaluateFinalGate({
      guardResult: 'success',
      classification: {
        ...base,
        classification: 'extension',
        run_extension: true,
        run_e2e: false,
      },
      jobResults: { extension: 'success', portal: 'skipped' },
      e2eExecuted: 'skipped',
    })
    expect(r.ok).toBe(true)
  })

  it('fails when e2e not required but proof missing on successful extension', () => {
    const r = evaluateFinalGate({
      guardResult: 'success',
      classification: {
        ...base,
        classification: 'extension',
        run_extension: true,
        run_e2e: false,
      },
      jobResults: { extension: 'success', portal: 'skipped' },
    })
    expect(r.ok).toBe(false)
  })

  it('passes shared-ui when both jobs succeed and e2e true', () => {
    const r = evaluateFinalGate({
      guardResult: 'success',
      classification: {
        ...base,
        classification: 'shared-ui',
        run_extension: true,
        run_portal: true,
        run_e2e: true,
      },
      jobResults: { extension: 'success', portal: 'success' },
      e2eExecuted: 'true',
    })
    expect(r.ok).toBe(true)
  })

  it('fails classifier regression that claims no e2e while extension skipped e2e silently', () => {
    // Classifier says e2e required; job reports success but proof says skipped → red.
    const r = evaluateFinalGate({
      guardResult: 'success',
      classification: {
        ...base,
        classification: 'shared-ui',
        run_extension: true,
        run_portal: true,
        run_e2e: true,
      },
      jobResults: { extension: 'success', portal: 'success' },
      e2eExecuted: 'skipped',
    })
    expect(r.ok).toBe(false)
  })
})
