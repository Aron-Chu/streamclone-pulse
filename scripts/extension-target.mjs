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
 * Sign in with Twitch build stage.
 *
 *   - `off`: no Twitch sign-in; the options page keeps the invited-tester device
 *     link behind a closed disclosure and points purchases at streampulse.stream.
 *   - `tester`: development and preview builds only, for invited testers while
 *     the backend runs Twitch sign-in in pilot mode. Store builds refuse it.
 *   - `public`: Continue with Twitch for everyone.
 *
 * Store builds (cws, edge, firefox) derive the stage from their checked-in
 * manifest, so the manifest is the one auditable switch per store: `identity`
 * requested means `public`, no `identity` means `off`. PULSE_EXTENSION_TWITCH_SIGNIN
 * may be given but must agree, or the build fails (a store package that asks for
 * `identity` and never uses it is an unused permission, which store review
 * rejects; one that turns sign-in on without the permission cannot open Twitch).
 * The release that adds `identity` to a store manifest also adds that target to
 * SIGN_IN_PUBLIC_TARGETS in extension-permission-allowlists.mjs and updates the
 * store permission docs; tests/manifestPermissions.test.ts fails until all move
 * together.
 *
 * Development builds read PULSE_EXTENSION_TWITCH_SIGNIN (default `off`); with
 * Twitch on, `identity` is added to the generated manifest only and the
 * checked-in development manifest stays unchanged.
 */
export const TWITCH_SIGNIN_STAGES = ['off', 'tester', 'public']

/** The stage a store manifest implies: `identity` requested means public. */
export function storeManifestTwitchSignInStage(target, manifest = undefined) {
  const permissions = (manifest ?? JSON.parse(readFileSync(manifestPathForTarget(target), 'utf8'))).permissions ?? []
  return permissions.includes('identity') ? 'public' : 'off'
}

export function resolveTwitchSignInStage(target = resolveExtensionTarget(), raw = process.env.PULSE_EXTENSION_TWITCH_SIGNIN, manifest = undefined) {
  const given = String(raw ?? '').trim().toLowerCase()
  if (given && !TWITCH_SIGNIN_STAGES.includes(given)) {
    throw new Error(`unknown PULSE_EXTENSION_TWITCH_SIGNIN=${JSON.stringify(raw)}; expected one of ${TWITCH_SIGNIN_STAGES.join(', ')}`)
  }
  if (!isStoreTarget(target)) return given || 'off'
  if (given === 'tester') {
    throw new Error(`PULSE_EXTENSION_TWITCH_SIGNIN=tester is for development and preview builds only; ${target} store builds use off or public`)
  }
  const derived = storeManifestTwitchSignInStage(target, manifest)
  if (given && given !== derived) {
    throw new Error(derived === 'off'
      ? `PULSE_EXTENSION_TWITCH_SIGNIN=public needs the ${target} manifest to request identity first (with the permission allowlist and store permission docs in the same change)`
      : `PULSE_EXTENSION_TWITCH_SIGNIN=off disagrees with the ${target} manifest, which requests identity: a store package must not request a permission it never uses`)
  }
  return derived
}

/**
 * Stripe customer-portal login link for the "Lost Twitch access" row, from
 * PULSE_EXTENSION_STRIPE_PORTAL_LOGIN_URL. Empty is allowed (the row then says
 * to email us). A set value must be https://billing.stripe.com/p/login/<id>
 * with no credentials, port, query or fragment, or the build fails: a store
 * package never ships a link the runtime would refuse. Same rule as the
 * website's VITE_STRIPE_PORTAL_LOGIN_URL and src/shared/supporterOffer.ts.
 */
export function resolveStripePortalLoginUrl(raw = process.env.PULSE_EXTENSION_STRIPE_PORTAL_LOGIN_URL) {
  const value = String(raw ?? '').trim()
  if (!value) return ''
  let url
  try { url = new URL(value) } catch { url = null }
  const ok = url !== null
    && url.protocol === 'https:'
    && url.hostname === 'billing.stripe.com'
    && !url.username && !url.password && !url.port && !url.search && !url.hash
    && /^\/p\/login\/[A-Za-z0-9_]+$/.test(url.pathname)
  if (!ok) throw new Error('PULSE_EXTENSION_STRIPE_PORTAL_LOGIN_URL must be an https://billing.stripe.com/p/login/<id> address with no query or fragment')
  return url.href
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
