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

describe('public-first extension has no beta/access key path', () => {
  it('ships no beta-key storage helpers or auth headers in extension source', () => {
    const offenders: string[] = []
    const banned =
      /\b(getBetaKey|setBetaKey|betaKey|X-Streamclone-Beta-Key|accessKey)\b|X-Streamclone-Beta/i
    for (const file of listSourceFiles(SRC_ROOT)) {
      const source = readFileSync(file, 'utf8')
      if (banned.test(source)) {
        offenders.push(file.replace(/\\/g, '/'))
      }
    }
    expect(offenders).toEqual([])
  })
})
