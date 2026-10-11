import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ALLOWED_PERMISSIONS } from '../scripts/extension-permission-allowlists.mjs'
import { TWITCH_SIGNIN_ENABLED } from '../src/shared/twitchSignIn.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function loadManifest(name: string) {
  return JSON.parse(readFileSync(join(root, 'manifests', name), 'utf8')) as {
    permissions?: string[]
    host_permissions?: string[]
    optional_host_permissions?: string[]
    content_scripts?: Array<{ matches?: string[] }>
    web_accessible_resources?: Array<{ resources?: string[]; matches?: string[] }>
    version?: string
  }
}

const EXPECTED_PERMISSIONS = ['storage', 'scripting']
const EXPECTED_HOST_PERMISSIONS = [
  'https://api.streampulse.stream/*',
  'https://cdn.7tv.app/*',
  'https://cdn.betterttv.net/*',
  'https://cdn.streampulse.stream/*',
  'https://static-cdn.jtvnw.net/*',
  'https://cdn.frankerfacez.com/*',
  'https://*.twitch.tv/*',
]
const EXPECTED_OPTIONAL_HOST_PERMISSIONS = [
  'http://localhost:8081/*',
  'http://127.0.0.1:8081/*',
]
const EXPECTED_CONTENT_SCRIPT_MATCHES = ['https://*.twitch.tv/*']
const EXPECTED_WEB_ACCESSIBLE_RESOURCES = [{
  resources: ['content/shadow.css'],
  matches: EXPECTED_CONTENT_SCRIPT_MATCHES,
}]

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

  it('requests identity only once Sign in with Twitch is compiled on, never identity.email, external messaging or a store key', () => {
    // Store review rejects a permission the package never uses; the worker
    // already treats a missing chrome.identity as sign-in unavailable.
    expect(TWITCH_SIGNIN_ENABLED).toBe(false)
    expect(ALLOWED_PERMISSIONS).not.toContain('identity')
    for (const name of ['development.json', 'cws.json', 'edge.json', 'firefox.json'] as const) {
      const manifest = JSON.parse(readFileSync(join(root, 'manifests', name), 'utf8')) as Record<string, unknown> & { permissions?: string[] }
      expect(manifest.permissions?.includes('identity')).toBe(TWITCH_SIGNIN_ENABLED)
      // identity.email is the variant Chrome warns about; the flow never needs it.
      expect(manifest.permissions).not.toContain('identity.email')
      expect(manifest).not.toHaveProperty('externally_connectable')
      if (name !== 'development.json') expect(manifest).not.toHaveProperty('key')
    }
    const rootManifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as { permissions?: string[] }
    expect(rootManifest.permissions?.includes('identity')).toBe(TWITCH_SIGNIN_ENABLED)
  })

  it('matches content scripts on HTTPS Twitch only', () => {
    for (const name of ['development.json', 'cws.json', 'edge.json', 'firefox.json'] as const) {
      const manifest = loadManifest(name)
      const matches = manifest.content_scripts?.flatMap((entry) => entry.matches ?? []) ?? []
      expect(matches).toEqual(EXPECTED_CONTENT_SCRIPT_MATCHES)
      expect(manifest.web_accessible_resources).toEqual(EXPECTED_WEB_ACCESSIBLE_RESOURCES)
    }
  })
})
