import { afterAll, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { buildInputs, buildInputState } from '../scripts/write-extension-build-provenance.mjs'

const GATE = 'scripts/lib/release-notes-gate.mjs'
const tempDirs: string[] = []

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

function write(dir: string, relativePath: string, content: string) {
  const path = join(dir, relativePath)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function tempRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'sp-build-provenance-'))
  tempDirs.push(dir)
  for (const [relativePath, content] of Object.entries(files)) write(dir, relativePath, content)
  for (const args of [['init', '-q'], ['add', '--', ...Object.keys(files)]]) {
    const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  }
  return dir
}

describe('local build provenance inputs', () => {
  it('lists the release-notes gate that store packaging depends on', () => {
    expect(buildInputs).toContain(GATE)
  })

  it('changes the input digest when the release-notes gate changes, and only then', () => {
    const dir = tempRepo({
      [GATE]: 'export const gate = 1\n',
      'scripts/zip-dist.mjs': 'export const zip = 1\n',
      'notes/unrelated.md': 'not a build input\n',
    })
    const baseline = buildInputState(dir).digest

    write(dir, GATE, 'export const gate = 2\n')
    const changed = buildInputState(dir).digest
    expect(changed).not.toBe(baseline)

    write(dir, 'notes/unrelated.md', 'still not a build input\n')
    expect(buildInputState(dir).digest).toBe(changed)

    write(dir, GATE, 'export const gate = 1\n')
    expect(buildInputState(dir).digest).toBe(baseline)
  })
})
