/**
 * Resolve extension packaging / build target (development | cws | edge | firefox).
 * Valid plain JavaScript — must pass: node --check scripts/extension-target.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

export const EXTENSION_TARGETS = ['development', 'cws', 'edge', 'firefox']

export function resolveExtensionTarget(raw = process.env.EXTENSION_TARGET) {
  const value = String(raw ?? 'development').trim().toLowerCase()
  if (!EXTENSION_TARGETS.includes(value)) {
    throw new Error(
      `unknown EXTENSION_TARGET=${JSON.stringify(raw)}; expected one of ${EXTENSION_TARGETS.join(', ')}`,
    )
  }
  return value
}

export function manifestPathForTarget(target = resolveExtensionTarget()) {
  const path = join(root, 'manifests', `${target}.json`)
  if (!existsSync(path)) {
    throw new Error(`manifest missing for target ${target}: ${path}`)
  }
  return path
}

export function loadManifestForTarget(target = resolveExtensionTarget()) {
  const manifest = JSON.parse(readFileSync(manifestPathForTarget(target), 'utf8'))
  const origin = resolveSupporterBackendOrigin(target)
  if (origin !== 'https://api.streampulse.stream') manifest.host_permissions.push(`${origin}/*`)
  return manifest
}

/** A fixed development-only loopback origin; production credentials never follow it. */
export function resolveSupporterBackendOrigin(target = resolveExtensionTarget(), raw = process.env.PULSE_SUPPORTER_DEV_ORIGIN) {
  if (!raw) return 'https://api.streampulse.stream'
  if (target !== 'development') throw new Error('PULSE_SUPPORTER_DEV_ORIGIN is allowed only for development builds')
  let url
  try { url = new URL(raw) } catch { throw new Error('Supporter development origin must be a loopback HTTPS origin') }
  if (url.protocol !== 'https:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.origin !== raw.replace(/\/$/, '')) throw new Error('Supporter development origin must be an exact loopback HTTPS origin')
  return url.origin
}

export function isStoreTarget(target = resolveExtensionTarget()) {
  return target === 'cws' || target === 'edge' || target === 'firefox'
}

/** True when a permission / host string is any localhost or loopback origin. */
export function isLocalOrLoopbackHost(host) {
  const value = String(host ?? '').toLowerCase()
  return (
    value.includes('localhost')
    || value.includes('127.0.0.1')
    || value.includes('[::1]')
    || value.includes('0.0.0.0')
  )
}

/** Allow `node scripts/extension-target.mjs` smoke prints without side effects in imports. */
export function printResolvedTarget() {
  console.log(resolveExtensionTarget())
}
