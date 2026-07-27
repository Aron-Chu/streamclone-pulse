import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const gate = join(repoRoot, 'scripts', 'ci-final-gate.mjs')
const classify = join(repoRoot, 'scripts', 'ci-classify-changes.mjs')

describe('ci-classify-changes invalid SHA', () => {
  it('fail-safes full graph for invalid SHAs', () => {
    const out = mkdtempSync(join(tmpdir(), 'ci-class-'))
    try {
      const r = spawnSync(
        process.execPath,
        [classify, '--base', 'not-a-sha', '--head', 'also-bad', '--out-dir', out],
        { cwd: repoRoot, encoding: 'utf8' },
      )
      expect(r.status).toBe(0)
      const json = JSON.parse(readFileSync(join(out, 'classification.json'), 'utf8'))
      expect(json.run_extension).toBe(true)
      expect(json.run_portal).toBe(true)
      expect(json.run_e2e).toBe(true)
      expect(json.run_portal_e2e).toBe(true)
      expect(String(json.reason)).toMatch(/invalid or missing SHA/i)
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })

  it('force-full mode without SHAs still forces full', () => {
    const out = mkdtempSync(join(tmpdir(), 'ci-force-'))
    try {
      const r = spawnSync(process.execPath, [classify, '--force-full', '--out-dir', out], {
        cwd: repoRoot,
        encoding: 'utf8',
      })
      expect(r.status).toBe(0)
      const json = JSON.parse(readFileSync(join(out, 'classification.json'), 'utf8'))
      expect(json.classification).toBe('forced-full')
      expect(json.force_full).toBe(true)
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })
})

describe('ci-final-gate CLI e2e proof', () => {
  it('fails CLI when required e2e proof is skipped', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ci-gate-'))
    try {
      const classification = {
        classification: 'extension-e2e',
        run_extension: true,
        run_portal: false,
        run_e2e: true,
        run_portal_e2e: false,
        force_full: false,
        reason: 'test',
        paths: [],
      }
      const path = join(dir, 'classification.json')
      writeFileSync(path, JSON.stringify(classification))
      const r = spawnSync(
        process.execPath,
        [
          gate,
          '--guard',
          'success',
          '--classification',
          path,
          '--extension',
          'success',
          '--portal',
          'skipped',
          '--e2e-executed',
          'skipped',
          '--portal-e2e-executed',
          'skipped',
        ],
        { cwd: repoRoot, encoding: 'utf8' },
      )
      expect(r.status).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails CLI when required portal e2e proof is skipped', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ci-portal-gate-'))
    try {
      const classification = {
        classification: 'portal',
        run_extension: false,
        run_portal: true,
        run_e2e: false,
        run_portal_e2e: true,
        force_full: false,
        reason: 'test',
        paths: [],
      }
      const path = join(dir, 'classification.json')
      writeFileSync(path, JSON.stringify(classification))
      const r = spawnSync(
        process.execPath,
        [
          gate,
          '--guard',
          'success',
          '--classification',
          path,
          '--extension',
          'skipped',
          '--portal',
          'success',
          '--e2e-executed',
          'skipped',
          '--portal-e2e-executed',
          'skipped',
        ],
        { cwd: repoRoot, encoding: 'utf8' },
      )
      expect(r.status).toBe(1)
      expect(String(r.stderr || '')).toMatch(/portal e2e/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('passes CLI when portal e2e proof is true', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ci-portal-ok-'))
    try {
      const classification = {
        classification: 'portal',
        run_extension: false,
        run_portal: true,
        run_e2e: false,
        run_portal_e2e: true,
        force_full: false,
        reason: 'test',
        paths: [],
      }
      const path = join(dir, 'classification.json')
      writeFileSync(path, JSON.stringify(classification))
      const r = spawnSync(
        process.execPath,
        [
          gate,
          '--guard',
          'success',
          '--classification',
          path,
          '--extension',
          'skipped',
          '--portal',
          'success',
          '--e2e-executed',
          'skipped',
          '--portal-e2e-executed',
          'true',
        ],
        { cwd: repoRoot, encoding: 'utf8' },
      )
      expect(r.status).toBe(0)
      expect(String(r.stdout || '')).toMatch(/final-gate OK/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
