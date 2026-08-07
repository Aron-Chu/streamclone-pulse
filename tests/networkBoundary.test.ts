import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

import manifest from '../manifest.json'

const ROOT = join(process.cwd(), 'src')
const SCAN_DIRS = ['content', 'ui'] as const

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

describe('network boundary', () => {
  it('forbids direct fetch() in content and UI layers', () => {
    const offenders: string[] = []
    for (const rel of SCAN_DIRS) {
      const dir = join(ROOT, rel)
      for (const file of listSourceFiles(dir)) {
        const source = readFileSync(file, 'utf8')
        if (/\bfetch\s*\(/.test(source)) {
          offenders.push(relative(process.cwd(), file).replace(/\\/g, '/'))
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('does not grant the debug loopback host permission', () => {
    const hosts = manifest.host_permissions ?? []
    expect(hosts.some(host => host.includes('127.0.0.1:7271'))).toBe(false)
    expect(JSON.stringify(manifest)).not.toContain('127.0.0.1:7271')
  })

  it('does not declare unused gql.twitch.tv host permission', () => {
    const hosts = manifest.host_permissions ?? []
    expect(hosts.some(host => /gql\.twitch\.tv/i.test(host))).toBe(false)
  })

  it('does not declare the tabs permission', () => {
    expect(manifest.permissions ?? []).not.toContain('tabs')
  })
})
