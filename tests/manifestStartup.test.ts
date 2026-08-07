import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import manifest from '../manifest.json'

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

describe('content-script startup', () => {
  it('injects after the DOM is parsed instead of waiting for page idle', () => {
    expect(manifest.content_scripts[0]?.run_at).toBe('document_end')
  })

  it('does not include the debug loopback telemetry host', () => {
    const hosts = manifest.host_permissions ?? []
    expect(hosts.some(host => host.includes(':7271'))).toBe(false)
  })
})

describe('CWS permission minimalism', () => {
  it('keeps only storage and scripting API permissions', () => {
    expect([...(manifest.permissions ?? [])].sort()).toEqual(['scripting', 'storage'])
  })

  it('does not declare the tabs permission (Twitch host access covers tab URL use)', () => {
    expect(manifest.permissions ?? []).not.toContain('tabs')
  })

  it('keeps local BFF, hosted API, and Twitch hosts only', () => {
    expect([...(manifest.host_permissions ?? [])].sort()).toEqual(
      [
        'http://127.0.0.1:8081/*',
        'http://localhost:8081/*',
        'https://*.twitch.tv/*',
        'https://api.streampulse.stream/*',
      ].sort(),
    )
  })

  it('does not declare gql.twitch.tv host permission (page MAIN-world fetch)', () => {
    const hosts = manifest.host_permissions ?? []
    expect(hosts.some(host => host.includes('gql.twitch.tv'))).toBe(false)
  })

  it('does not declare emote CDN host permissions (HTTPS img loads; SW proxies http only)', () => {
    const hosts = (manifest.host_permissions ?? []).join('\n')
    expect(hosts).not.toContain('cdn.7tv.app')
    expect(hosts).not.toContain('static-cdn.jtvnw.net')
    expect(hosts).not.toContain('cdn.frankerfacez.com')
  })
})

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
