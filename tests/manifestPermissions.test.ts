import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as {
  permissions?: string[]
  host_permissions?: string[]
  optional_host_permissions?: string[]
  content_scripts?: Array<{ matches?: string[] }>
}

const EXPECTED_PERMISSIONS = ['storage', 'scripting']
const EXPECTED_HOST_PERMISSIONS = [
  'https://api.streampulse.stream/*',
  'https://cdn.7tv.app/*',
  'https://static-cdn.jtvnw.net/*',
  'https://cdn.frankerfacez.com/*',
  'https://gql.twitch.tv/*',
  'https://*.twitch.tv/*',
]
const EXPECTED_OPTIONAL_HOST_PERMISSIONS = [
  'http://localhost:8081/*',
  'http://127.0.0.1:8081/*',
]
const EXPECTED_CONTENT_SCRIPT_MATCHES = ['https://*.twitch.tv/*']

describe('production manifest permissions', () => {
  it('keeps localhost under optional_host_permissions only', () => {
    expect(manifest.permissions).toEqual(EXPECTED_PERMISSIONS)
    expect(manifest.host_permissions).toEqual(EXPECTED_HOST_PERMISSIONS)
    expect(manifest.optional_host_permissions).toEqual(EXPECTED_OPTIONAL_HOST_PERMISSIONS)
    for (const host of manifest.host_permissions ?? []) {
      expect(host.includes('localhost') || host.includes('127.0.0.1')).toBe(false)
    }
    expect(manifest.permissions).not.toContain('tabs')
  })

  it('matches content scripts on HTTPS Twitch only', () => {
    const matches = manifest.content_scripts?.flatMap((entry) => entry.matches ?? []) ?? []
    expect(matches).toEqual(EXPECTED_CONTENT_SCRIPT_MATCHES)
    for (const pattern of matches) {
      expect(pattern.startsWith('https://')).toBe(true)
      expect(pattern.startsWith('*://')).toBe(false)
    }
  })
})
