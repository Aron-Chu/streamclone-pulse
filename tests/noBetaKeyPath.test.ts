import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC_ROOT = join(process.cwd(), 'src')

function listSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir)
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      files.push(...listSourceFiles(full))
      continue
    }
    if (/\.(ts|tsx)$/.test(entry)) files.push(full)
  }
  return files
}

describe('device enrollment key handling', () => {
  it('does not persist beta keys in extension storage', () => {
    const offenders: string[] = []
    const banned = /chrome\.storage\.(sync|local)[^\n;]*betaKey/i
    for (const file of listSourceFiles(SRC_ROOT)) {
      const source = readFileSync(file, 'utf8')
      if (banned.test(source)) {
        offenders.push(file.replace(/\\/g, '/'))
      }
    }
    expect(offenders).toEqual([])
  })
})
