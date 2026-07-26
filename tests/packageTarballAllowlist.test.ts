import { describe, expect, it } from 'vitest'
import {
  auditTarballEntries,
  classifyTarballEntry,
} from '../scripts/check-package-tarball.mjs'

describe('package tarball allowlist', () => {
  it('allows src, LICENSE, NOTICE, package.json, root css, and dist', () => {
    const allowed = [
      'package/package.json',
      'package/LICENSE',
      'package/NOTICE',
      'package/src/index.ts',
      'package/src/utils/foo.ts',
      'package/pulse-chart-motion.css',
      'package/dist/index.js',
      'package/README.md',
    ]
    for (const entry of allowed) {
      expect(classifyTarballEntry(entry), entry).toEqual({ ok: true })
    }
    expect(auditTarballEntries(allowed).ok).toBe(true)
  })

  it('treats NOTICE as an allowlisted mandatory attribution file', () => {
    expect(classifyTarballEntry('package/NOTICE')).toEqual({ ok: true })
  })

  it('rejects tests, maps, env, lockfiles, backend paths, and absolute paths', () => {
    const denied = [
      ['package/tests/liveHeat.test.ts', 'deny-pattern'],
      ['package/src/liveHeat.test.ts', 'deny-pattern'],
      ['package/src/index.js.map', 'deny-pattern'],
      ['package/.env', 'deny-pattern'],
      ['package/.env.local', 'deny-pattern'],
      ['package/package-lock.json', 'deny-pattern'],
      ['package/streampulse-backend/secret.ts', 'deny-pattern'],
      ['package/../etc/passwd', 'parent-segment'],
      ['/abs/src/index.ts', 'absolute-or-url-path'],
      ['C:/Users/x/src/index.ts', 'absolute-or-url-path'],
      ['package/scripts/transform-chart.mjs', 'not-allowlisted'],
    ] as const

    for (const [entry, reasonPrefix] of denied) {
      const result = classifyTarballEntry(entry)
      expect(result.ok, entry).toBe(false)
      if (!result.ok) {
        expect(result.reason, entry).toContain(reasonPrefix)
      }
    }

    const audit = auditTarballEntries(denied.map(([p]) => p))
    expect(audit.ok).toBe(false)
    expect(audit.violations.length).toBe(denied.length)
  })
})
