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

/**
 * Sign in with Twitch build stage, from PULSE_EXTENSION_TWITCH_SIGNIN:
 *
 *   - `off` (default, and today's store builds): no Twitch sign-in; the options
 *     page says Supporter sign-ups are not open and keeps the invited-tester
 *     device link behind a closed disclosure.
 *   - `tester`: development and preview builds only, for invited testers while
 *     the backend runs Twitch sign-in in pilot mode. Store builds refuse it.
 *   - `public`: Continue with Twitch for everyone. A store build accepts it only
 *     once that store's manifest already requests `identity` (the release that
 *     also updates the permission allowlist and the store permission docs).
 *
 * A development build with Twitch on gets `identity` added to its generated
 * manifest only; the checked-in manifests stay unchanged.
 */
export const TWITCH_SIGNIN_STAGES = ['off', 'tester', 'public']

export function resolveTwitchSignInStage(target = resolveExtensionTarget(), raw = process.env.PULSE_EXTENSION_TWITCH_SIGNIN, manifest = undefined) {
  const value = String(raw ?? '').trim().toLowerCase() || 'off'
  if (!TWITCH_SIGNIN_STAGES.includes(value)) {
    throw new Error(`unknown PULSE_EXTENSION_TWITCH_SIGNIN=${JSON.stringify(raw)}; expected one of ${TWITCH_SIGNIN_STAGES.join(', ')}`)
  }
  if (isStoreTarget(target) && value === 'tester') {
    throw new Error(`PULSE_EXTENSION_TWITCH_SIGNIN=tester is for development and preview builds only; ${target} store builds use off or public`)
  }
  if (isStoreTarget(target) && value === 'public') {
    const permissions = (manifest ?? JSON.parse(readFileSync(manifestPathForTarget(target), 'utf8'))).permissions ?? []
    if (!permissions.includes('identity')) {
      throw new Error(`PULSE_EXTENSION_TWITCH_SIGNIN=public needs the ${target} manifest to request identity first (with the permission allowlist and store permission docs in the same change)`)
    }
  }
  return value
}

/** The generated manifest for a build: development builds with Twitch on also request `identity`. */
export function manifestForTwitchSignInStage(manifest, target, stage) {
  if (stage === 'off' || target !== 'development') return manifest
  const permissions = manifest.permissions ?? []
  return permissions.includes('identity') ? manifest : { ...manifest, permissions: [...permissions, 'identity'] }
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
