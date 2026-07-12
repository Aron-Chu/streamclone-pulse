import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ANALYTICS_OVERLAP_DEAD_PATHS,
  ANALYTICS_OVERLAP_REQUIRED_SCRIPT,
} from '../scripts/fixtures/analytics-overlap-contract.mjs'

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('analytics overlap gate contract', () => {
  it('keeps check:analytics-overlap in package.json scripts', () => {
    const pkg = JSON.parse(readFileSync(join(webRoot, 'package.json'), 'utf8'))
    expect(pkg.scripts?.[ANALYTICS_OVERLAP_REQUIRED_SCRIPT]).toMatch(/check-analytics-overlap/)
  })

  it('keeps the overlap checker script on disk', () => {
    expect(existsSync(join(webRoot, 'scripts/check-analytics-overlap.mjs'))).toBe(true)
  })

  it('keeps known dead duplicate paths deleted', () => {
    for (const rel of ANALYTICS_OVERLAP_DEAD_PATHS) {
      expect(existsSync(join(webRoot, rel)), `dead path must stay deleted: ${rel}`).toBe(false)
    }
  })

  it('wires overlap check into the build script', () => {
    const pkg = JSON.parse(readFileSync(join(webRoot, 'package.json'), 'utf8'))
    expect(String(pkg.scripts?.build ?? '')).toMatch(/check-analytics-overlap/)
  })
})
