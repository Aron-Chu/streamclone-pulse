import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const root = join(__dirname, '..')

describe('ci context contract', () => {
  it('keeps Go backend routing on streampulse-backend', () => {
    const mdc = join(root, '.cursor/rules/streamclone.mdc')
    expect(existsSync(mdc)).toBe(true)
    const text = require('node:fs').readFileSync(mdc, 'utf8')
    expect(text).toMatch(/streampulse-backend/)
    expect(text).not.toMatch(/Backend changes → sibling \*\*streamclone\*\*/)
  })

  it('runs owner-local context contract script', () => {
    execFileSync('bash', [join(root, 'scripts/ci-context-contract.sh')], {
      cwd: root,
      stdio: 'pipe',
    })
  })
})