import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function loadManifest(name: string) {
  return JSON.parse(readFileSync(join(root, 'manifests', name), 'utf8')) as {
    permissions?: string[]
    host_permissions?: string[]
    optional_host_permissions?: string[]
    content_scripts?: Array<{ matches?: string[] }>
    version?: string
  }
}

const EXPECTED_PERMISSIONS = ['storage', 'scripting']
const EXPECTED_HOST_PERMISSIONS = [
  'https://api.streampulse.stream/*',
  'https://cdn.7tv.app/*',
  'https://static-cdn.jtvnw.net/*',
  'https://cdn.frankerfacez.com/*',
  'https://*.twitch.tv/*',
]
const EXPECTED_OPTIONAL_HOST_PERMISSIONS = [
  'http://localhost:8081/*',
  'http://127.0.0.1:8081/*',
]
const EXPECTED_CONTENT_SCRIPT_MATCHES = ['https://*.twitch.tv/*']

describe('manifest targets', () => {
  it('development keeps localhost under optional_host_permissions only', () => {
    const manifest = loadManifest('development.json')
    expect(manifest.permissions).toEqual(EXPECTED_PERMISSIONS)
    expect(manifest.host_permissions).toEqual(EXPECTED_HOST_PERMISSIONS)
    expect(manifest.optional_host_permissions).toEqual(EXPECTED_OPTIONAL_HOST_PERMISSIONS)
    for (const host of manifest.host_permissions ?? []) {
      expect(host.includes('localhost') || host.includes('127.0.0.1')).toBe(false)
    }
  })

  it('CWS, Edge, and Firefox store manifests have no localhost or loopback permissions', () => {
    for (const name of ['cws.json', 'edge.json', 'firefox.json'] as const) {
      const manifest = loadManifest(name)
      expect(manifest.permissions).toEqual(EXPECTED_PERMISSIONS)
      expect(manifest.host_permissions).toEqual(EXPECTED_HOST_PERMISSIONS)
      expect(manifest.optional_host_permissions ?? []).toEqual([])
      const allHosts = [...(manifest.host_permissions ?? []), ...(manifest.optional_host_permissions ?? [])]
      for (const host of allHosts) {
        expect(host.includes('localhost') || host.includes('127.0.0.1')).toBe(false)
      }
    }
  })

  it('root manifest.json stays aligned with development for Load unpacked', () => {
    const rootManifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))
    const development = loadManifest('development.json')
    expect(rootManifest).toEqual(development)
  })

  it('matches content scripts on HTTPS Twitch only', () => {
    for (const name of ['development.json', 'cws.json', 'edge.json', 'firefox.json'] as const) {
      const manifest = loadManifest(name)
      const matches = manifest.content_scripts?.flatMap((entry) => entry.matches ?? []) ?? []
      expect(matches).toEqual(EXPECTED_CONTENT_SCRIPT_MATCHES)
    }
  })
})
